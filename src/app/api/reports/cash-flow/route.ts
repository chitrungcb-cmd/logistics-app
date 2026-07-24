import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

// Báo cáo thu–chi theo tài khoản (ADMIN-only, như mọi dữ liệu chi phí).
// CHI: Σ costPrice thực tế nhóm theo "Chi từ TK" (paidFromCompanyAccountId / paidByUserId).
// THU: Σ Payment nhóm theo "TK nhận tiền" (receivedToCompanyAccountId / receivedByUserId).
// Mỗi tài khoản (công ty + từng người) hiện Thu / Chi / Số dư.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role !== "ADMIN") return apiError("Bạn không có quyền xem báo cáo này.", 403);

  const [accounts, users, chiByCompany, chiByPerson, chiUnassigned, thuByCompany, thuByPerson, thuUnassigned] = await Promise.all([
    prisma.companyAccount.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.shipmentCost.groupBy({
      by: ["paidFromCompanyAccountId"],
      where: { isActual: true, costPrice: { gt: 0 }, paidFromCompanyAccountId: { not: null } },
      _sum: { costPrice: true },
      _count: { _all: true },
    }),
    prisma.shipmentCost.groupBy({
      by: ["paidByUserId"],
      where: { isActual: true, costPrice: { gt: 0 }, paidByUserId: { not: null } },
      _sum: { costPrice: true },
      _count: { _all: true },
    }),
    prisma.shipmentCost.aggregate({
      where: { isActual: true, costPrice: { gt: 0 }, paidByUserId: null, paidFromCompanyAccountId: null },
      _sum: { costPrice: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["receivedToCompanyAccountId"],
      where: { receivedToCompanyAccountId: { not: null } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["receivedByUserId"],
      where: { receivedByUserId: { not: null } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({
      where: { receivedToCompanyAccountId: null, receivedByUserId: null },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const chiCompanyMap = new Map(chiByCompany.map((r) => [r.paidFromCompanyAccountId, { chi: r._sum.costPrice ?? 0, count: r._count._all }]));
  const chiPersonMap = new Map(chiByPerson.map((r) => [r.paidByUserId, { chi: r._sum.costPrice ?? 0, count: r._count._all }]));
  const thuCompanyMap = new Map(thuByCompany.map((r) => [r.receivedToCompanyAccountId, { thu: r._sum.amount ?? 0, count: r._count._all }]));
  const thuPersonMap = new Map(thuByPerson.map((r) => [r.receivedByUserId, { thu: r._sum.amount ?? 0, count: r._count._all }]));

  return apiSuccess({
    companyAccounts: accounts.map((a) => {
      const thu = thuCompanyMap.get(a.id)?.thu ?? 0;
      const chi = chiCompanyMap.get(a.id)?.chi ?? 0;
      return {
        id: a.id,
        name: a.name,
        isActive: a.isActive,
        thu,
        chi,
        balance: thu - chi,
        chiCount: chiCompanyMap.get(a.id)?.count ?? 0,
        thuCount: thuCompanyMap.get(a.id)?.count ?? 0,
      };
    }),
    persons: users.map((u) => {
      const thu = thuPersonMap.get(u.id)?.thu ?? 0;
      const chi = chiPersonMap.get(u.id)?.chi ?? 0;
      return {
        id: u.id,
        name: u.name,
        thu,
        chi,
        balance: thu - chi,
        chiCount: chiPersonMap.get(u.id)?.count ?? 0,
        thuCount: thuPersonMap.get(u.id)?.count ?? 0,
      };
    }),
    unassignedChi: { amount: chiUnassigned._sum.costPrice ?? 0, count: chiUnassigned._count._all },
    unassignedThu: { amount: thuUnassigned._sum.amount ?? 0, count: thuUnassigned._count._all },
  });
}
