// Công thức thuần cho báo cáo Thu–chi theo tài khoản — tách khỏi Prisma/UI để test được và khóa
// đúng phép cộng trừ (mỗi TK: Thu − Chi = Số dư; tổng gồm cả khoản chưa gán tài khoản).

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

/** Ghép THU (theo "TK nhận tiền") và CHI (theo "Chi từ TK") cho từng tài khoản; balance = thu − chi. */
export function buildCashFlowReport(input: {
  companyAccounts: AccountInput[];
  users: AccountInput[];
  chiByCompany: SumEntry[];
  chiByPerson: SumEntry[];
  chiUnassigned: { amount: number; count: number };
  thuByCompany: SumEntry[];
  thuByPerson: SumEntry[];
  thuUnassigned: { amount: number; count: number };
}): CashFlowReport {
  const chiCompany = indexById(input.chiByCompany);
  const chiPerson = indexById(input.chiByPerson);
  const thuCompany = indexById(input.thuByCompany);
  const thuPerson = indexById(input.thuByPerson);

  const buildRow = (
    acc: AccountInput,
    thuMap: Map<string, SumEntry>,
    chiMap: Map<string, SumEntry>
  ): AccountRow => {
    const thu = thuMap.get(acc.id)?.amount ?? 0;
    const chi = chiMap.get(acc.id)?.amount ?? 0;
    return {
      id: acc.id,
      name: acc.name,
      isActive: acc.isActive,
      thu,
      chi,
      balance: thu - chi,
      thuCount: thuMap.get(acc.id)?.count ?? 0,
      chiCount: chiMap.get(acc.id)?.count ?? 0,
    };
  };

  return {
    companyAccounts: input.companyAccounts.map((a) => buildRow(a, thuCompany, chiCompany)),
    persons: input.users.map((u) => buildRow(u, thuPerson, chiPerson)),
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
