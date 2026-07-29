// Công thức thuần cho báo cáo Thu–chi theo tài khoản — tách khỏi Prisma/UI để test được và khóa
// đúng phép cộng trừ. Tài khoản công ty: Thu − Chi; cá nhân: Thu + nhận nội bộ − Chi − chuyển
// nội bộ. Tổng toàn công ty vẫn chỉ gồm Thu/Chi thật và cả khoản chưa gán, không cộng chuyển nội bộ.

export type AccountInput = { id: string; name: string; isActive?: boolean };
/** Một dòng tổng hợp theo tài khoản: id = khóa nhóm (null = chưa gán), amount = tổng, count = số khoản. */
export type SumEntry = { id: string | null; amount: number; count: number };

export type AccountRow = {
  id: string;
  name: string;
  isActive?: boolean;
  thu: number;
  chi: number;
  balance: number;
  thuCount: number;
  chiCount: number;
  transferIn: number;
  transferOut: number;
  transferInCount: number;
  transferOutCount: number;
};

export type CashFlowReport = {
  companyAccounts: AccountRow[];
  persons: AccountRow[];
  unassignedChi: { amount: number; count: number };
  unassignedThu: { amount: number; count: number };
};

function indexById(entries: SumEntry[]) {
  return new Map(entries.filter((e) => e.id != null).map((e) => [e.id as string, e]));
}

/** Ghép THU, CHI và điều chuyển nội bộ cho từng tài khoản/cá nhân. */
export function buildCashFlowReport(input: {
  companyAccounts: AccountInput[];
  users: AccountInput[];
  chiByCompany: SumEntry[];
  chiByPerson: SumEntry[];
  chiUnassigned: { amount: number; count: number };
  thuByCompany: SumEntry[];
  thuByPerson: SumEntry[];
  thuUnassigned: { amount: number; count: number };
  transferInByPerson?: SumEntry[];
  transferOutByPerson?: SumEntry[];
}): CashFlowReport {
  const chiCompany = indexById(input.chiByCompany);
  const chiPerson = indexById(input.chiByPerson);
  const thuCompany = indexById(input.thuByCompany);
  const thuPerson = indexById(input.thuByPerson);
  const transferInPerson = indexById(input.transferInByPerson ?? []);
  const transferOutPerson = indexById(input.transferOutByPerson ?? []);

  const buildRow = (
    acc: AccountInput,
    thuMap: Map<string, SumEntry>,
    chiMap: Map<string, SumEntry>,
    transferInMap = new Map<string, SumEntry>(),
    transferOutMap = new Map<string, SumEntry>()
  ): AccountRow => {
    const thu = thuMap.get(acc.id)?.amount ?? 0;
    const chi = chiMap.get(acc.id)?.amount ?? 0;
    const transferIn = transferInMap.get(acc.id)?.amount ?? 0;
    const transferOut = transferOutMap.get(acc.id)?.amount ?? 0;
    return {
      id: acc.id,
      name: acc.name,
      isActive: acc.isActive,
      thu,
      chi,
      balance: thu + transferIn - chi - transferOut,
      thuCount: thuMap.get(acc.id)?.count ?? 0,
      chiCount: chiMap.get(acc.id)?.count ?? 0,
      transferIn,
      transferOut,
      transferInCount: transferInMap.get(acc.id)?.count ?? 0,
      transferOutCount: transferOutMap.get(acc.id)?.count ?? 0,
    };
  };

  return {
    companyAccounts: input.companyAccounts.map((a) => buildRow(a, thuCompany, chiCompany)),
    persons: input.users.map((u) => buildRow(u, thuPerson, chiPerson, transferInPerson, transferOutPerson)),
    unassignedChi: input.chiUnassigned,
    unassignedThu: input.thuUnassigned,
  };
}

/** Tổng toàn bộ tiền vào/ra — GỒM cả khoản chưa gán tài khoản (hai vế cân xứng). */
export function computeCashFlowTotals(report: CashFlowReport): { thu: number; chi: number; balance: number } {
  const rows = [...report.companyAccounts, ...report.persons];
  const thu = rows.reduce((s, a) => s + a.thu, 0) + report.unassignedThu.amount;
  const chi = rows.reduce((s, a) => s + a.chi, 0) + report.unassignedChi.amount;
  return { thu, chi, balance: thu - chi };
}
