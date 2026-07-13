import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import * as XLSX from "xlsx";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

/**
 * Reads an uploaded spreadsheet and returns each sheet as an HTML `<table>` via SheetJS's own
 * `sheet_to_html`, which respects the workbook's real merged-cell ranges (colspan/rowspan) — the
 * requirement is to look like the original file when opened, not a reflowed re-summary of its
 * content. `sheet_to_html` wraps its output in a full `<html><head>...` document; only the `<table>`
 * portion is kept since this gets embedded into an existing page via `dangerouslySetInnerHTML`.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    const url = request.nextUrl.searchParams.get("url");
    if (!url || !url.startsWith("/uploads/") || url.includes("..")) {
      return apiError("Đường dẫn tệp không hợp lệ.", 400);
    }

    const filePath = path.join(process.cwd(), "public", url);
    const buffer = await readFile(filePath);
    const workbook = XLSX.read(buffer, { type: "buffer", cellText: true });

    const DEFAULT_COL_WIDTH_PX = 48; // ~Excel's default column width when the file sets none

    const sheets = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const fullHtml = XLSX.utils.sheet_to_html(sheet, { editable: false });
      const tableHtml = fullHtml.match(/<table[\s\S]*<\/table>/)?.[0] ?? "";

      // This template defines no per-column widths (`!cols` is absent), so Excel itself falls back to
      // a uniform default width for every column, including the empty ones used purely for merge/
      // alignment spacing. An HTML table left to auto-size instead collapses empty <td>s toward zero
      // width, bunching content together in a way that doesn't match the original layout at all — a
      // fixed <colgroup> forces every column to reserve the same space Excel would.
      const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
      const columnCount = range ? range.e.c - range.s.c + 1 : 0;
      const colgroup = columnCount
        ? `<colgroup>${Array.from({ length: columnCount })
            .map(
              (_, i) =>
                `<col style="width:${(sheet["!cols"]?.[i]?.wpx ?? DEFAULT_COL_WIDTH_PX)}px">`
            )
            .join("")}</colgroup>`
        : "";

      const html = tableHtml
        .replace("<table", `<table style="table-layout:fixed;border-collapse:collapse"`)
        .replace(/(<table[^>]*>)/, `$1${colgroup}`);

      return { name: sheetName, html };
    });

    return apiSuccess({ sheets });
  } catch (error) {
    console.error("GET /api/attachments/preview failed:", error);
    return apiError("Không thể đọc tệp để xem trước.", 500);
  }
}
