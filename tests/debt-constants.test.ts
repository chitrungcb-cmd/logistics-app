import { describe, expect, it } from "vitest";
import {
  computeDebtStatus,
  computeInvoiceSplitBreakdown,
  hasInvoiceSplit,
  isOverdue,
  sumPayments,
  sumPaymentsByPortion,
  validatePaymentAmount,
} from "@/lib/debt-constants";

describe("debt calculations", () => {
  it("derives status only from total and payments", () => {
    expect(computeDebtStatus(100, 0)).toBe("UNPAID");
    expect(computeDebtStatus(100, 40)).toBe("PARTIAL");
    expect(computeDebtStatus(100, 100)).toBe("PAID");
    expect(computeDebtStatus(100, 120)).toBe("PAID");
  });

  it("sums payments without rounding away values", () => {
    expect(sumPayments([{ amount: 12_500 }, { amount: 7_500 }])).toBe(20_000);
  });

  it("does not report a paid debt as overdue", () => {
    expect(isOverdue("PAID", new Date(0))).toBe(false);
    expect(isOverdue("UNPAID", new Date(0))).toBe(true);
  });
});

describe("invoice-split debts", () => {
  it("treats a debt with neither portion set as un-split", () => {
    expect(hasInvoiceSplit({ invoiceAmount: null, noInvoiceAmount: null })).toBe(false);
    expect(hasInvoiceSplit({ invoiceAmount: 0, noInvoiceAmount: null })).toBe(true);
    expect(computeInvoiceSplitBreakdown({ invoiceAmount: null, noInvoiceAmount: null, payments: [] })).toBeNull();
  });

  it("only counts payments tagged with the matching portion", () => {
    const payments = [
      { amount: 30_000, portion: "INVOICE" },
      { amount: 20_000, portion: "NO_INVOICE" },
      { amount: 5_000, portion: null },
    ];
    expect(sumPaymentsByPortion(payments, "INVOICE")).toBe(30_000);
    expect(sumPaymentsByPortion(payments, "NO_INVOICE")).toBe(20_000);
  });

  it("computes remaining per portion independently", () => {
    const breakdown = computeInvoiceSplitBreakdown({
      invoiceAmount: 90_000,
      noInvoiceAmount: 45_000,
      payments: [
        { amount: 90_000, portion: "INVOICE" },
        { amount: 15_000, portion: "NO_INVOICE" },
      ],
    });
    expect(breakdown).toEqual({
      invoiceAmount: 90_000,
      noInvoiceAmount: 45_000,
      paidInvoice: 90_000,
      paidNoInvoice: 15_000,
      remainingInvoice: 0,
      remainingNoInvoice: 30_000,
    });
  });
});

describe("payment amount validation", () => {
  const splitDebt = {
    totalAmount: 135_000,
    invoiceAmount: 90_000,
    noInvoiceAmount: 45_000,
    payments: [
      { id: "p1", amount: 20_000, portion: "INVOICE" },
      { id: "p2", amount: 30_000, portion: "NO_INVOICE" },
    ],
  };

  it("caps a new payment at the remaining of its own portion", () => {
    expect(validatePaymentAmount(splitDebt, 70_000, "INVOICE")).toEqual({ portion: "INVOICE" });
    expect(validatePaymentAmount(splitDebt, 70_001, "INVOICE")).toHaveProperty("error");
    // Phần không hóa đơn còn 15.000 dù phần có hóa đơn còn nhiều — hai phần độc lập.
    expect(validatePaymentAmount(splitDebt, 20_000, "NO_INVOICE")).toHaveProperty("error");
  });

  it("requires a portion on a split debt and refuses an unknown one", () => {
    expect(validatePaymentAmount(splitDebt, 1_000, undefined)).toHaveProperty("error");
    expect(validatePaymentAmount(splitDebt, 1_000, "BOTH")).toHaveProperty("error");
  });

  it("excludes the payment being edited so raising its own amount is not blocked", () => {
    // Sửa p2 (30.000, không hóa đơn) thành 45.000 = đúng bằng cả phần đó → phải hợp lệ.
    expect(validatePaymentAmount(splitDebt, 45_000, "NO_INVOICE", "p2")).toEqual({ portion: "NO_INVOICE" });
    expect(validatePaymentAmount(splitDebt, 45_001, "NO_INVOICE", "p2")).toHaveProperty("error");
  });

  it("falls back to the grand total on an un-split debt", () => {
    const debt = {
      totalAmount: 100_000,
      invoiceAmount: null,
      noInvoiceAmount: null,
      payments: [{ id: "p1", amount: 40_000, portion: null }],
    };
    expect(validatePaymentAmount(debt, 60_000, undefined)).toEqual({ portion: null });
    expect(validatePaymentAmount(debt, 60_001, undefined)).toHaveProperty("error");
    expect(validatePaymentAmount(debt, 100_000, undefined, "p1")).toEqual({ portion: null });
  });
});
