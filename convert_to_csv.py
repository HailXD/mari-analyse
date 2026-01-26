import csv
import json
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Dict, List, Tuple


INPUT_TXT = "Jan2026_Mari_Credit_Card_E-Statement.txt"
OUTPUT_CSV = "Jan2026_Mari_Credit_Card_E-Statement.csv"
MAP_JSON = "map.json"
ENCODING = "utf-8"

CATEGORY_ORDER = [
    "food",
    "grocery",
    "utilities",
    "broadband",
    "online shopping",
    "online purchases",
    "Entertainment",
    "Transport",
    "Private Hire",
    "Equipment",
    "Toys",
]

RANGE_L_MAX = Decimal("50")
RANGE_M_MIN = Decimal("50")
RANGE_H_MIN = Decimal("10")

DATE_LINE_RE = re.compile(
    r"^(?P<posted>\d{2}\s+[A-Z]{3})\s+(?P<tran>\d{2}\s+[A-Z]{3})\s+(?P<rest>.*)$",
    re.IGNORECASE,
)
AMOUNT_RE = re.compile(r"([+-])\s*([\d,]+\.\d{2})")


def read_lines(path: Path) -> List[str]:
    return [line.strip() for line in path.read_text(encoding=ENCODING).splitlines() if line.strip()]


def extract_item(line: str) -> str:
    match = DATE_LINE_RE.match(line)
    if match:
        return match.group("rest").strip()
    return line.strip()


def extract_amount(line: str) -> Decimal:
    match = AMOUNT_RE.search(line)
    if not match:
        return Decimal("0")
    sign, raw = match.group(1), match.group(2)
    try:
        value = Decimal(raw.replace(",", ""))
    except InvalidOperation:
        return Decimal("0")
    if sign == "-":
        return -value
    return value


def parse_transactions(lines: List[str]) -> List[Tuple[str, Decimal]]:
    transactions: List[Tuple[str, Decimal]] = []
    index = 0
    count = len(lines)
    while index < count:
        desc_line = lines[index].strip()
        if not desc_line:
            index += 1
            continue
        amount_line = lines[index + 1].strip() if index + 1 < count else ""
        item = extract_item(desc_line)
        amount = extract_amount(amount_line)
        transactions.append((item, amount))
        index += 2
    return transactions


def load_keyword_map(path: Path) -> Dict[str, List[str]]:
    data = json.loads(path.read_text(encoding=ENCODING))
    output: Dict[str, List[str]] = {}
    for key, values in data.items():
        if isinstance(values, list):
            normalized: List[str] = []
            for value in values:
                text = str(value).strip()
                if text:
                    normalized.append(text.upper())
            output[key] = normalized
    return output


def categorize(item: str, keyword_map: Dict[str, List[str]]) -> str:
    upper_item = item.upper()
    for category in CATEGORY_ORDER:
        keywords = keyword_map.get(category, [])
        for keyword in keywords:
            if keyword and keyword in upper_item:
                return category
    return "others"


def get_range(amount: Decimal) -> str:
    value = abs(amount)
    if value >= RANGE_M_MIN:
        return "M"
    if value >= RANGE_H_MIN:
        return "H"
    return "L"


def build_rows(
    transactions: List[Tuple[str, Decimal]],
    keyword_map: Dict[str, List[str]],
) -> List[Tuple[str, str, Decimal, str]]:
    rows: List[Tuple[str, str, Decimal, str]] = []
    for item, amount in transactions:
        if amount > 0:
            amount = -amount
        category = categorize(item, keyword_map)
        amount_range = get_range(amount)
        rows.append((item, category, amount, amount_range))
    return rows


def write_csv(path: Path, rows: List[Tuple[str, str, Decimal, str]]) -> None:
    with path.open("w", newline="", encoding=ENCODING) as file:
        writer = csv.writer(file)
        writer.writerow(["Item", "category", "price", "range"])
        for item, category, amount, amount_range in rows:
            writer.writerow([item, category, f"{amount:.2f}", amount_range])


def main() -> None:
    input_path = Path(INPUT_TXT)
    if not input_path.exists():
        raise SystemExit(f"Missing file: {input_path}")
    map_path = Path(MAP_JSON)
    if not map_path.exists():
        raise SystemExit(f"Missing file: {map_path}")
    lines = read_lines(input_path)
    transactions = parse_transactions(lines)
    keyword_map = load_keyword_map(map_path)
    rows = build_rows(transactions, keyword_map)
    output_path = Path(OUTPUT_CSV)
    write_csv(output_path, rows)
    print(f"Wrote: {output_path} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
