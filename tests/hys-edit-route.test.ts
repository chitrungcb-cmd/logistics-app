import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findShipment: vi.fn(),
  findLatestShipment: vi.fn(),
  updateShipment: vi.fn(),
  readStoredFile: vi.fn(),
  saveUploadedFile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shipment: { findUnique: mocks.findShipment },
    $transaction: vi.fn(async (callback) =>
      callback({
        shipment: {
          findUnique: mocks.findLatestShipment,
          update: mocks.updateShipment,
        },
      })
    ),
  },
}));

vi.mock("@/lib/private-storage", () => ({
  readStoredFile: mocks.readStoredFile,
}));

vi.mock("@/lib/save-upload", () => ({
  saveUploadedFile: mocks.saveUploadedFile,
}));

import { POST } from "@/app/api/shipments/[id]/attachments/hys/route";

const currentHys = {
  name: "HYS-oto.xlsx",
  url: "/uploads/current-hys.xlsx",
  uploadedAt: "2026-07-28T00:00:00.000Z",
};
const invoice = {
  name: "invoice.pdf",
  url: "/uploads/invoice.pdf",
  uploadedAt: "2026-07-28T00:00:00.000Z",
};

describe("HYS attachment replacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findShipment.mockResolvedValue({
      id: "shipment-1",
      attachments: [currentHys, invoice],
    });
    mocks.findLatestShipment.mockResolvedValue({
      attachments: [currentHys, invoice],
    });
    mocks.updateShipment.mockResolvedValue({ id: "shipment-1" });
  });

  it("changes only selected cells and replaces the current HYS reference without history", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("HYS");
    sheet.getCell("A1").value = "SỐ KHUNG CŨ";
    sheet.getCell("A1").font = { bold: true, name: "Tahoma" };
    sheet.getCell("A1").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFF00" },
    };
    sheet.getCell("B1").value = { formula: "1+1", result: 2 };
    mocks.readStoredFile.mockResolvedValue(
      Buffer.from(await workbook.xlsx.writeBuffer())
    );

    let savedBuffer: Buffer | null = null;
    mocks.saveUploadedFile.mockImplementation(async (_name: string, buffer: Buffer) => {
      savedBuffer = buffer;
      return { name: currentHys.name, url: "/uploads/new-hys.xlsx" };
    });

    const request = new NextRequest(
      "http://localhost/api/shipments/shipment-1/attachments/hys",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attachmentUrl: currentHys.url,
          changes: [{ sheetName: "HYS", address: "A1", value: "SỐ KHUNG MỚI" }],
        }),
      }
    );
    const response = await POST(request, {
      params: Promise.resolve({ id: "shipment-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.attachment.url).toBe("/uploads/new-hys.xlsx");
    const updatedAttachments = mocks.updateShipment.mock.calls[0][0].data.attachments;
    expect(updatedAttachments).toHaveLength(2);
    expect(updatedAttachments[0].url).toBe("/uploads/new-hys.xlsx");
    expect(updatedAttachments.some((item: { url: string }) => item.url === currentHys.url)).toBe(false);
    expect(updatedAttachments[1]).toEqual(invoice);

    const savedWorkbook = new ExcelJS.Workbook();
    await savedWorkbook.xlsx.load(savedBuffer as never);
    const savedSheet = savedWorkbook.getWorksheet("HYS");
    expect(savedSheet?.getCell("A1").value).toBe("SỐ KHUNG MỚI");
    expect(savedSheet?.getCell("A1").font.bold).toBe(true);
    expect(savedSheet?.getCell("A1").fill).toMatchObject({
      type: "pattern",
      pattern: "solid",
    });
    expect(savedSheet?.getCell("B1").value).toMatchObject({
      formula: "1+1",
      result: 2,
    });
  });
});
