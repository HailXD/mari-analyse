const HEADER_TEXT = "POSTED DATE TRANSACTION DATE DESCRIPTION AMOUNT (SGD)";
const SECTION_HEADINGS = new Set(["PURCHASE", "REPAYMENT/CONVERSION", "CASHBACK", "GENERAL"]);
const DATE_LINE_RE = /^(?<posted>\d{2}\s+[A-Z]{3})\s+(?<tran>\d{2}\s+[A-Z]{3})\s*(?<rest>.*)$/i;
const AMOUNT_RE = /([+-])\s*([\d,]+\.\d{2})/;
const AMOUNT_RE_GLOBAL = /([+-])\s*([\d,]+\.\d{2})/g;
const PAGE_RE = /^PAGE\s+\d+\s+OF\s+\d+$/;

const pdfInput = document.getElementById("pdfInput");
const runBtn = document.getElementById("runBtn");
const downloadBtn = document.getElementById("downloadBtn");
const output = document.getElementById("output");
const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");

let lastOutput = "";

if (window.pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.6.347/pdf.min.js";
}

pdfInput.addEventListener("change", () => {
  const hasFile = pdfInput.files && pdfInput.files.length > 0;
  runBtn.disabled = !hasFile;
  downloadBtn.disabled = true;
  output.value = "";
  lastOutput = "";
  countEl.textContent = "";
  statusEl.textContent = hasFile ? "Ready to convert." : "Waiting for a PDF.";
});

runBtn.addEventListener("click", async () => {
  const file = pdfInput.files && pdfInput.files[0];
  if (!file) {
    statusEl.textContent = "Select a PDF first.";
    return;
  }

  runBtn.disabled = true;
  downloadBtn.disabled = true;
  output.value = "";
  countEl.textContent = "";
  statusEl.textContent = "Reading PDF...";

  try {
    const sections = await extractSections(file);
    const outputLines = [];
    for (const section of sections) {
      outputLines.push(...parseSection(section));
    }

    if (!outputLines.length) {
      statusEl.textContent = "No transactions found.";
      lastOutput = "";
      return;
    }

    lastOutput = outputLines.join("\n") + "\n";
    output.value = lastOutput;
    const txCount = Math.floor(outputLines.length / 2);
    countEl.textContent = `${txCount} transactions`;
    statusEl.textContent = "Done.";
    downloadBtn.disabled = false;
  } catch (err) {
    statusEl.textContent = "Failed to read the PDF.";
  } finally {
    runBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", () => {
  if (!lastOutput) {
    return;
  }
  const blob = new Blob([lastOutput], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "statement.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

async function extractSections(file) {
  const data = await file.arrayBuffer();
  const disableWorker = window.location.protocol === "file:";
  const pdf = await pdfjsLib.getDocument({ data, disableWorker }).promise;
  const sections = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent({ normalizeWhitespace: true });
    const lines = textContentToLines(textContent);
    const headerIndex = lines.findIndex((line) => line.toUpperCase().includes(HEADER_TEXT));
    if (headerIndex === -1) {
      continue;
    }
    sections.push(lines.slice(headerIndex + 1));
  }

  return sections;
}

function textContentToLines(textContent) {
  let text = "";
  for (const item of textContent.items) {
    const str = item.str || "";
    if (str) {
      text += str;
    }
    text += item.hasEOL ? "\n" : " ";
  }
  return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}

function parseSection(lines) {
  const outputLines = [];
  const descParts = [];
  let pending = null;
  let expectMethod = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const upper = line.toUpperCase();
    if (PAGE_RE.test(upper)) {
      break;
    }

    if (expectMethod) {
      if (DATE_LINE_RE.test(upper)) {
        if (pending) {
          const headerLine = `${pending.posted} ${pending.tran} ${pending.desc}`.trim();
          if (headerLine) {
            outputLines.push(headerLine);
          }
          if (pending.amount) {
            outputLines.push(pending.amount);
          }
        }
        pending = null;
        expectMethod = false;
      } else {
        let methodLine = line;
        if (pending) {
          const headerLine = `${pending.posted} ${pending.tran} ${pending.desc}`.trim();
          if (headerLine) {
            outputLines.push(headerLine);
          }
          if (pending.amount && !AMOUNT_RE.test(methodLine)) {
            methodLine = `${methodLine} ${pending.amount}`.trim();
          }
          outputLines.push(methodLine);
        }
        descParts.length = 0;
        pending = null;
        expectMethod = false;
        continue;
      }
    }

    if (SECTION_HEADINGS.has(upper)) {
      continue;
    }

    const match = line.match(DATE_LINE_RE);
    if (match && match.groups) {
      const posted = match.groups.posted.toUpperCase();
      const tran = match.groups.tran.toUpperCase();
      const rest = (match.groups.rest || "").trim();
      const matches = Array.from(rest.matchAll(AMOUNT_RE_GLOBAL));
      let amount = "";
      let extraDesc = rest;
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        amount = `${lastMatch[1]}${lastMatch[2]}`;
        extraDesc = rest.slice(0, lastMatch.index).trim();
      }
      const descList = descParts.filter((part) => part.length > 0);
      if (extraDesc) {
        descList.push(extraDesc);
      }
      const desc = descList.join(" ").trim();
      pending = { posted, tran, desc, amount };
      expectMethod = true;
      continue;
    }

    descParts.push(line);
  }

  if (pending) {
    const headerLine = `${pending.posted} ${pending.tran} ${pending.desc}`.trim();
    if (headerLine) {
      outputLines.push(headerLine);
    }
    if (pending.amount) {
      outputLines.push(pending.amount);
    }
  }

  return outputLines;
}
