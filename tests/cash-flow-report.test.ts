import { describe, expect, it } from "vitest";
import { buildCashFlowReport, computeCashFlowTotals, mergeSumEntries } from "@/lib/cash-flow-report";

const base = {
  companyAccounts: [{ id: "vcb", name: "VCB", isActive: true }, { id: "bidv", name: "BIDV", isActive: true }],
  users: [{ id: "u1", name: "Quỳnh" }, { id: "u2", name: "Trung" }],
  chiByCompany: [{ id: "vcb", amount: 100, count: 2 }],
  chiByPerson: [{ id: "u1", amount: 40, count: 1 }],
  chiUnassigned: { amount: 7, count: 1 },
  thuByCompany: [{ id: "vcb", amount: 300, count: 3 }],
  thuByPerson: [{ id: "u1", amount: 25, count: 1 }],
  thuUnassigned: { amount: 5, count: 1 },
  transferInByPerson: [{ id: "u2", amount: 10, count: 1 }],
  transferOutByPerson: [{ id: "u1", amount: 10, count: 1 }],
};

describe("buildCashFlowReport", () => {
  it("ghép thu/chi và tính số dư = thu − chi cho từng tài khoản", () => {
    const r = buildCashFlowReport(base);
    const vcb = r.companyAccounts.find((a) => a.id === "vcb")!;
    expect(vcb).toMatchObject({ thu: 300, chi: 100, balance: 200, thuCount: 3, chiCount: 2 });
    // BIDV không có thu/chi → 0, số dư 0.
    expect(r.companyAccounts.find((a) => a.id === "bidv")).toMatchObject({ thu: 0, chi: 0, balance: 0 });
    // Người có chi nhiều hơn thu → số dư âm.
    expect(r.persons.find((p) => p.id === "u1")).toMatchObject({
      thu: 25, chi: 40, transferOut: 10, transferIn: 0, balance: -25,
    });
    expect(r.persons.find((p) => p.id === "u2")).toMatchObject({
      thu: 0, chi: 0, transferOut: 0, transferIn: 10, balance: 10,
    });
    expect(r.unassignedChi).toEqual({ amount: 7, count: 1 });
    expect(r.unassignedThu).toEqual({ amount: 5, count: 1 });
  });

  it("chuyển nội bộ chỉ điều chuyển số dư giữa hai người", () => {
    const r = buildCashFlowReport(base);
    const personBalances = r.persons.reduce((sum, person) => sum + person.balance, 0);
    expect(personBalances).toBe(25 - 40);
  });
});

describe("computeCashFlowTotals", () => {
  it("tổng gồm cả khoản chưa gán ở CẢ HAI vế; số dư = thu − chi", () => {
    const totals = computeCashFlowTotals(buildCashFlowReport(base));
    // thu = 300 (vcb) + 25 (u1) + 5 (chưa gán) = 330
    expect(totals.thu).toBe(330);
    // chi = 100 (vcb) + 40 (u1) + 7 (chưa gán) = 147
    expect(totals.chi).toBe(147);
    expect(totals.balance).toBe(330 - 147);
  });

  it("không cộng chuyển nội bộ vào tổng thu hoặc tổng chi", () => {
    const totals = computeCashFlowTotals(buildCashFlowReport(base));
    expect(totals).toEqual({ thu: 330, chi: 147, balance: 183 });
  });

  it("không bỏ sót thu chưa gán (chống hồi quy lỗi đã sửa)", () => {
    const r = buildCashFlowReport({
      ...base,
      thuByCompany: [], thuByPerson: [],
      chiByCompany: [], chiByPerson: [], chiUnassigned: { amount: 0, count: 0 },
      thuUnassigned: { amount: 999, count: 1 },
    });
    expect(computeCashFlowTotals(r).thu).toBe(999);
  });
});

describe("mergeSumEntries", () => {
  it("cộng các nguồn thu chi cùng tài khoản và giữ riêng khoản chưa gán", () => {
    expect(mergeSumEntries(
      [{ id: "bidv", amount: 100, count: 1 }, { id: null, amount: 5, count: 1 }],
      [{ id: "bidv", amount: 20, count: 2 }, { id: null, amount: 7, count: 3 }]
    )).toEqual([
      { id: "bidv", amount: 120, count: 3 },
      { id: null, amount: 12, count: 4 },
    ]);
  });
});
