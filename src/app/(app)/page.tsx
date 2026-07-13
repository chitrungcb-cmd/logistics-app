import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { statusBadgeClass, isDateApproaching } from "@/lib/shipment-constants";
import { isOverdue, sumPayments } from "@/lib/debt-constants";
import { computeProfit } from "@/lib/shipment-cost-constants";

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

// Server Component: every figure is computed here and only the numbers a given role is allowed to see
// are ever rendered — cost/profit is ADMIN-only, debt is manager-only (FIELD_STAFF sees neither), so
// the sensitive aggregates aren't just hidden in the client, they're never sent to that role at all.
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const isManager = user.role !== "FIELD_STAFF";
  const isAdmin = user.role === "ADMIN";

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const taskWhere = user.role === "FIELD_STAFF" ? { assignedToUserId: user.id } : {};

  const [
    shipmentTotal,
    statusGroups,
    customerCount,
    taskGroups,
    recentShipments,
    upcomingConsultations,
  ] = await Promise.all([
    prisma.shipment.count(),
    prisma.shipment.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.customer.count(),
    prisma.task.groupBy({ by: ["status"], where: taskWhere, _count: { _all: true } }),
    prisma.shipment.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, goodsName: true, customerName: true, status: true, declarationNo: true, createdAt: true },
    }),
    prisma.shipment.findMany({
      where: { consultationDate: { gte: startOfToday } },
      orderBy: { consultationDate: "asc" },
      take: 5,
      select: { id: true, goodsName: true, customerName: true, consultationDate: true },
    }),
  ]);

  const statusCount = (status: string) =>
    statusGroups.find((g) => g.status === status)?._count._all ?? 0;
  const tasksOpen = taskGroups
    .filter((g) => g.status !== "DONE")
    .reduce((sum, g) => sum + g._count._all, 0);
  const tasksDone = taskGroups.find((g) => g.status === "DONE")?._count._all ?? 0;

  // --- Manager-only: công nợ ---
  let debtStats: { receivable: number; payable: number; overdue: number } | null = null;
  if (isManager) {
    const debts = await prisma.debt.findMany({
      select: { type: true, totalAmount: true, dueDate: true, status: true, payments: { select: { amount: true } } },
    });
    let receivable = 0;
    let payable = 0;
    let overdue = 0;
    for (const d of debts) {
      const remaining = d.totalAmount - sumPayments(d.payments);
      if (d.type === "RECEIVABLE") receivable += remaining;
      else payable += remaining;
      if (isOverdue(d.status, d.dueDate)) overdue += remaining;
    }
    debtStats = { receivable, payable, overdue };
  }

  // --- Admin-only: chi phí / lợi nhuận (cùng công thức /reports/profit) ---
  let profitStats: { revenue: number; cost: number; profit: number } | null = null;
  if (isAdmin) {
    const shipmentsForProfit = await prisma.shipment.findMany({
      where: { declarationDate: { not: null } },
      select: {
        costs: { select: { costPrice: true, sellPrice: true, isAdditional: true } },
        quotes: { select: { quoteAmount: true, createdAt: true } },
      },
    });
    let revenue = 0;
    let cost = 0;
    for (const s of shipmentsForProfit) {
      const p = computeProfit(s.costs, s.quotes);
      revenue += p.totalRevenue;
      cost += p.totalCost;
    }
    profitStats = { revenue, cost, profit: revenue - cost };
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Tổng quan</h1>
      <p className="mt-1 text-sm text-gray-500">
        Xin chào {user.name}. Đây là bức tranh nhanh về hoạt động hiện tại.
      </p>

      {/* Hàng số liệu chung */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon="📦" iconBg="bg-blue-100" label="Tổng lô hàng" value={String(shipmentTotal)} href="/shipments" subtitle="Xem danh sách lô hàng" />
        <StatCard icon="🚚" iconBg="bg-indigo-100" label="Đang làm thủ tục" value={String(statusCount("Đang làm thủ tục"))} subtitle="Lô hàng chưa thông quan" />
        <StatCard icon="✅" iconBg="bg-green-100" label="Đã thông quan" value={String(statusCount("Thông quan"))} subtitle="Lô hàng đã xong hải quan" />
        <StatCard icon="👥" iconBg="bg-purple-100" label="Khách hàng" value={String(customerCount)} href="/customers" subtitle="Tổng số khách hàng" />
      </div>

      {/* Hàng nhiệm vụ + công nợ (theo quyền) */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon="📝"
          iconBg="bg-orange-100"
          label={isManager ? "Nhiệm vụ chưa xong" : "Việc của tôi chưa xong"}
          value={String(tasksOpen)}
          href="/tasks"
          subtitle={`${tasksDone} đã hoàn thành`}
        />
        {debtStats && (
          <>
            <StatCard icon="📥" iconBg="bg-cyan-100" label="Còn phải thu" value={formatVnd(debtStats.receivable)} href="/debts" subtitle="Khách hàng còn nợ" />
            <StatCard icon="📤" iconBg="bg-amber-100" label="Còn phải trả" value={formatVnd(debtStats.payable)} href="/debts" subtitle="Nợ nhà cung cấp" />
            <StatCard
              icon="⚠️"
              iconBg="bg-red-100"
              label="Công nợ quá hạn"
              value={formatVnd(debtStats.overdue)}
              href="/debts"
              subtitle="Cần xử lý gấp"
              valueClassName={debtStats.overdue > 0 ? "text-red-600" : undefined}
            />
          </>
        )}
      </div>

      {/* Hàng chi phí/lợi nhuận — chỉ ADMIN */}
      {profitStats && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard icon="💵" iconBg="bg-blue-100" label="Tổng thu (báo giá)" value={formatVnd(profitStats.revenue)} href="/reports/profit" subtitle="Trên các lô đã có tờ khai" />
          <StatCard icon="💰" iconBg="bg-orange-100" label="Tổng chi phí" value={formatVnd(profitStats.cost)} href="/costs" subtitle="Đã ghi nhận ở sổ chi phí" />
          <StatCard
            icon="📈"
            iconBg="bg-green-100"
            label="Lợi nhuận tạm tính"
            value={formatVnd(profitStats.profit)}
            href="/reports/profit"
            subtitle="Tổng thu − tổng chi phí"
            valueClassName={profitStats.profit >= 0 ? "text-green-700" : "text-red-600"}
          />
        </div>
      )}

      {/* Hai cột: lô hàng gần đây + nhắc ngày tham vấn */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Lô hàng gần đây</h2>
            <Link href="/shipments" className="text-sm text-blue-600 hover:underline">Xem tất cả →</Link>
          </div>
          {recentShipments.length === 0 ? (
            <p className="text-sm text-gray-400">Chưa có lô hàng nào.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentShipments.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/shipments/${s.id}`} className="block truncate font-medium text-gray-900 hover:underline">
                      {s.goodsName || "Chưa có tên hàng"}
                    </Link>
                    <p className="truncate text-xs text-gray-400">
                      {s.customerName} · TK {s.declarationNo || "—"}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(s.status)}`}>
                    {s.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Ngày tham vấn sắp tới</h2>
          {upcomingConsultations.length === 0 ? (
            <p className="text-sm text-gray-400">Không có lịch tham vấn nào sắp tới.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {upcomingConsultations.map((s) => {
                const warn = isDateApproaching(s.consultationDate);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/shipments/${s.id}`} className="block truncate font-medium text-gray-900 hover:underline">
                        {s.goodsName || "Chưa có tên hàng"}
                      </Link>
                      <p className="truncate text-xs text-gray-400">{s.customerName}</p>
                    </div>
                    <span className={`shrink-0 text-sm font-medium ${warn ? "text-red-600" : "text-gray-600"}`}>
                      {warn ? "⚠ " : ""}
                      {s.consultationDate ? new Date(s.consultationDate).toLocaleDateString("vi-VN") : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  iconBg,
  label,
  value,
  subtitle,
  href,
  valueClassName,
}: {
  icon: string;
  iconBg: string;
  label: string;
  value: string;
  subtitle: string;
  href?: string;
  valueClassName?: string;
}) {
  const inner = (
    <div className={`rounded-xl border border-gray-200 bg-white p-4 ${href ? "transition hover:border-blue-300 hover:shadow-sm" : ""}`}>
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${iconBg}`}>{icon}</span>
        <span className="text-sm font-medium text-gray-500">{label}</span>
      </div>
      <p className={`mt-3 text-2xl font-bold text-gray-900 ${valueClassName ?? ""}`}>{value}</p>
      <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
