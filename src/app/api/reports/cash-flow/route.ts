import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { buildCashFlowReport } from "@/lib/cash-flow-report";

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

  const report = buildCashFlowReport({
    companyAccounts: accounts.map((a) => ({ id: a.id, name: a.name, isActive: a.isActive })),
    users: users.map((u) => ({ id: u.id, name: u.name })),
    chiByCompany: chiByCompany.map((r) => ({ id: r.paidFromCompanyAccountId, amount: r._sum.costPrice ?? 0, count: r._count._all })),
    chiByPerson: chiByPerson.map((r) => ({ id: r.paidByUserId, amount: r._sum.costPrice ?? 0, count: r._count._all })),
    chiUnassigned: { amount: chiUnassigned._sum.costPrice ?? 0, count: chiUnassigned._count._all },
    thuByCompany: thuByCompany.map((r) => ({ id: r.receivedToCompanyAccountId, amount: r._sum.amount ?? 0, count: r._count._all })),
    thuByPerson: thuByPerson.map((r) => ({ id: r.receivedByUserId, amount: r._sum.amount ?? 0, count: r._count._all })),
    thuUnassigned: { amount: thuUnassigned._sum.amount ?? 0, count: thuUnassigned._count._all },
  });

  return apiSuccess(report);
}
