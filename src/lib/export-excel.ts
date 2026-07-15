"use client";

import ExcelJS from "exceljs";

export type ExcelSheet = {
  name: string;
  rows: Array<Record<string, unknown>>;
};

function safeCellValue(value: unknown) {
  if (value instanceof Date || typeof value === "number" || typeof value === "boolean") return value;
  const text = value == null ? "" : String(value);
  // Prevent spreadsheet-formula injection when exported business data starts with one of Excel's
  // formula control characters. The leading apostrophe is not displayed by Excel.
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export async function downloadExcel(filename: string, sheets: ExcelSheet[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NQ Logistics";
  workbook.created = new Date();

  for (const source of sheets) {
    const sheet = workbook.addWorksheet(source.name.slice(0, 31));
    const headers = [...new Set(source.rows.flatMap((row) => Object.keys(row)))];
    if (headers.length === 0) continue;

    sheet.addRow(headers);
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: "middle" };

    for (const row of source.rows) {
      sheet.addRow(headers.map((header) => safeCellValue(row[header])));
    }

    sheet.columns = headers.map((header, index) => {
      let width = Math.max(10, header.length + 2);
      for (let row = 2; row <= Math.min(sheet.rowCount, 1_000); row++) {
        width = Math.max(width, Math.min(42, sheet.getCell(row, index + 1).text.length + 2));
      }
      return { width: Math.min(width, 42) };
    });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
