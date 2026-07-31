import Link from "next/link";
import ShipmentLink from "@/components/shipments/ShipmentLink";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { statusBadgeClass, isDateApproaching } from "@/lib/shipment-constants";
import { isOverdue, sumPayments } from "@/lib/debt-constants";
import { adHocTaskWhere, TASK_STATUS_LABELS, taskStatusBadgeClass } from "@/lib/task-constants";
import { CONSULTATION_TASK_TITLE } from "@/lib/consultation-task";

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

const TASK_PROGRESS_PERCENT: Record<string, number> = {
  TODO: 0,
  IN_PROGRESS: 50,
  DONE: 100,
};

// Server Component: every figure is computed here and only the numbers a given role is allowed to see.
// FIELD_STAFF only receives their own tasks and never receives manager-only debt data.
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const isManager = user.role !== "FIELD_STAFF";

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const taskWhere = user.role === "FIELD_STAFF"
    ? { AND: [adHocTaskWhere(), { assignedToUserId: user.id }] }
    : adHocTaskWhere();
  const activeTaskWhere = { AND: [taskWhere, { status: { not: "DONE" as const } }] };

  const [
    shipmentTotal,
    statusGroups,
    customerCount,
    taskGroups,
    taskAssignees,
    recentShipments,
    consultationRows,
  ] = await Promise.all([
    prisma.shipment.count(),
    prisma.shipment.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.customer.count(),
    prisma.task.groupBy({ by: ["status"], where: taskWhere, _count: { _all: true } }),
    prisma.user.findMany({
      where: { tasksAssigned: { some: activeTaskWhere } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        isActive: true,
        _count: { select: { tasksAssigned: { where: activeTaskWhere } } },
        tasksAssigned: {
          where: activeTaskWhere,
          orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
          take: 4,
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
            relatedShipment: { select: { id: true, customerName: true, declarationNo: true } },
          },
        },
      },
    }),
    prisma.shipment.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, goodsName: true, customerName: true, status: true, declarationNo: true, createdAt: true },
    }),
    prisma.shipment.findMany({
      where: { consultationDate: { not: null } },
      orderBy: { consultationDate: "asc" },
      select: {
        id: true,
        goodsName: true,
        customerName: true,
        consultationDate: true,
        declarationNo: true,
        status: true,
        port: true,
        // Trạng thái nhiệm vụ "Tham vấn giá" của Linh — nguồn xác định đã tích hoàn thành hay chưa.
        tasks: { where: { title: CONSULTATION_TASK_TITLE }, select: { status: true }, take: 1 },
      },
    }),
  ]);

  // Lô có lịch tham vấn mà nhiệm vụ "Tham vấn giá" CHƯA tích hoàn thành. Quá hạn = đã qua ngày tham vấn
  // mà vẫn chưa xong → bảng tổng quan cảnh báo đỏ; sắp tới (trong ~7 ngày) cảnh báo hổ phách.
  const openConsultations = consultationRows
    .filter((s) => s.tasks[0]?.status !== "DONE")
    .map((s) => ({
      ...s,
      overdue: Boolean(s.consultationDate && s.consultationDate < startOfToday),
    }))
    .sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1; // quá hạn lên đầu
      return (a.consultationDate?.getTime() ?? 0) - (b.consultationDate?.getTime() ?? 0);
    });
  const overdueConsultationCount = openConsultations.filter((s) => s.overdue).length;

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
  let overdueDebt: number | null = null;
  if (isManager) {
    const debts = await prisma.debt.findMany({
      select: { totalAmount: true, dueDate: true, status: true, payments: { select: { amount: true } } },
    });
    overdueDebt = 0;
    for (const d of debts) {
      if (isOverdue(d.status, d.dueDate)) {
        overdueDebt += d.totalAmount - sumPayments(d.payments);
      }
    }
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
              label="Tham vấn cần xử lý"
              value={String(openConsultations.length)}
              hint={
                overdueConsultationCount > 0
                  ? `${overdueConsultationCount} lô đã quá hạn — chưa tích hoàn thành`
                  : "Nhiệm vụ tham vấn của Linh chưa tích hoàn thành"
              }
              href="#upcoming-consultations"
              tone={
                overdueConsultationCount > 0
                  ? "red"
                  : openConsultations.some((s) => isDateApproaching(s.consultationDate))
                    ? "amber"
                    : "neutral"
              }
            />
            {overdueDebt !== null && (
              <ActionItem
                icon="⚠️"
                label="Công nợ quá hạn"
                value={formatVnd(overdueDebt)}
                hint={overdueDebt > 0 ? "Cần ưu tiên xử lý" : "Không có khoản quá hạn"}
                href="/debts"
                tone={overdueDebt > 0 ? "red" : "neutral"}
              />
            )}
          </div>
        </section>
      </div>

      <section className="mt-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Tiến độ nhiệm vụ theo người phụ trách
            </h2>
            <p className="mt-1 text-xs text-gray-400">
              {isManager
                ? "Mỗi người hiển thị tối đa 4 nhiệm vụ đang mở, ưu tiên hạn gần nhất."
                : "Các nhiệm vụ đang mở được giao cho bạn, ưu tiên hạn gần nhất."}
            </p>
          </div>
          <Link href="/tasks" className="text-xs font-medium text-blue-600 hover:underline">Xem tất cả →</Link>
        </div>

        {taskAssignees.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white px-5 py-10 text-center">
            <p className="text-sm font-medium text-gray-600">Không có nhiệm vụ nào đang mở.</p>
            <p className="mt-1 text-xs text-gray-400">Các nhiệm vụ đã hoàn thành vẫn được lưu trong danh sách Nhiệm vụ.</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {taskAssignees.map((assignee) => (
              <article key={assignee.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/70 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                    {assignee.name.trim().charAt(0).toLocaleUpperCase("vi-VN") || "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-gray-900">{assignee.name}</h3>
                      {!assignee.isActive && (
                        <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                          Đã khóa
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{assignee._count.tasksAssigned} nhiệm vụ đang mở</p>
                  </div>
                </div>

                <div className="divide-y divide-gray-100 px-4">
                  {assignee.tasksAssigned.map((task) => (
                    <TaskProgressItem key={task.id} task={task} startOfToday={startOfToday} />
                  ))}
                </div>

                {assignee._count.tasksAssigned > assignee.tasksAssigned.length && (
                  <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-2.5 text-center">
                    <Link href="/tasks" className="text-xs font-medium text-blue-600 hover:underline">
                      Xem thêm {assignee._count.tasksAssigned - assignee.tasksAssigned.length} nhiệm vụ →
                    </Link>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

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
                    <ShipmentLink shipmentId={s.id} className="block truncate font-medium text-gray-900 hover:underline">
                      {s.goodsName || "Chưa có tên hàng"}
                    </ShipmentLink>
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

        <section id="upcoming-consultations" className="scroll-mt-6 rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Lịch tham vấn cần xử lý</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                overdueConsultationCount > 0 ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
              }`}
            >
              {overdueConsultationCount > 0 ? `${overdueConsultationCount} quá hạn / ` : ""}
              {openConsultations.length}
            </span>
          </div>
          {openConsultations.length === 0 ? (
            <p className="text-sm text-gray-400">Tất cả lịch tham vấn đã được tích hoàn thành.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr>
                    <th className="py-2 pr-3 text-left text-xs font-medium text-gray-500">Tên hàng</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Khách hàng</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Số tờ khai</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Trạng thái</th>
                    <th className="py-2 pl-3 text-right text-xs font-medium text-gray-500">Ngày tham vấn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {openConsultations.map((s) => {
                    const approaching = !s.overdue && isDateApproaching(s.consultationDate);
                    const dateClass = s.overdue ? "text-red-600" : approaching ? "text-amber-700" : "text-gray-600";
                    return (
                      <tr key={s.id} className={`hover:bg-gray-50 ${s.overdue ? "bg-red-50/40" : ""}`}>
                        <td className="max-w-[14rem] py-2.5 pr-3">
                          <ShipmentLink shipmentId={s.id} className="block truncate text-left font-medium text-gray-900 hover:underline">
                            {s.goodsName || "Chưa có tên hàng"}
                          </ShipmentLink>
                          {s.port && <p className="truncate text-xs text-gray-400">{s.port}</p>}
                        </td>
                        <td className="max-w-[10rem] truncate px-3 py-2.5 text-gray-600">{s.customerName}</td>
                        <td className="px-3 py-2.5 text-gray-600">{s.declarationNo || "—"}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(s.status)}`}>
                            {s.status}
                          </span>
                        </td>
                        <td className={`whitespace-nowrap py-2.5 pl-3 text-right font-medium ${dateClass}`}>
                          {s.overdue ? "⚠ Quá hạn · " : approaching ? "⏰ " : ""}
                          {s.consultationDate ? new Date(s.consultationDate).toLocaleDateString("vi-VN") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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

function TaskProgressItem({
  task,
  startOfToday,
}: {
  task: {
    id: string;
    title: string;
    status: string;
    dueDate: Date | null;
    relatedShipment: { id: string; customerName: string; declarationNo: string | null } | null;
  };
  startOfToday: Date;
}) {
  const progress = TASK_PROGRESS_PERCENT[task.status] ?? 0;
  const overdue = Boolean(task.dueDate && task.dueDate < startOfToday && task.status !== "DONE");
  const progressColor = task.status === "DONE" ? "bg-emerald-500" : task.status === "IN_PROGRESS" ? "bg-blue-500" : "bg-gray-300";

  return (
    <div className="py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/tasks/${task.id}`} className="block truncate text-sm font-medium text-gray-900 hover:text-blue-700 hover:underline">
            {task.title}
          </Link>
          <p className={`mt-1 truncate text-[11px] ${overdue ? "font-medium text-red-600" : "text-gray-400"}`}>
            {overdue ? "Quá hạn · " : ""}
            {task.dueDate ? `Hạn ${task.dueDate.toLocaleDateString("vi-VN")}` : "Chưa đặt hạn"}
            {task.relatedShipment ? ` · ${task.relatedShipment.declarationNo ? `TK ${task.relatedShipment.declarationNo}` : task.relatedShipment.customerName}` : ""}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${taskStatusBadgeClass(task.status)}`}>
          {TASK_STATUS_LABELS[task.status] ?? task.status}
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100"
          role="progressbar"
          aria-label={`Tiến độ nhiệm vụ ${task.title}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div className={`h-full rounded-full ${progressColor}`} style={{ width: `${progress}%` }} />
        </div>
        <span className="w-8 text-right text-[11px] font-semibold text-gray-500">{progress}%</span>
      </div>
    </div>
  );
}
