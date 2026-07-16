import { NextRequest } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const MAX_PREVIEW_SHEETS = 20;
const MAX_PREVIEW_ROWS = 2_000;
const MAX_PREVIEW_COLUMNS = 128;

export const runtime = "nodejs";

type MergeCell = { covered: boolean; rowSpan: number; colSpan: number };

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
  return `${width}px ${lineStyle} ${colorToCss(border.color) ?? "#d1d5db"}`;
}

function cellStyle(cell: ExcelJS.Cell) {
  const styles: string[] = [];
  const font = cell.font;
  const alignment = cell.alignment;
  const borders = cell.border;

  if (font?.bold) styles.push("font-weight:700");
  if (font?.italic) styles.push("font-style:italic");
  if (font?.size && Number.isFinite(font.size)) {
    styles.push(`font-size:${Math.max(6, Math.min(48, font.size))}pt`);
  }
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

function buildMergeMap(sheet: ExcelJS.Worksheet) {
  const map = new Map<string, MergeCell>();
  for (const range of sheet.model.merges ?? []) {
    const [startRaw, endRaw] = range.split(":");
    const start = parseAddress(startRaw);
    const end = parseAddress(endRaw ?? startRaw);
    if (!start || !end) continue;

    const rowSpan = end.row - start.row + 1;
    const colSpan = end.column - start.column + 1;
    if (rowSpan <= 0 || colSpan <= 0) continue;

    for (let row = start.row; row <= end.row; row++) {
      for (let column = start.column; column <= end.column; column++) {
        const isMaster = row === start.row && column === start.column;
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

function worksheetToSafeHtml(sheet: ExcelJS.Worksheet) {
  if (sheet.rowCount > MAX_PREVIEW_ROWS || sheet.columnCount > MAX_PREVIEW_COLUMNS) {
    throw new Error("Bảng tính vượt quá giới hạn xem trước an toàn.");
  }

  const rowCount = Math.max(sheet.rowCount, 1);
  const columnCount = Math.max(sheet.columnCount, 1);
  const mergeMap = buildMergeMap(sheet);
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const width = sheet.getColumn(index + 1).width ?? 7;
    const pixelWidth = Math.max(36, Math.min(280, Math.round(width * 7)));
    return `<col style="width:${pixelWidth}px">`;
  }).join("");

  const rows: string[] = [];
  for (let rowNumber = 1; rowNumber <= rowCount; rowNumber++) {
    const cells: string[] = [];
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber++) {
      const merge = mergeMap.get(`${rowNumber}:${columnNumber}`);
      if (merge?.covered) continue;

      const attributes = [
        merge && merge.rowSpan > 1 ? ` rowspan="${merge.rowSpan}"` : "",
        merge && merge.colSpan > 1 ? ` colspan="${merge.colSpan}"` : "",
      ].join("");
      const cell = sheet.getCell(rowNumber, columnNumber);
      const value = escapeHtml(cellText(cell));
      const style = cellStyle(cell);
      cells.push(`<td${attributes}${style ? ` style="${style}"` : ""}>${value}</td>`);
    }
    const height = sheet.getRow(rowNumber).height;
    const rowStyle = height && Number.isFinite(height)
      ? ` style="height:${Math.max(12, Math.min(240, Math.round(height * 1.333)))}px"`
      : "";
    rows.push(`<tr${rowStyle}>${cells.join("")}</tr>`);
  }

  return `<table style="table-layout:fixed;border-collapse:collapse"><colgroup>${columns}</colgroup><tbody>${rows.join("")}</tbody></table>`;
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
    if (!url || !url.startsWith("/uploads/") || url.includes("..") || !url.toLowerCase().endsWith(".xlsx")) {
      return apiError("Đường dẫn tệp không hợp lệ.", 400);
    }

    const uploadRoot = path.resolve(process.cwd(), "public", "uploads");
    const filePath = path.resolve(process.cwd(), "public", `.${url}`);
    if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) {
      return apiError("Đường dẫn tệp không hợp lệ.", 400);
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_PREVIEW_BYTES) {
      return apiError("Tệp trống hoặc vượt quá 10MB.", 400);
    }

    const workbook = new ExcelJS.Workbook();
    // ExcelJS bundles Buffer typings from an older @types/node release; runtime accepts Node Buffer.
    await workbook.xlsx.load((await readFile(filePath)) as never);
    if (workbook.worksheets.length > MAX_PREVIEW_SHEETS) {
      return apiError("Tệp có quá nhiều trang tính.", 400);
    }

    const sheets = workbook.worksheets.map((sheet) => ({
      name: sheet.name,
      html: worksheetToSafeHtml(sheet),
    }));

    return apiSuccess({ sheets });
  } catch (error) {
    console.error("GET /api/attachments/preview failed:", error);
    return apiError("Không thể đọc tệp để xem trước.", 400);
  }
}
