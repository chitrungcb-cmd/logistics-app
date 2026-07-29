import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { cellContainsFormula } from "@/lib/hys-workbook";
import { privateObjectKeyFromUrl, readStoredFile } from "@/lib/private-storage";

const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const MAX_PREVIEW_SHEETS = 20;
const MAX_PREVIEW_ROWS = 2_000;
const MAX_PREVIEW_COLUMNS = 128;

export const runtime = "nodejs";

type MergeCell = { covered: boolean; rowSpan: number; colSpan: number };
type PreviewBounds = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

function cellText(cell: ExcelJS.Cell) {
  if (cell.isMerged && cell.master !== cell) return "";
  try {
    return cell.text ?? "";
  } catch {
    const value = cell.value;
    if (value == null) return "";
    if (value instanceof Date) return value.toLocaleDateString("vi-VN");
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (typeof value === "object" && "result" in value && value.result != null) {
      return String(value.result);
    }
    if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if (typeof value === "object" && "text" in value && typeof value.text === "string") {
      return value.text;
    }
    return "";
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function colorToCss(color?: Partial<ExcelJS.Color>) {
  const argb = color?.argb;
  if (!argb || !/^[0-9a-f]{8}$/i.test(argb)) return null;
  return `#${argb.slice(2)}`;
}

function fontFamilyToCss(name?: string) {
  const normalized = name?.trim().toLowerCase();
  const knownFamilies: Record<string, string> = {
    arial: "Arial, sans-serif",
    calibri: "Calibri, Arial, sans-serif",
    "courier new": "\"Courier New\", monospace",
    "free 3 of 9": "\"Times New Roman\", serif",
    tahoma: "Tahoma, Arial, sans-serif",
    "times new roman": "\"Times New Roman\", serif",
  };
  return normalized ? knownFamilies[normalized] ?? null : null;
}

function borderToCss(border?: Partial<ExcelJS.Border>) {
  if (!border?.style) return null;

  const width = ["medium", "mediumDashed", "mediumDashDot", "mediumDashDotDot"].includes(border.style)
    ? 2
    : ["thick", "double"].includes(border.style)
      ? 3
      : 1;
  const lineStyle = ["dotted", "hair"].includes(border.style)
    ? "dotted"
    : ["dashed", "mediumDashed", "dashDot", "dashDotDot", "slantDashDot", "mediumDashDot", "mediumDashDotDot"].includes(border.style)
      ? "dashed"
      : border.style === "double"
        ? "double"
        : "solid";
  return `${width}px ${lineStyle} ${colorToCss(border.color) ?? "#111827"}`;
}

function cellStyle(cell: ExcelJS.Cell) {
  const styles: string[] = [];
  const font = cell.font;
  const alignment = cell.alignment;
  const borders = cell.border;
  const isBarcodeFont = font?.name?.trim().toLowerCase() === "free 3 of 9";

  const fontFamily = fontFamilyToCss(font?.name);
  if (fontFamily) styles.push(`font-family:${fontFamily}`);
  if (font?.bold) styles.push("font-weight:700");
  if (font?.italic) styles.push("font-style:italic");
  if (font?.size && Number.isFinite(font.size)) {
    const fontSize = isBarcodeFont ? font.size * 0.75 : font.size;
    styles.push(`font-size:${Math.max(6, Math.min(48, fontSize))}pt`);
  }
  if (isBarcodeFont) styles.push("letter-spacing:-0.5px", "overflow:hidden");
  const fontColor = colorToCss(font?.color);
  if (fontColor) styles.push(`color:${fontColor}`);

  const decorations: string[] = [];
  if (font?.underline && font.underline !== "none") decorations.push("underline");
  if (font?.strike) decorations.push("line-through");
  if (decorations.length > 0) styles.push(`text-decoration:${decorations.join(" ")}`);

  if (cell.fill?.type === "pattern" && cell.fill.pattern !== "none") {
    const backgroundColor = colorToCss(cell.fill.fgColor ?? cell.fill.bgColor);
    if (backgroundColor) styles.push(`background-color:${backgroundColor}`);
  }

  if (alignment?.horizontal && ["left", "center", "right", "justify"].includes(alignment.horizontal)) {
    styles.push(`text-align:${alignment.horizontal}`);
  }
  if (alignment?.vertical) {
    const vertical = alignment.vertical === "middle" ? "middle" : alignment.vertical === "bottom" ? "bottom" : "top";
    styles.push(`vertical-align:${vertical}`);
  }
  styles.push(alignment?.wrapText ? "white-space:normal" : "white-space:nowrap");
  if (alignment?.indent && Number.isFinite(alignment.indent)) {
    styles.push(`padding-left:${Math.max(0, Math.min(20, alignment.indent)) * 10 + 6}px`);
  }
  styles.push("line-height:1.15");

  const borderEntries: Array<[string, Partial<ExcelJS.Border> | undefined]> = [
    ["top", borders?.top],
    ["right", borders?.right],
    ["bottom", borders?.bottom],
    ["left", borders?.left],
  ];
  for (const [side, border] of borderEntries) {
    const css = borderToCss(border);
    if (css) styles.push(`border-${side}:${css}`);
  }

  return styles.join(";");
}

function columnNumber(letters: string) {
  let value = 0;
  for (const letter of letters) {
    value = value * 26 + letter.charCodeAt(0) - 64;
  }
  return value;
}

function parseAddress(address: string) {
  const match = address.replaceAll("$", "").toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return { column: columnNumber(match[1]), row: Number(match[2]) };
}

function previewBounds(sheet: ExcelJS.Worksheet): PreviewBounds {
  const fallback = {
    startRow: 1,
    endRow: Math.max(sheet.rowCount, 1),
    startColumn: 1,
    endColumn: Math.max(sheet.columnCount, 1),
  };
  const firstPrintArea = sheet.pageSetup.printArea?.split("&&")[0];
  if (!firstPrintArea) return fallback;

  const cellRange = firstPrintArea.slice(firstPrintArea.lastIndexOf("!") + 1);
  const [startRaw, endRaw] = cellRange.split(":");
  const start = parseAddress(startRaw);
  const end = parseAddress(endRaw ?? startRaw);
  if (!start || !end || end.row < start.row || end.column < start.column) return fallback;

  const endRow = Math.min(end.row, Math.max(sheet.rowCount, 1));
  const endColumn = Math.min(end.column, Math.max(sheet.columnCount, 1));
  if (endRow < start.row || endColumn < start.column) return fallback;

  return {
    startRow: start.row,
    endRow,
    startColumn: start.column,
    endColumn,
  };
}

function buildMergeMap(sheet: ExcelJS.Worksheet, bounds: PreviewBounds) {
  const map = new Map<string, MergeCell>();
  for (const range of sheet.model.merges ?? []) {
    const [startRaw, endRaw] = range.split(":");
    const start = parseAddress(startRaw);
    const end = parseAddress(endRaw ?? startRaw);
    if (!start || !end) continue;

    const clippedStartRow = Math.max(start.row, bounds.startRow);
    const clippedEndRow = Math.min(end.row, bounds.endRow);
    const clippedStartColumn = Math.max(start.column, bounds.startColumn);
    const clippedEndColumn = Math.min(end.column, bounds.endColumn);
    const rowSpan = clippedEndRow - clippedStartRow + 1;
    const colSpan = clippedEndColumn - clippedStartColumn + 1;
    if (rowSpan <= 0 || colSpan <= 0) continue;

    for (let row = clippedStartRow; row <= clippedEndRow; row++) {
      for (let column = clippedStartColumn; column <= clippedEndColumn; column++) {
        const isMaster = row === clippedStartRow && column === clippedStartColumn;
        map.set(`${row}:${column}`, {
          covered: !isMaster,
          rowSpan: isMaster ? rowSpan : 1,
          colSpan: isMaster ? colSpan : 1,
        });
      }
    }
  }
  return map;
}

function excelColumnWidthToPixels(width: number) {
  // Excel stores column widths as character units. Seven pixels per unit matches its
  // default font metric and, importantly, keeps the form's narrow spacer columns narrow.
  return Math.max(1, Math.min(280, Math.round(width * 7)));
}

function worksheetToSafeHtml(sheet: ExcelJS.Worksheet) {
  const bounds = previewBounds(sheet);
  const rowCount = bounds.endRow - bounds.startRow + 1;
  const columnCount = bounds.endColumn - bounds.startColumn + 1;
  if (rowCount > MAX_PREVIEW_ROWS || columnCount > MAX_PREVIEW_COLUMNS) {
    throw new Error("Bảng tính vượt quá giới hạn xem trước an toàn.");
  }

  const mergeMap = buildMergeMap(sheet, bounds);
  const columnWidths = Array.from({ length: columnCount }, (_, index) => {
    const column = sheet.getColumn(bounds.startColumn + index);
    const width = column.width ?? sheet.properties.defaultColWidth ?? 8.43;
    return column.hidden ? 0 : excelColumnWidthToPixels(width);
  });
  const columns = columnWidths.map((pixelWidth) => {
    return `<col style="width:${pixelWidth}px;min-width:${pixelWidth}px;max-width:${pixelWidth}px">`;
  }).join("");
  const tableWidth = columnWidths.reduce((total, width) => total + width, 0);

  const rows: string[] = [];
  for (let rowNumber = bounds.startRow; rowNumber <= bounds.endRow; rowNumber++) {
    const cells: string[] = [];
    for (let columnNumber = bounds.startColumn; columnNumber <= bounds.endColumn; columnNumber++) {
      const merge = mergeMap.get(`${rowNumber}:${columnNumber}`);
      if (merge?.covered) continue;

      const attributes = [
        merge && merge.rowSpan > 1 ? ` rowspan="${merge.rowSpan}"` : "",
        merge && merge.colSpan > 1 ? ` colspan="${merge.colSpan}"` : "",
      ].join("");
      const cell = sheet.getCell(rowNumber, columnNumber);
      const value = escapeHtml(cellText(cell));
      const style = cellStyle(cell);
      const canEdit = !cellContainsFormula(cell);
      cells.push(
        `<td${attributes} data-cell-address="${cell.address}" data-editable="${canEdit ? "true" : "false"}"${style ? ` style="${style}"` : ""}>${value}</td>`
      );
    }
    const height = sheet.getRow(rowNumber).height;
    const rowStyle = height && Number.isFinite(height)
      ? ` style="height:${Math.max(12, Math.min(240, Math.round(height * 1.333)))}px"`
      : "";
    rows.push(`<tr${rowStyle}>${cells.join("")}</tr>`);
  }

  return `<table style="width:${tableWidth}px;table-layout:fixed;border-collapse:collapse"><colgroup>${columns}</colgroup><tbody>${rows.join("")}</tbody></table>`;
}

function worksheetToPlainText(sheet: ExcelJS.Worksheet) {
  const bounds = previewBounds(sheet);
  const rows: string[] = [];

  for (let rowNumber = bounds.startRow; rowNumber <= bounds.endRow; rowNumber++) {
    const cells: string[] = [];
    for (let columnNumber = bounds.startColumn; columnNumber <= bounds.endColumn; columnNumber++) {
      cells.push(cellText(sheet.getCell(rowNumber, columnNumber)));
    }
    while (cells.at(-1) === "") cells.pop();
    rows.push(cells.join("\t"));
  }

  while (rows[0] === "") rows.shift();
  while (rows.at(-1) === "") rows.pop();
  return rows.join("\n");
}

/**
 * Returns a safe HTML preview of an authenticated local XLSX attachment. Cell values are escaped
 * before insertion, so a workbook received through email cannot inject scripts into the app.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    const url = request.nextUrl.searchParams.get("url");
    const isLegacyUpload = url?.startsWith("/uploads/") && !url.includes("..");
    const isPrivateUpload = url ? privateObjectKeyFromUrl(url) !== null : false;
    if (!url || (!isLegacyUpload && !isPrivateUpload) || !url.toLowerCase().endsWith(".xlsx")) {
      return apiError("Đường dẫn tệp không hợp lệ.", 400);
    }

    const workbook = new ExcelJS.Workbook();
    // ExcelJS bundles Buffer typings from an older @types/node release; runtime accepts Node Buffer.
    await workbook.xlsx.load((await readStoredFile(url, MAX_PREVIEW_BYTES)) as never);
    if (workbook.worksheets.length > MAX_PREVIEW_SHEETS) {
      return apiError("Tệp có quá nhiều trang tính.", 400);
    }

    const sheets = workbook.worksheets.map((sheet) => ({
      name: sheet.name,
      html: worksheetToSafeHtml(sheet),
      text: worksheetToPlainText(sheet),
      showGridLines: sheet.views[0]?.showGridLines !== false,
    }));

    return apiSuccess({ sheets });
  } catch (error) {
    console.error("GET /api/attachments/preview failed:", error);
    return apiError("Không thể đọc tệp để xem trước.", 400);
  }
}
