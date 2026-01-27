const PYODIDE_INDEX_URL = "pyodide/"
const PYPDF_WHEEL = "wheels/pypdf-6.6.2-py3-none-any.whl"
const PDF_TEMP_PREFIX = "statement-"

const baseCategoryOrder = [
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
  "others",
]

const headerText = "POSTED DATE TRANSACTION DATE DESCRIPTION AMOUNT (SGD)"
const sectionHeadings = new Set(["PURCHASE", "REPAYMENT/CONVERSION", "CASHBACK", "GENERAL"])
const pageRe = /^PAGE\s+\d+\s+OF\s+\d+$/i
const dateLineRe = /^(\d{2}\s+[A-Z]{3})\s+(\d{2}\s+[A-Z]{3})\s+(.*)$/i
const amountRe = /([+-])\s*([\d,]+\.\d{2})/
const amountGlobalRe = /([+-])\s*([\d,]+\.\d{2})/g
const rangeOrder = { L: 0, H: 1, M: 2 }

const state = {
  keywordMap: {},
  categoryOrder: [...baseCategoryOrder],
  rows: [],
  filtered: [],
  fileName: "",
}

const pyState = {
  instance: null,
  loading: null,
}

const elements = {
  fileInput: document.getElementById("fileInput"),
  textInput: document.getElementById("textInput"),
  parseBtn: document.getElementById("parseBtn"),
  clearBtn: document.getElementById("clearBtn"),
  applyBtn: document.getElementById("applyBtn"),
  searchInput: document.getElementById("searchInput"),
  categoryFilter: document.getElementById("categoryFilter"),
  minPrice: document.getElementById("minPrice"),
  maxPrice: document.getElementById("maxPrice"),
  sortBy: document.getElementById("sortBy"),
  sortDir: document.getElementById("sortDir"),
  tableBody: document.getElementById("tableBody"),
  summaryBody: document.getElementById("summaryBody"),
  totalValue: document.getElementById("totalValue"),
  status: document.getElementById("status"),
  fileMeta: document.getElementById("fileMeta"),
  rowMeta: document.getElementById("rowMeta"),
}

const rangeChecks = Array.from(document.querySelectorAll(".chip input[type='checkbox']"))

async function loadMap() {
  try {
    const response = await fetch("map.json", { cache: "no-store" })
    if (!response.ok) {
      throw new Error("map.json not found")
    }
    const data = await response.json()
    const normalized = {}
    Object.entries(data).forEach(([key, values]) => {
      if (Array.isArray(values)) {
        normalized[key] = values
          .map((value) => String(value).trim().toUpperCase())
          .filter((value) => value.length > 0)
      }
    })
    state.keywordMap = normalized
    state.categoryOrder = buildCategoryOrder(normalized)
    updateCategoryFilter()
    if (state.rows.length) {
      recategorize()
      applyFilters()
    }
    setStatus("Map loaded")
  } catch (error) {
    setStatus("Map not loaded, using defaults", true)
  }
}

function buildCategoryOrder(mapData) {
  const keys = Object.keys(mapData)
  const base = baseCategoryOrder.filter((key) => keys.includes(key))
  const extras = keys.filter((key) => !base.includes(key) && key !== "others").sort()
  const ordered = [...base, ...extras]
  if (keys.includes("others") && !ordered.includes("others")) {
    ordered.push("others")
  }
  if (!ordered.includes("others")) {
    ordered.push("others")
  }
  return ordered
}

function updateCategoryFilter(selectedValues) {
  const existing = selectedValues || getSelectedCategories()
  const select = elements.categoryFilter
  select.innerHTML = ""
  state.categoryOrder.forEach((category) => {
    const option = document.createElement("option")
    option.value = category
    option.textContent = category
    option.selected = existing.length ? existing.includes(category) : true
    select.appendChild(option)
  })
}

function getSelectedCategories() {
  return Array.from(elements.categoryFilter.selectedOptions).map((option) => option.value)
}

function setStatus(message, isWarning = false) {
  elements.status.textContent = message
  elements.status.style.color = isWarning ? "var(--danger)" : "var(--muted)"
}

function setMeta() {
  elements.fileMeta.textContent = state.fileName ? `Loaded: ${state.fileName}` : "No data loaded"
  elements.rowMeta.textContent = `${state.filtered.length} transactions`
}

function extractItem(line) {
  const match = line.match(dateLineRe)
  if (match) {
    return match[3].trim()
  }
  return line.trim()
}

function parseAmount(line) {
  const match = line.match(amountRe)
  if (!match) {
    return { price: null, isPositive: false }
  }
  const sign = match[1]
  const value = Number(match[2].replace(/,/g, ""))
  if (Number.isNaN(value)) {
    return { price: null, isPositive: false }
  }
  return { price: Math.abs(value), isPositive: sign === "+" }
}

function getRange(price) {
  if (price >= 50) return "M"
  if (price >= 10) return "H"
  return "L"
}

function categorize(item) {
  const upper = item.toUpperCase()
  for (const category of state.categoryOrder) {
    const keywords = state.keywordMap[category] || []
    for (const keyword of keywords) {
      if (keyword && upper.includes(keyword)) {
        return category
      }
    }
  }
  return "others"
}

function parseStatementText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const rows = []
  for (let index = 0; index < lines.length; index += 2) {
    const descLine = lines[index]
    const amountLine = lines[index + 1] || ""
    const item = extractItem(descLine)
    const { price, isPositive } = parseAmount(amountLine)
    if (price === null || isPositive) {
      continue
    }
    const category = categorize(item)
    const range = getRange(price)
    rows.push({ item, category, price, range, index: rows.length })
  }
  return rows
}

function buildLinesFromPage(textContent) {
  const items = textContent.items
    .map((item) => ({
      text: String(item.str || ""),
      x: item.transform[4],
      y: item.transform[5],
      width: item.width || 0,
    }))
    .filter((item) => item.text.trim().length > 0)
  items.sort((a, b) => (b.y - a.y) || (a.x - b.x))
  const lines = []
  let current = null
  const threshold = 2
  items.forEach((item) => {
    if (!current || Math.abs(item.y - current.y) > threshold) {
      if (current) {
        const text = current.parts.map((part) => part.text).join(" ").replace(/\s+/g, " ").trim()
        if (text) lines.push(text)
      }
      current = { y: item.y, parts: [item] }
    } else {
      current.parts.push(item)
    }
  })
  if (current) {
    const text = current.parts.map((part) => part.text).join(" ").replace(/\s+/g, " ").trim()
    if (text) lines.push(text)
  }
  return lines
}

function extractSections(pagesLines) {
  const sections = []
  pagesLines.forEach((lines) => {
    let headerIndex = -1
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].toUpperCase().includes(headerText)) {
        headerIndex = index
        break
      }
    }
    if (headerIndex >= 0) {
      sections.push(lines.slice(headerIndex + 1))
    }
  })
  return sections
}

function parseSection(lines) {
  const outputLines = []
  let descParts = []
  let pending = null
  let expectMethod = false

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].trim()
    if (!line) continue
    const upper = line.toUpperCase()
    if (pageRe.test(upper)) break

    if (expectMethod) {
      if (dateLineRe.test(upper)) {
        if (pending) {
          const headerLine = `${pending.posted} ${pending.tran} ${pending.desc}`.trim()
          if (headerLine) outputLines.push(headerLine)
          if (pending.amount) outputLines.push(pending.amount)
        }
        pending = null
        expectMethod = false
      } else {
        let methodLine = line
        if (pending) {
          const headerLine = `${pending.posted} ${pending.tran} ${pending.desc}`.trim()
          if (headerLine) outputLines.push(headerLine)
          if (pending.amount && !amountRe.test(methodLine)) {
            methodLine = `${methodLine} ${pending.amount}`.trim()
          }
          outputLines.push(methodLine)
        }
        descParts = []
        pending = null
        expectMethod = false
        continue
      }
    }

    if (sectionHeadings.has(upper)) {
      continue
    }

    const match = line.match(dateLineRe)
    if (match) {
      const posted = match[1]
      const tran = match[2]
      let rest = match[3].trim()
      let amount = ""
      let extraDesc = rest
      amountGlobalRe.lastIndex = 0
      const amountMatches = [...rest.matchAll(amountGlobalRe)]
      if (amountMatches.length) {
        const last = amountMatches[amountMatches.length - 1]
        amount = `${last[1]}${last[2]}`
        const startIndex = last.index ?? rest.length
        extraDesc = rest.slice(0, startIndex).trim()
      }
      const descList = descParts.filter((part) => part)
      if (extraDesc) descList.push(extraDesc)
      const desc = descList.join(" ").trim()
      pending = { posted, tran, desc, amount }
      expectMethod = true
      continue
    }

    descParts.push(line)
  }

  if (pending) {
    const headerLine = `${pending.posted} ${pending.tran} ${pending.desc}`.trim()
    if (headerLine) outputLines.push(headerLine)
    if (pending.amount) outputLines.push(pending.amount)
  }

  return outputLines
}

function recategorize() {
  state.rows = state.rows.map((row) => ({
    ...row,
    category: categorize(row.item),
  }))
  updateCategoryFilter(getSelectedCategories())
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result || "")
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.readAsText(file)
  })
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result || new ArrayBuffer(0))
    reader.onerror = () => reject(new Error("Failed to read file"))
    reader.readAsArrayBuffer(file)
  })
}

async function getPyodideInstance() {
  if (pyState.instance) {
    return pyState.instance
  }
  if (!pyState.loading) {
    pyState.loading = (async () => {
      if (!window.loadPyodide) {
        throw new Error("PDF engine unavailable")
      }
      const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL })
      await pyodide.loadPackage("micropip")
      const micropip = pyodide.pyimport("micropip")
      await micropip.install(PYPDF_WHEEL)
      if (typeof micropip.destroy === "function") {
        micropip.destroy()
      }
      pyState.instance = pyodide
      return pyodide
    })()
  }
  return pyState.loading
}

async function extractTextFromPdf(buffer) {
  const pyodide = await getPyodideInstance()
  const fileName = `${PDF_TEMP_PREFIX}${Date.now()}.pdf`
  pyodide.FS.writeFile(fileName, new Uint8Array(buffer))
  try {
    const code = [
      "import json",
      "from pypdf import PdfReader",
      `reader = PdfReader("${fileName}")`,
      "pages = []",
      "for page in reader.pages:",
      "    text = page.extract_text() or ''",
      "    pages.append(text)",
      "json.dumps(pages)",
    ].join("\n")
    const pagesJson = await pyodide.runPythonAsync(code)
    const pages = JSON.parse(pagesJson || "[]")
    const pagesLines = pages.map((page) =>
      page
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    )
    const sections = extractSections(pagesLines)
    const outputLines = []
    sections.forEach((section) => {
      outputLines.push(...parseSection(section))
    })
    if (!outputLines.length) {
      return pagesLines.flat().join("\n")
    }
    return outputLines.join("\n")
  } finally {
    const info = pyodide.FS.analyzePath(fileName)
    if (info.exists) {
      pyodide.FS.unlink(fileName)
    }
  }
}

function applyFilters() {
  const searchTerm = elements.searchInput.value.trim().toUpperCase()
  const selectedCategories = getSelectedCategories()
  const activeRanges = rangeChecks.filter((input) => input.checked).map((input) => input.value)
  const minValue = Number(elements.minPrice.value)
  const maxValue = Number(elements.maxPrice.value)
  const hasMin = !Number.isNaN(minValue) && elements.minPrice.value !== ""
  const hasMax = !Number.isNaN(maxValue) && elements.maxPrice.value !== ""
  const allowedCategories = selectedCategories.length ? selectedCategories : state.categoryOrder

  state.filtered = state.rows.filter((row) => {
    if (searchTerm && !row.item.toUpperCase().includes(searchTerm) && !row.category.toUpperCase().includes(searchTerm)) {
      return false
    }
    if (!allowedCategories.includes(row.category)) {
      return false
    }
    if (!activeRanges.includes(row.range)) {
      return false
    }
    if (hasMin && row.price < minValue) {
      return false
    }
    if (hasMax && row.price > maxValue) {
      return false
    }
    return true
  })

  sortRows()
  renderTable()
  renderSummary()
  setMeta()
}

function sortRows() {
  const key = elements.sortBy.value
  const dir = elements.sortDir.value === "desc" ? -1 : 1
  const compare = (a, b) => {
    if (key === "price") return (a.price - b.price) * dir
    if (key === "range") return (rangeOrder[a.range] - rangeOrder[b.range]) * dir
    if (key === "category") return a.category.localeCompare(b.category) * dir
    return a.item.localeCompare(b.item) * dir
  }
  state.filtered.sort(compare)
}

function renderTable() {
  elements.tableBody.innerHTML = ""
  const fragment = document.createDocumentFragment()
  state.filtered.forEach((row) => {
    const tr = document.createElement("tr")
    const item = document.createElement("td")
    item.textContent = row.item
    const category = document.createElement("td")
    category.textContent = row.category
    const price = document.createElement("td")
    price.textContent = row.price.toFixed(2)
    price.className = "number"
    const range = document.createElement("td")
    range.textContent = row.range
    tr.append(item, category, price, range)
    fragment.appendChild(tr)
  })
  elements.tableBody.appendChild(fragment)
}

function renderSummary() {
  const totals = new Map()
  let totalValue = 0
  let foodH = 0
  state.filtered.forEach((row) => {
    totalValue += row.price
    totals.set(row.category, (totals.get(row.category) || 0) + row.price)
    if (row.category === "food" && row.range === "H") {
      foodH += row.price
    }
  })
  elements.totalValue.textContent = totalValue.toFixed(2)
  elements.summaryBody.innerHTML = ""
  const summaryOrder = buildSummaryOrder([...totals.keys()])
  summaryOrder.forEach((category) => {
    const tr = document.createElement("tr")
    const label = document.createElement("td")
    label.textContent = category
    const value = document.createElement("td")
    value.textContent = (totals.get(category) || 0).toFixed(2)
    tr.append(label, value)
    elements.summaryBody.appendChild(tr)
  })
  const extra = document.createElement("tr")
  const extraLabel = document.createElement("td")
  extraLabel.textContent = "food (range H)"
  const extraValue = document.createElement("td")
  extraValue.textContent = foodH.toFixed(2)
  extra.append(extraLabel, extraValue)
  elements.summaryBody.appendChild(extra)
}

function buildSummaryOrder(categories) {
  const known = state.categoryOrder.filter((category) => categories.includes(category))
  const extras = categories.filter((category) => !known.includes(category) && category !== "others").sort()
  const ordered = [...known, ...extras]
  if (categories.includes("others") && !ordered.includes("others")) {
    ordered.push("others")
  }
  return ordered
}

async function handleFileChange(event) {
  const file = event.target.files[0]
  if (!file) return
  try {
    state.fileName = file.name
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
    if (isPdf) {
      setStatus("Reading PDF")
      const buffer = await readFileAsArrayBuffer(file)
      const text = await extractTextFromPdf(buffer)
      elements.textInput.value = text
      loadFromText(text)
      return
    }
    const text = await readFile(file)
    elements.textInput.value = text
    loadFromText(text)
  } catch (error) {
    setStatus("Failed to read file", true)
  }
}

function loadFromText(text) {
  const rows = parseStatementText(text)
  state.rows = rows
  updateCategoryFilter(getSelectedCategories())
  applyFilters()
  setStatus(`Loaded ${rows.length} transactions`)
}

function clearAll() {
  state.rows = []
  state.filtered = []
  state.fileName = ""
  elements.textInput.value = ""
  elements.tableBody.innerHTML = ""
  elements.summaryBody.innerHTML = ""
  elements.totalValue.textContent = "0.00"
  setStatus("Cleared")
  setMeta()
}

function bindEvents() {
  elements.fileInput.addEventListener("change", handleFileChange)
  elements.parseBtn.addEventListener("click", () => loadFromText(elements.textInput.value))
  elements.clearBtn.addEventListener("click", clearAll)
  elements.applyBtn.addEventListener("click", applyFilters)
  elements.searchInput.addEventListener("input", applyFilters)
  elements.minPrice.addEventListener("input", applyFilters)
  elements.maxPrice.addEventListener("input", applyFilters)
  elements.sortBy.addEventListener("change", applyFilters)
  elements.sortDir.addEventListener("change", applyFilters)
  elements.categoryFilter.addEventListener("change", applyFilters)
  rangeChecks.forEach((input) => input.addEventListener("change", applyFilters))
}

function init() {
  bindEvents()
  updateCategoryFilter()
  applyFilters()
  loadMap()
}

init()
