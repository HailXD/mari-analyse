import re
from pathlib import Path
from typing import List, Optional, Tuple
import pdfplumber


INPUT_PDF = "Jan2026_Mari_Credit_Card_E-Statement.pdf"
OUTPUT_TXT = ""
ENCODING = "utf-8"

HEADER_TEXT = "POSTED DATE TRANSACTION DATE DESCRIPTION AMOUNT (SGD)"
SECTION_HEADINGS = {"PURCHASE", "REPAYMENT/CONVERSION", "CASHBACK", "GENERAL"}
DATE_LINE_RE = re.compile(r"^(?P<posted>\d{2}\s+[A-Z]{3})\s+(?P<tran>\d{2}\s+[A-Z]{3})\s*(?P<rest>.*)$")
AMOUNT_RE = re.compile(r"([+-])\s*([\d,]+\.\d{2})")
PAGE_RE = re.compile(r"^PAGE\s+\d+\s+OF\s+\d+$")


def extract_sections(pdf_path: Path) -> List[List[str]]:
    sections: List[List[str]] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if not text:
                continue
            lines = [ln.strip() for ln in text.splitlines()]
            header_idx = None
            for i, line in enumerate(lines):
                if HEADER_TEXT in line.upper():
                    header_idx = i
                    break
            if header_idx is None:
                continue
            sections.append(lines[header_idx + 1 :])
    return sections


def parse_section(lines: List[str]) -> List[str]:
    output_lines: List[str] = []
    desc_parts: List[str] = []
    pending: Optional[Tuple[str, str, str, str]] = None
    expect_method = False

    for line in lines:
        line = line.strip()
        if not line:
            continue
        upper = line.upper()
        if PAGE_RE.match(upper):
            break

        if expect_method:
            if DATE_LINE_RE.match(upper):
                if pending:
                    posted, tran, desc, amount = pending
                    header_line = f"{posted} {tran} {desc}".strip()
                    if header_line:
                        output_lines.append(header_line)
                    if amount:
                        output_lines.append(amount)
                pending = None
                expect_method = False
            else:
                method_line = line
                if pending:
                    posted, tran, desc, amount = pending
                    header_line = f"{posted} {tran} {desc}".strip()
                    if header_line:
                        output_lines.append(header_line)
                    if amount and not AMOUNT_RE.search(method_line):
                        method_line = f"{method_line} {amount}".strip()
                    output_lines.append(method_line)
                desc_parts = []
                pending = None
                expect_method = False
                continue

        if upper in SECTION_HEADINGS:
            continue

        m = DATE_LINE_RE.match(upper)
        if m:
            posted = m.group("posted")
            tran = m.group("tran")
            rest = line[m.end("tran") :].strip()
            last_match = None
            for match in AMOUNT_RE.finditer(rest):
                last_match = match
            amount = ""
            extra_desc = rest
            if last_match:
                amount = f"{last_match.group(1)}{last_match.group(2)}"
                extra_desc = rest[: last_match.start()].strip()
            desc_list = [p for p in desc_parts if p]
            if extra_desc:
                desc_list.append(extra_desc)
            desc = " ".join(desc_list).strip()
            pending = (posted, tran, desc, amount)
            expect_method = True
            continue

        desc_parts.append(line)

    if pending:
        posted, tran, desc, amount = pending
        header_line = f"{posted} {tran} {desc}".strip()
        if header_line:
            output_lines.append(header_line)
        if amount:
            output_lines.append(amount)

    return output_lines


def resolve_output_path(input_path: Path, output_path: str) -> Path:
    if output_path:
        return Path(output_path)
    return input_path.with_suffix(".txt")


def convert_pdf_to_txt(input_path: Path, output_path: Path) -> int:
    sections = extract_sections(input_path)
    output_lines: List[str] = []
    for section in sections:
        output_lines.extend(parse_section(section))
    if not output_lines:
        raise SystemExit("No transactions found.")
    output_path.write_text("\n".join(output_lines) + "\n", encoding=ENCODING)
    return len(output_lines) // 2


def main() -> None:
    input_path = Path(INPUT_PDF)
    if not input_path.exists():
        raise SystemExit(f"Missing file: {input_path}")
    output_path = resolve_output_path(input_path, OUTPUT_TXT)
    count = convert_pdf_to_txt(input_path, output_path)
    print(f"Wrote: {output_path} ({count} transactions)")


if __name__ == "__main__":
    main()
