import { describe, expect, it } from "vitest";
import { normalizeShipmentVehicles } from "@/lib/shipment-vehicles";

describe("shipment vehicle identifiers", () => {
  it("normalizes casing and whitespace for reliable lookup", () => {
    expect(
      normalizeShipmentVehicles([
        { chassisNo: " lzz1clvb 2ra123456 ", engineNo: " wd615-96e " },
      ])
    ).toEqual([
      { chassisNo: "LZZ1CLVB2RA123456", engineNo: "WD615-96E" },
    ]);
  });

  it("keeps a row when either chassis or engine number is available", () => {
    expect(
      normalizeShipmentVehicles([
        { chassisNo: "VIN001", engineNo: "" },
        { chassisNo: "", engineNo: "ENG002" },
        { chassisNo: "", engineNo: "" },
      ])
    ).toEqual([
      { chassisNo: "VIN001", engineNo: null },
      { chassisNo: null, engineNo: "ENG002" },
    ]);
  });

  it("rejects duplicate identifiers inside one shipment", () => {
    expect(() =>
      normalizeShipmentVehicles([
        { chassisNo: "VIN001", engineNo: "ENG001" },
        { chassisNo: "vin001", engineNo: "ENG002" },
      ])
    ).toThrow("Số khung VIN001 đang bị nhập trùng trong lô.");
  });

  it("rejects malformed vehicle rows", () => {
    expect(() => normalizeShipmentVehicles("VIN001")).toThrow(
      "Danh sách số khung, số máy không hợp lệ."
    );
  });
});
