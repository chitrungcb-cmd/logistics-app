import { describe, expect, it } from "vitest";
import {
  computeInvoiceVat,
  computePersonalAccountPayment,
  isManualQuoteSplit,
  resolveInvoiceAmountWithVat,
  resolveQuoteTotal,
} from "@/lib/personal-account-sync";

const lines = [
  { amount: 1_000_000, hasInvoice: true },
  { amount: 300_000, hasInvoice: false },
  { amount: 200_000, hasInvoice: false },
];

describe("quote total resolution", () => {
  it("sums the detail lines when nothing is entered manually", () => {
    const shipment = { quoteInvoiceAmount: null, quoteNoInvoiceAmount: null, quoteLines: lines };
    expect(isManualQuoteSplit(shipment)).toBe(false);
    expect(resolveQuoteTotal(shipment)).toBe(1_500_000);
  });

  it("adds 8% VAT to the invoiced part only, never to the non-invoiced part", () => {
    const shipment = { quoteInvoiceAmount: 2_000_000, quoteNoInvoiceAmount: 800_000, quoteLines: lines };
    expect(isManualQuoteSplit(shipment)).toBe(true);
    expect(resolveQuoteTotal(shipment)).toBe(2_160_000 + 800_000);
  });

  it("treats a blank field as 0 (not line-derived) while the other is entered manually", () => {
    const shipment = { quoteInvoiceAmount: 2_000_000, quoteNoInvoiceAmount: null, quoteLines: lines };
    expect(isManualQuoteSplit(shipment)).toBe(true);
    expect(resolveQuoteTotal(shipment)).toBe(2_160_000);
  });

  it("handles a shipment with no quote lines at all", () => {
    const shipment = { quoteInvoiceAmount: null, quoteNoInvoiceAmount: 500_000, quoteLines: [] };
    expect(resolveQuoteTotal(shipment)).toBe(500_000);
  });
});

describe("invoice VAT", () => {
  it("rounds to whole đồng so the two portions still add up to the stored total", () => {
    // 90.000.001 × 1,08 = 97.200.001,08 → phần lẻ bị làm tròn, VAT lấy đúng phần chênh lệch.
    expect(resolveInvoiceAmountWithVat(90_000_001)).toBe(97_200_001);
    expect(computeInvoiceVat(90_000_001)).toBe(7_200_000);
  });

  it("is 0 for a missing or zero invoiced part", () => {
    expect(resolveInvoiceAmountWithVat(null)).toBe(0);
    expect(computeInvoiceVat(null)).toBe(0);
    expect(computeInvoiceVat(0)).toBe(0);
  });

  it("uses the actual tax from an electronic invoice instead of forcing 8%", () => {
    expect(resolveInvoiceAmountWithVat(100_000_000, 10_000_000)).toBe(110_000_000);
    expect(computeInvoiceVat(100_000_000, 10_000_000)).toBe(10_000_000);
    expect(resolveQuoteTotal({
      quoteInvoiceAmount: 100_000_000,
      quoteInvoiceTaxAmount: 10_000_000,
      quoteNoInvoiceAmount: 5_000_000,
      quoteLines: [],
    })).toBe(115_000_000);
  });
});

describe("personal-account payment status from debt", () => {
  it("marks paid once the no-invoice debt payments cover the amount", () => {
    const result = computePersonalAccountPayment({
      amount: 45_112_000,
      noInvoicePayments: [
        { amount: 30_000_000, paymentDate: "2026-07-08" },
        { amount: 15_112_000, paymentDate: "2026-07-18" },
      ],
    });
    expect(result.paidStatus).toBe("paid");
    expect(result.paidAmount).toBe(45_112_000);
    expect(result.remainingAmount).toBe(0);
    // Ngày hiệu lực là khoản thu gần nhất trong Công nợ.
    expect(result.effectivePaymentDate?.slice(0, 10)).toBe("2026-07-18");
  });

  it("reports a partial collection", () => {
    const result = computePersonalAccountPayment({
      amount: 45_112_000,
      noInvoicePayments: [{ amount: 30_000_000, paymentDate: "2026-07-08" }],
    });
    expect(result.paidStatus).toBe("partial");
    expect(result.paidAmount).toBe(30_000_000);
    expect(result.remainingAmount).toBe(15_112_000);
  });

  it("stays unpaid and has no payment date when Công nợ has no payment", () => {
    const result = computePersonalAccountPayment({
      amount: 5_000_000,
      noInvoicePayments: [],
    });
    expect(result.paidStatus).toBe("unpaid");
    expect(result.paidAmount).toBe(0);
    expect(result.remainingAmount).toBe(5_000_000);
    expect(result.effectivePaymentDate).toBeNull();
  });
});
