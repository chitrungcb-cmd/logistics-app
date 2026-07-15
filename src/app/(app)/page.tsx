import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { statusBadgeClass, isDateApproaching } from "@/lib/shipment-constants";
import { isOverdue, sumPayments } from "@/lib/debt-constants";
import { computeProfit } from "@/lib/shipment-cost-constants";
import { adHocTaskWhere } from "@/lib/task-constants";

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

  const taskWhere = user.role === "FIELD_STAFF"
    ? { AND: [adHocTaskWhere(), { assignedToUserId: user.id }] }
    : adHocTaskWhere();

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
  const completedShipments =
    statusCount("Thông quan") + statusCount("Giải phóng hàng") + statusCount("Hoàn thành");
  const cancelledShipments = statusCount("Hủy");
  const processingShipments = Math.max(0, shipmentTotal - completedShipments - cancelledShipments);
  const tasksOpen = taskGroups
    .filter((g) => g.status !== "DONE")
    .reduce((sum, g) => sum + g._count._all, 0);
  const tasksDone = taskGroups.find((g) => g.status === "DONE")?._count._all ?? 0;
  const taskTotal = tasksOpen + tasksDone;
  const taskCompletionPercent = taskTotal > 0 ? Math.round((tasksDone / taskTotal) * 100) : 0;

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
    <div className="p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tổng quan</h1>
          <p className="mt-1 text-sm text-gray-500">
            Xin chào {user.name}. Theo dõi nhanh vận hành và các việc cần xử lý.
          </p>
        </div>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
          Cập nhật {new Date().toLocaleDateString("vi-VN")}
        </p>
      </header>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Vận hành lô hàng</h2>
            <Link href="/shipments" className="text-xs font-medium text-blue-600 hover:underline">Xem danh sách →</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CompactStat icon="📦" iconBg="bg-blue-100" label="Tổng lô hàng" value={String(shipmentTotal)} href="/shipments" subtitle={cancelledShipments > 0 ? `${cancelledShipments} lô đã hủy` : "Toàn bộ lô đã tạo"} />
            <CompactStat icon="🚚" iconBg="bg-indigo-100" label="Đang xử lý" value={String(processingShipments)} href="/shipments" subtitle="Chưa qua hải quan" />
            <CompactStat icon="✅" iconBg="bg-emerald-100" label="Đã qua hải quan" value={String(completedShipments)} href="/shipments" subtitle="Thông quan hoặc hoàn thành" />
            <CompactStat icon="👥" iconBg="bg-purple-100" label="Khách hàng" value={String(customerCount)} href="/customers" subtitle="Đang quản lý" />
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-3">
            <h2 className="font-semibold text-gray-900">Cần xử lý</h2>
          </div>
          <div className="divide-y divide-gray-100">
            <ActionItem
              icon="📝"
              label={isManager ? "Nhiệm vụ chưa xong" : "Việc của tôi chưa xong"}
              value={String(tasksOpen)}
              hint={`${taskCompletionPercent}% việc ngoài tiến trình đã hoàn thành`}
              href="/tasks"
              tone={tasksOpen > 0 ? "amber" : "neutral"}
            />
            <ActionItem
              icon="📅"
              label="Lịch tham vấn sắp tới"
              value={String(upcomingConsultations.length)}
              hint="Theo ngày tham vấn đã nhập"
              href="/shipments"
              tone={upcomingConsultations.some((shipment) => isDateApproaching(shipment.consultationDate)) ? "amber" : "neutral"}
            />
            {debtStats && (
              <ActionItem
                icon="⚠️"
                label="Công nợ quá hạn"
                value={formatVnd(debtStats.overdue)}
                hint={debtStats.overdue > 0 ? "Cần ưu tiên xử lý" : "Không có khoản quá hạn"}
                href="/debts"
                tone={debtStats.overdue > 0 ? "red" : "neutral"}
              />
            )}
          </div>
        </section>
      </div>

      {(profitStats || debtStats) && (
        <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-gray-900">Tài chính</h2>
              <p className="mt-0.5 text-xs text-gray-500">Tổng hợp số đã ghi nhận trên hệ thống</p>
            </div>
            <Link href="/reports" className="text-xs font-medium text-blue-600 hover:underline">Xem báo cáo →</Link>
          </div>

          {profitStats && profitStats.revenue === 0 && profitStats.cost > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
              Chưa ghi nhận tổng thu cho các lô đang có chi phí. Lợi nhuận tạm tính hiện chưa phản ánh đầy đủ.
            </div>
          )}

          {profitStats && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Kết quả kinh doanh</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <FinanceMetric icon="💵" label="Tổng thu đã ghi nhận" value={formatVnd(profitStats.revenue)} href="/reports/profit" tone="blue" />
                <FinanceMetric icon="💰" label="Tổng chi phí" value={formatVnd(profitStats.cost)} href="/costs" tone="amber" />
                <FinanceMetric icon="📈" label="Lợi nhuận tạm tính" value={formatVnd(profitStats.profit)} href="/reports/profit" tone={profitStats.profit >= 0 ? "green" : "red"} />
              </div>
            </div>
          )}

          {debtStats && (
            <div className={profitStats ? "mt-5 border-t border-gray-100 pt-4" : "mt-4"}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Công nợ</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <FinanceMetric icon="📥" label="Còn phải thu" value={formatVnd(debtStats.receivable)} href="/debts" tone="blue" />
                <FinanceMetric icon="📤" label="Còn phải trả" value={formatVnd(debtStats.payable)} href="/debts" tone="amber" />
                <FinanceMetric icon="⚠️" label="Quá hạn" value={formatVnd(debtStats.overdue)} href="/debts" tone={debtStats.overdue > 0 ? "red" : "neutral"} />
              </div>
            </div>
          )}
        </section>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-5">
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

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Ngày tham vấn sắp tới</h2>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{upcomingConsultations.length}</span>
          </div>
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

function CompactStat({
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
    <div className={`h-full rounded-xl border border-gray-200 bg-white p-4 ${href ? "transition hover:border-blue-300 hover:shadow-sm" : ""}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base ${iconBg}`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className={`mt-0.5 text-2xl font-bold leading-tight text-gray-900 ${valueClassName ?? ""}`}>{value}</p>
        </div>
      </div>
      <p className="mt-2 truncate text-[11px] text-gray-400">{subtitle}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function ActionItem({
  icon,
  label,
  value,
  hint,
  href,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  hint: string;
  href: string;
  tone: "neutral" | "amber" | "red";
}) {
  const toneClass = {
    neutral: "bg-gray-100 text-gray-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
  }[tone];
  const valueClass = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-700" : "text-gray-900";

  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 transition hover:bg-gray-50">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base ${toneClass}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-700">{label}</p>
        <p className="truncate text-[11px] text-gray-400">{hint}</p>
      </div>
      <span className={`shrink-0 text-lg font-bold ${valueClass}`}>{value}</span>
    </Link>
  );
}

function FinanceMetric({
  icon,
  label,
  value,
  href,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  href: string;
  tone: "neutral" | "blue" | "amber" | "green" | "red";
}) {
  const styles = {
    neutral: "border-gray-200 bg-gray-50 text-gray-900",
    blue: "border-blue-100 bg-blue-50/70 text-blue-800",
    amber: "border-amber-100 bg-amber-50/70 text-amber-800",
    green: "border-emerald-100 bg-emerald-50/70 text-emerald-800",
    red: "border-red-100 bg-red-50/70 text-red-700",
  }[tone];

  return (
    <Link href={href} className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition hover:shadow-sm ${styles}`}>
      <span className="text-lg">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium opacity-70">{label}</p>
        <p className="truncate text-lg font-bold">{value}</p>
      </div>
    </Link>
  );
}
