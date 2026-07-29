import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  cellContainsFormula,
  coerceHysCellValue,
  normalizeHysCellChanges,
  parseHysCellAddress,
} from "@/lib/hys-workbook";

describe("HYS workbook editing", () => {
  it("accepts only cells inside the browser editor safety limit", () => {
    expect(parseHysCellAddress(" b12 ")).toEqual({
      address: "B12",
      column: 2,
      row: 12,
    });
    expect(parseHysCellAddress("DX2000")).toEqual({
      address: "DX2000",
      column: 128,
      row: 2000,
    });
    expect(parseHysCellAddress("DY1")).toBeNull();
    expect(parseHysCellAddress("A2001")).toBeNull();
  });

  it("keeps chassis numbers as text and preserves numeric/date cell types", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("HYS");

    sheet.getCell("A1").value = "LZZ12345678901234";
    sheet.getCell("B1").value = 1_250_000;
    sheet.getCell("C1").value = new Date(2026, 6, 29);

    expect(coerceHysCellValue(sheet.getCell("A1"), "001234567890123456")).toBe(
      "001234567890123456"
    );
    expect(coerceHysCellValue(sheet.getCell("B1"), "2.500.000")).toBe(2_500_000);
    expect(coerceHysCellValue(sheet.getCell("C1"), "30/07/2026")).toEqual(
      new Date(2026, 6, 30)
    );
  });

  it("protects formulas and rejects duplicate client changes", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("HYS");
    sheet.getCell("A1").value = { formula: "1+1", result: 2 };

    expect(cellContainsFormula(sheet.getCell("A1"))).toBe(true);
    expect(() =>
      normalizeHysCellChanges([
        { sheetName: "HYS", address: "A1", value: "1" },
        { sheetName: "HYS", address: "a1", value: "2" },
      ])
    ).toThrow("Ô A1 bị gửi lặp lại.");
  });
});
