import { describe, expect, it } from "vitest";
import { resolveCostPaymentAccount } from "@/lib/cost-payment-account";

describe("cost payment account", () => {
  it("uses the company account when a cost is linked to one", () => {
    expect(
      resolveCostPaymentAccount({
        paidFromCompanyAccount: { name: "NQ - BIDV - 8600015819" },
        paidBy: null,
      })
    ).toEqual({
      kind: "company",
      name: "NQ - BIDV - 8600015819",
      label: "TK công ty · NQ - BIDV - 8600015819",
    });
  });

  it("uses the person for a personal payment account", () => {
    expect(
      resolveCostPaymentAccount({
        paidFromCompanyAccount: null,
        paidBy: { name: "Trung" },
      })
    ).toEqual({
      kind: "personal",
      name: "Trung",
      label: "Cá nhân · Trung",
    });
  });

  it("returns null when no payment account is linked", () => {
    expect(resolveCostPaymentAccount({ paidFromCompanyAccount: null, paidBy: null })).toBeNull();
  });
});
