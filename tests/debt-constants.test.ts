import { describe, expect, it } from "vitest";
import { computeDebtStatus, isOverdue, sumPayments } from "@/lib/debt-constants";

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
