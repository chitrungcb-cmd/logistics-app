import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { buildCashFlowReport, mergeSumEntries, type SumEntry } from "@/lib/cash-flow-report";
import { AUTOMATIC_PAYABLE_DEBT_PREFIX } from "@/lib/shipment-debt-sync";
import { hasModuleAccess } from "@/lib/module-permissions";
import { parseReportDateRange } from "@/lib/report-date-range";

// Báo cáo thu–chi theo tài khoản dành cho người đã được cấp mô-đun REPORTS.
// CHI: Σ costPrice thực tế nhóm theo "Chi từ TK" (paidFromCompanyAccountId / paidByUserId).
// THU: Σ Payment nhóm theo "TK nhận tiền" (receivedToCompanyAccountId / receivedByUserId).
// Mỗi tài khoản (công ty + từng người) hiện Thu / Chi / Số dư.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (!hasModuleAccess(user, "REPORTS")) return apiError("Bạn không có quyền xem báo cáo này.", 403);

  const parsedRange = parseReportDateRange(request.nextUrl.searchParams);
  if (!parsedRange.ok) return apiError(parsedRange.error, 400);
  const range = parsedRange.range;
  const expensePeriod = range
    ? {
        OR: [
          { paidAt: { gte: range.start, lt: range.endExclusive } },
          { paidAt: null, createdAt: { gte: range.start, lt: range.endExclusive } },
        ],
      }
    : {};
  const receiptPeriod = range
    ? { paymentDate: { gte: range.start, lt: range.endExclusive } }
    : {};
  const transferPeriod = range
    ? { transferDate: { gte: range.start, lt: range.endExclusive } }
    : {};
  const otherPeriod = range
    ? { expenseDate: { gte: range.start, lt: range.endExclusive } }
    : {};
  const manualPayableDebt = {
    type: "PAYABLE" as const,
    OR: [
      { sourceKey: null },
      { sourceKey: { not: { startsWith: AUTOMATIC_PAYABLE_DEBT_PREFIX } } },
    ],
  };

  const [
    accounts,
    users,
    chiByCompany,
    chiByPerson,
    chiUnassigned,
    thuByCompany,
    thuByPerson,
    thuUnassigned,
    manualPayableByCompany,
    manualPayableByPerson,
    manualPayableUnassigned,
    otherByCompany,
    otherUnassigned,
    transferInByPerson,
    transferOutByPerson,
    transfers,
  ] = await Promise.all([
    prisma.companyAccount.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.shipmentCost.groupBy({
      by: ["paidFromCompanyAccountId"],
      where: {
        isActual: true,
        isPaid: true,
        costPrice: { gt: 0 },
        paidFromCompanyAccountId: { not: null },
        ...expensePeriod,
      },
      _sum: { costPrice: true },
      _count: { _all: true },
    }),
    prisma.shipmentCost.groupBy({
      by: ["paidByUserId"],
      where: {
        isActual: true,
        isPaid: true,
        costPrice: { gt: 0 },
        paidByUserId: { not: null },
        ...expensePeriod,
      },
      _sum: { costPrice: true },
      _count: { _all: true },
    }),
    prisma.shipmentCost.aggregate({
      where: {
        isActual: true,
        isPaid: true,
        costPrice: { gt: 0 },
        paidByUserId: null,
        paidFromCompanyAccountId: null,
        ...expensePeriod,
      },
      _sum: { costPrice: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["receivedToCompanyAccountId"],
      where: {
        receivedToCompanyAccountId: { not: null },
        debt: { type: "RECEIVABLE" },
        ...receiptPeriod,
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["receivedByUserId"],
      where: {
        receivedByUserId: { not: null },
        debt: { type: "RECEIVABLE" },
        ...receiptPeriod,
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({
      where: {
        receivedToCompanyAccountId: null,
        receivedByUserId: null,
        debt: { type: "RECEIVABLE" },
        ...receiptPeriod,
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["receivedToCompanyAccountId"],
      where: {
        receivedToCompanyAccountId: { not: null },
        debt: manualPayableDebt,
        ...receiptPeriod,
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ["receivedByUserId"],
      where: {
        receivedByUserId: { not: null },
        debt: manualPayableDebt,
        ...receiptPeriod,
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({
      where: {
        receivedToCompanyAccountId: null,
        receivedByUserId: null,
        debt: manualPayableDebt,
        ...receiptPeriod,
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.otherExpense.groupBy({
      by: ["type", "companyAccountId"],
      where: { companyAccountId: { not: null }, ...otherPeriod },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.otherExpense.groupBy({
      by: ["type"],
      where: { companyAccountId: null, ...otherPeriod },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.internalTransfer.groupBy({
      by: ["toUserId"],
      where: transferPeriod,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.internalTransfer.groupBy({
      by: ["fromUserId"],
      where: transferPeriod,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.internalTransfer.findMany({
      where: transferPeriod,
      orderBy: [{ transferDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        type: true,
        transferDate: true,
        amount: true,
        note: true,
        attachmentName: true,
        attachmentUrl: true,
        createdAt: true,
        fromUser: { select: { id: true, name: true } },
        toUser: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    }),
  ]);

  const toEntry = (id: string | null, amount: number | null | undefined, count: number): SumEntry => ({
    id,
    amount: amount ?? 0,
    count,
  });
  const otherCompanyThu = otherByCompany
    .filter((row) => row.type === "THU")
    .map((row) => toEntry(row.companyAccountId, row._sum.amount, row._count._all));
  const otherCompanyChi = otherByCompany
    .filter((row) => row.type === "CHI")
    .map((row) => toEntry(row.companyAccountId, row._sum.amount, row._count._all));
  const otherUnassignedThu = otherUnassigned.find((row) => row.type === "THU");
  const otherUnassignedChi = otherUnassigned.find((row) => row.type === "CHI");

  const mergedChiCompany = mergeSumEntries(
    chiByCompany.map((r) => toEntry(r.paidFromCompanyAccountId, r._sum.costPrice, r._count._all)),
    manualPayableByCompany.map((r) => toEntry(r.receivedToCompanyAccountId, r._sum.amount, r._count._all)),
    otherCompanyChi
  );
  const mergedChiPerson = mergeSumEntries(
    chiByPerson.map((r) => toEntry(r.paidByUserId, r._sum.costPrice, r._count._all)),
    manualPayableByPerson.map((r) => toEntry(r.receivedByUserId, r._sum.amount, r._count._all))
  );
  const mergedThuCompany = mergeSumEntries(
    thuByCompany.map((r) => toEntry(r.receivedToCompanyAccountId, r._sum.amount, r._count._all)),
    otherCompanyThu
  );

  const report = buildCashFlowReport({
    companyAccounts: accounts.map((a) => ({ id: a.id, name: a.name, isActive: a.isActive })),
    users: users.map((u) => ({ id: u.id, name: u.name })),
    chiByCompany: mergedChiCompany,
    chiByPerson: mergedChiPerson,
    chiUnassigned: {
      amount: (chiUnassigned._sum.costPrice ?? 0) + (manualPayableUnassigned._sum.amount ?? 0) + (otherUnassignedChi?._sum.amount ?? 0),
      count: chiUnassigned._count._all + manualPayableUnassigned._count._all + (otherUnassignedChi?._count._all ?? 0),
    },
    thuByCompany: mergedThuCompany,
    thuByPerson: thuByPerson.map((r) => ({ id: r.receivedByUserId, amount: r._sum.amount ?? 0, count: r._count._all })),
    thuUnassigned: {
      amount: (thuUnassigned._sum.amount ?? 0) + (otherUnassignedThu?._sum.amount ?? 0),
      count: thuUnassigned._count._all + (otherUnassignedThu?._count._all ?? 0),
    },
    transferInByPerson: transferInByPerson.map((r) => ({
      id: r.toUserId,
      amount: r._sum.amount ?? 0,
      count: r._count._all,
    })),
    transferOutByPerson: transferOutByPerson.map((r) => ({
      id: r.fromUserId,
      amount: r._sum.amount ?? 0,
      count: r._count._all,
    })),
  });

  return apiSuccess({
    ...report,
    transfers,
    period: range ? { from: range.from, to: range.to } : null,
  });
}
