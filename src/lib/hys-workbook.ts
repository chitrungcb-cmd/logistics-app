import type ExcelJS from "exceljs";

const CELL_ADDRESS_PATTERN = /^([A-Z]{1,3})([1-9]\d{0,6})$/;

export type HysCellChange = {
  sheetName: string;
  address: string;
  value: string;
};

function excelColumnNumber(letters: string) {
  let value = 0;
  for (const letter of letters) {
    value = value * 26 + letter.charCodeAt(0) - 64;
  }
  return value;
}

export function parseHysCellAddress(address: string) {
  const normalized = address.trim().toUpperCase();
  const match = normalized.match(CELL_ADDRESS_PATTERN);
  if (!match) return null;

  const column = excelColumnNumber(match[1]);
  const row = Number(match[2]);
  if (column > 128 || row > 2_000) return null;
  return { address: normalized, column, row };
}

export function cellContainsFormula(cell: ExcelJS.Cell) {
  const value = cell.value;
  return Boolean(
    value &&
      typeof value === "object" &&
      ("formula" in value || "sharedFormula" in value)
  );
}

function parseDateInput(value: string) {
  const trimmed = value.trim();
  const vietnameseDate = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const isoDate = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const parts = vietnameseDate
    ? [Number(vietnameseDate[3]), Number(vietnameseDate[2]), Number(vietnameseDate[1])]
    : isoDate
      ? [Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3])]
      : null;
  if (!parts) return null;

  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}

/**
 * Converts text entered in the browser back to the original cell's basic type. The caller assigns
 * only `cell.value`, so number formats, borders, fills, widths, merged ranges and formulas in all
 * untouched cells remain exactly as they were in the uploaded HYS workbook.
 */
export function coerceHysCellValue(cell: ExcelJS.Cell, rawValue: string): ExcelJS.CellValue {
  if (rawValue.length > 10_000) {
    throw new Error(`Ô ${cell.address} có nội dung quá dài.`);
  }

  const trimmed = rawValue.trim();
  if (trimmed === "") return null;

  if (cell.value instanceof Date) {
    const date = parseDateInput(trimmed);
    if (!date) throw new Error(`Ngày tại ô ${cell.address} không hợp lệ.`);
    return date;
  }

  if (typeof cell.value === "number") {
    const normalized = trimmed.replace(/\s/g, "").replaceAll(".", "").replace(",", ".");
    const number = Number(normalized);
    if (!Number.isFinite(number)) {
      throw new Error(`Số tại ô ${cell.address} không hợp lệ.`);
    }
    return number;
  }

  if (typeof cell.value === "boolean") {
    const normalized = trimmed.toLowerCase();
    if (["true", "1", "có", "co"].includes(normalized)) return true;
    if (["false", "0", "không", "khong"].includes(normalized)) return false;
    throw new Error(`Giá trị đúng/sai tại ô ${cell.address} không hợp lệ.`);
  }

  // Identifiers such as chassis and engine numbers must stay as text so Excel cannot round them.
  return rawValue;
}

export function normalizeHysCellChanges(value: unknown): HysCellChange[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2_000) {
    throw new Error("Danh sách ô chỉnh sửa không hợp lệ.");
  }

  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Dữ liệu chỉnh sửa HYS không hợp lệ.");
    }

    const record = item as Record<string, unknown>;
    const sheetName = typeof record.sheetName === "string" ? record.sheetName.trim() : "";
    const address = typeof record.address === "string"
      ? parseHysCellAddress(record.address)?.address
      : null;
    const cellValue = typeof record.value === "string" ? record.value : null;
    if (!sheetName || sheetName.length > 31 || !address || cellValue === null) {
      throw new Error("Dữ liệu ô chỉnh sửa HYS không hợp lệ.");
    }

    const key = `${sheetName}\u0000${address}`;
    if (seen.has(key)) throw new Error(`Ô ${address} bị gửi lặp lại.`);
    seen.add(key);
    return { sheetName, address, value: cellValue };
  });
}
