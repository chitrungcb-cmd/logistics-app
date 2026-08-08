import { describe, expect, it } from "vitest";
import { computeProfit } from "@/lib/shipment-cost-constants";
import { summarizeInvoiceAmounts } from "@/lib/vendor-invoice-reconciliation";

describe("shipment profit formulas", () => {
  it("separates gross cash, VAT and profit before VAT", () => {
    const result = computeProfit(
      [
        { costPrice: 54_000_000, sellPrice: 0, isAdditional: false, isActual: true, inputTaxAmount: 4_000_000 },
        { costPrice: 10_000_000, sellPrice: 12_000_000, isAdditional: true, isActual: true, inputTaxAmount: 0 },
      ],
      // Quote lịch sử cố ý khác; khi đã có phân tách thuế thì phân tách mới là nguồn chuẩn.
      [{ quoteAmount: 999_000_000, createdAt: "2026-07-18" }],
      { quoteInvoiceAmount: 90_000_000, quoteInvoiceTaxAmount: 7_200_000, quoteNoInvoiceAmount: 45_112_000 }
    );

    expect(result.totalRevenueGross).toBe(154_312_000);
    expect(result.outputVat).toBe(7_200_000);
    expect(result.totalRevenueNet).toBe(147_112_000);
    expect(result.totalCostGross).toBe(64_000_000);
    expect(result.inputVat).toBe(4_000_000);
    expect(result.totalCostNet).toBe(60_000_000);
    expect(result.profitGross).toBe(90_312_000);
    expect(result.profitNet).toBe(87_112_000);
    expect(result.revenueVatSeparated).toBe(true);
  });

  it("excludes preset estimates that have not been confirmed", () => {
    const result = computeProfit(
      [{ costPrice: 999_000_000, sellPrice: 0, isAdditional: false, isActual: false }],
      [{ quoteAmount: 100_000_000, createdAt: "2026-07-18" }]
    );
    expect(result.totalCostGross).toBe(0);
    expect(result.profitGross).toBe(100_000_000);
    expect(result.revenueVatSeparated).toBe(false);
  });
});

describe("electronic invoice amount normalization", () => {
  it("keeps actual mixed VAT rates and exact invoice totals", () => {
    expect(summarizeInvoiceAmounts([
      { subtotal: 100_000_000, taxAmount: 10_000_000, totalAmount: 110_000_000 },
      { subtotal: 50_000_000, taxAmount: 4_000_000, totalAmount: 54_000_000 },
    ])).toEqual({ subtotal: 150_000_000, taxAmount: 14_000_000, totalAmount: 164_000_000 });
  });

  it("derives only the missing component without applying a guessed rate", () => {
    expect(summarizeInvoiceAmounts([
      { subtotal: 100_000_000, taxAmount: null, totalAmount: 105_000_000 },
    ])).toEqual({ subtotal: 100_000_000, taxAmount: 5_000_000, totalAmount: 105_000_000 });
  });
});
