import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readStoredFile } = vi.hoisted(() => ({ readStoredFile: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => ({ id: "test-user" })),
}));

vi.mock("@/lib/private-storage", () => ({
  privateObjectKeyFromUrl: vi.fn(() => null),
  readStoredFile,
}));

import { GET } from "@/app/api/attachments/preview/route";

describe("attachment spreadsheet preview", () => {
  beforeEach(() => {
    readStoredFile.mockReset();
  });

  it("preserves compact Excel column widths and limits the preview to the print area", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("TKN");
    sheet.getColumn(1).width = 0.2851563;
    sheet.getColumn(2).width = 4;
    sheet.getCell("A1").value = "Nhãn";
    sheet.getCell("A1").font = { name: "Tahoma", size: 8 };
    sheet.getCell("B2").value = "<script>alert(1)</script>";
    sheet.getCell("A3").value = "Ngoài vùng in";
    sheet.pageSetup.printArea = "A1:B2";
    sheet.views = [{ state: "normal", showGridLines: false }];
    readStoredFile.mockResolvedValue(Buffer.from(await workbook.xlsx.writeBuffer()));

    const response = await GET(new NextRequest("http://localhost/api/attachments/preview?url=/uploads/test.xlsx"));
    const payload = await response.json();
    const html = payload.data.sheets[0].html as string;
    const text = payload.data.sheets[0].text as string;

    expect(response.status).toBe(200);
    expect(html).toContain('style="width:30px;table-layout:fixed');
    expect(html).toContain('width:2px;min-width:2px;max-width:2px');
    expect(html).toContain("font-family:Tahoma, Arial, sans-serif");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("Ngoài vùng in");
    expect(text).toContain("Nhãn");
    expect(text).toContain("<script>alert(1)</script>");
    expect(text).not.toContain("Ngoài vùng in");
    expect(payload.data.sheets[0].showGridLines).toBe(false);
  });
});
