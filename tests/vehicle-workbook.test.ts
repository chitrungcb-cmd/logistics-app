import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { extractVehiclesFromWorkbook } from "@/lib/vehicle-workbook";

describe("vehicle workbook search index", () => {
  it("extracts chassis and engine numbers from the automobile attachment format", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow([
      "STT",
      "Nhãn hiệu",
      "Tên thương mại",
      "Màu xe",
      "Số khung",
      "Số động cơ",
    ]);
    sheet.addRow([
      1,
      "CNHTC",
      "ZZ5257GJBN4347E1",
      "Trắng",
      " lzz1blsf4tn609259 ",
      " d103850260607008737 ",
    ]);
    sheet.addRow([
      2,
      "CNHTC",
      "ZZ5257GJBN4347E1",
      "Trắng",
      "LZZ1BLSF0TN609260",
      "D103850260607027437",
    ]);

    const result = await extractVehiclesFromWorkbook(
      Buffer.from(await workbook.xlsx.writeBuffer())
    );

    expect(result).toEqual({
      matchedVehicleSheet: true,
      vehicles: [
        {
          chassisNo: "LZZ1BLSF4TN609259",
          engineNo: "D103850260607008737",
        },
        {
          chassisNo: "LZZ1BLSF0TN609260",
          engineNo: "D103850260607027437",
        },
      ],
    });
  });

  it("does not treat an ordinary declaration workbook as a vehicle list", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("TKN");
    sheet.addRow(["Số tờ khai", "Tên hàng", "Số invoice"]);
    sheet.addRow(["108470288730", "10 TRỘN", "YN26B504XS-2"]);

    const result = await extractVehiclesFromWorkbook(
      Buffer.from(await workbook.xlsx.writeBuffer())
    );

    expect(result).toEqual({
      matchedVehicleSheet: false,
      vehicles: [],
    });
  });
});
