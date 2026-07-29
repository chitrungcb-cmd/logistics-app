import { describe, expect, it } from "vitest";
import { buildCopiedCostData, costCopySignature } from "@/lib/cost-copy";

describe("cost copy", () => {
  const source = {
    category: "VAN_TAI",
    customLabel: "  Vận tải đường bộ ",
    vendorId: "vendor-1",
    unitPrice: 23_000_000,
    quantity: 1,
    unit: "Chuyến",
    paidByUserId: "user-1",
    paidFromCompanyAccountId: null,
    note: "Theo hợp đồng",
  };

  it("detects the same cost regardless of label accents and spacing", () => {
    expect(costCopySignature(source)).toBe(
      costCopySignature({
        ...source,
        customLabel: "van   tai duong bo",
        unit: "chuyen",
      })
    );
  });

  it("keeps different vendors as different costs", () => {
    expect(costCopySignature(source)).not.toBe(costCopySignature({ ...source, vendorId: "vendor-2" }));
  });

  it("copies entry data but resets invoice, revenue and payment state", () => {
    expect(buildCopiedCostData(source, "target-1")).toMatchObject({
      shipmentId: "target-1",
      costPrice: 23_000_000,
      sellPrice: 0,
      isAdditional: false,
      invoiceNumber: null,
      attachmentUrl: null,
      isPaid: false,
      paidAt: null,
      presetId: null,
    });
  });
});
