import { describe, expect, it } from "vitest";
import { buildCostVarianceReport, type CostVarianceInput } from "@/lib/cost-variance-report";

function cost(overrides: Partial<CostVarianceInput>): CostVarianceInput {
  return {
    id: "cost-1",
    shipmentId: "shipment-1",
    category: "VAN_TAI",
    customLabel: null,
    unit: "Chuyến",
    unitPrice: 10_000_000,
    quantity: 1,
    costPrice: 10_000_000,
    vendorName: "Nhà xe A",
    declarationNo: "10001",
    declarationDate: "2026-07-01",
    customerName: "Công ty A",
    goodsName: "10 MÁY NGHIỀN ĐÁ",
    port: "Hữu Nghị",
    ...overrides,
  };
}

describe("cost variance report", () => {
  it("compares the same goods, category and unit across different shipments", () => {
    const report = buildCostVarianceReport([
      cost({ id: "a", shipmentId: "s1", unitPrice: 10_000_000, costPrice: 10_000_000 }),
      cost({ id: "b", shipmentId: "s2", unitPrice: 15_000_000, costPrice: 15_000_000 }),
    ], 30);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      goodsKeyword: "MÁY NGHIỀN",
      minUnitPrice: 10_000_000,
      maxUnitPrice: 15_000_000,
      variancePercent: 50,
      shipmentCount: 2,
    });
  });

  it("does not compare costs with different units", () => {
    const report = buildCostVarianceReport([
      cost({ id: "a", shipmentId: "s1", unit: "Xe", unitPrice: 1_000_000, costPrice: 1_000_000 }),
      cost({ id: "b", shipmentId: "s2", unit: "Lô", unitPrice: 15_000_000, costPrice: 15_000_000 }),
    ], 0);

    expect(report.rows).toHaveLength(0);
  });

  it("requires at least two distinct shipments and respects the threshold", () => {
    const sameShipment = buildCostVarianceReport([
      cost({ id: "a", shipmentId: "s1", unitPrice: 10 }),
      cost({ id: "b", shipmentId: "s1", unitPrice: 20 }),
    ], 0);
    const belowThreshold = buildCostVarianceReport([
      cost({ id: "c", shipmentId: "s1", unitPrice: 100, costPrice: 100 }),
      cost({ id: "d", shipmentId: "s2", unitPrice: 119, costPrice: 119 }),
    ], 20);

    expect(sameShipment.rows).toHaveLength(0);
    expect(belowThreshold.rows).toHaveLength(0);
  });
});
