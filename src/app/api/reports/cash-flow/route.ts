import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

// Báo cáo thu–chi theo tài khoản (ADMIN-only, như mọi dữ liệu chi phí).
// CHI: tổng costPrice thực tế nhóm theo "Chi từ TK" (TK công ty / cá nhân / chưa gán).
// THU: tiền công ty thu qua hóa đơn = Σ Payment phần INVOICE của công nợ phải thu.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role !== "ADMIN") return apiError("Bạn không có quyền xem báo cáo này.", 403);

  const [accounts, users, byCompany, byPerson, unassigned, invoiceThu] = await Promise.all([
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
    prisma.payment.aggregate({ where: { portion: "INVOICE" }, _sum: { amount: true } }),
  ]);

  const companyChi = new Map(byCompany.map((r) => [r.paidFromCompanyAccountId, { chi: r._sum.costPrice ?? 0, count: r._count._all }]));
  const personChi = new Map(byPerson.map((r) => [r.paidByUserId, { chi: r._sum.costPrice ?? 0, count: r._count._all }]));

  return apiSuccess({
    companyThu: invoiceThu._sum.amount ?? 0,
    companyAccounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      isActive: a.isActive,
      chi: companyChi.get(a.id)?.chi ?? 0,
      count: companyChi.get(a.id)?.count ?? 0,
    })),
    persons: users.map((u) => ({
      id: u.id,
      name: u.name,
      chi: personChi.get(u.id)?.chi ?? 0,
      count: personChi.get(u.id)?.count ?? 0,
    })),
    unassigned: { chi: unassigned._sum.costPrice ?? 0, count: unassigned._count._all },
  });
}
