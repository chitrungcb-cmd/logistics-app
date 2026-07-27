import { describe, expect, it } from "vitest";
import { summarizeDebts } from "@/lib/debt-summary";

describe("summarizeDebts", () => {
  it("calculates totals for only the supplied filtered rows", () => {
    expect(
      summarizeDebts([
        {
          totalAmount: 372_000_000,
          paidAmount: 0,
          remainingAmount: 372_000_000,
          splitBreakdown: null,
        },
        {
          totalAmount: 325_000_000,
          paidAmount: 25_000_000,
          remainingAmount: 300_000_000,
          splitBreakdown: null,
        },
      ])
    ).toMatchObject({
      count: 2,
      totalAmount: 697_000_000,
      paidAmount: 25_000_000,
      remainingAmount: 672_000_000,
    });
  });

  it("keeps invoice and non-invoice totals separate", () => {
    expect(
      summarizeDebts([
        {
          totalAmount: 142_312_000,
          paidAmount: 45_112_000,
          remainingAmount: 97_200_000,
          splitBreakdown: {
            invoiceAmount: 97_200_000,
            noInvoiceAmount: 45_112_000,
            paidInvoice: 0,
            paidNoInvoice: 45_112_000,
            remainingInvoice: 97_200_000,
            remainingNoInvoice: 0,
          },
        },
      ])
    ).toMatchObject({
      splitCount: 1,
      invoiceAmount: 97_200_000,
      noInvoiceAmount: 45_112_000,
      paidInvoice: 0,
      paidNoInvoice: 45_112_000,
      remainingInvoice: 97_200_000,
      remainingNoInvoice: 0,
    });
  });
});
