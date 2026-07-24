"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ShipmentLink from "@/components/shipments/ShipmentLink";

type Entry = {
  id: string;
  amount: number;
  paymentDate: string | null;
  receivingAccount: string | null;
  assignedUserId: string | null;
  note: string | null;
  shipment: {
    id: string;
    shipmentCode: string;
    declarationNo: string | null;
    declarationDate: string | null;
    goodsName: string | null;
    customerName: string;
  };
  assignedUser: { id: string; name: string } | null;
  // Suy từ các khoản thu phần KHÔNG HÓA ĐƠN trong Công nợ (server tính, xem computePersonalAccountPayment).
  paidAmount: number;
  remainingAmount: number;
  paidStatus: "paid" | "partial" | "unpaid";
  effectivePaymentDate: string | null;
};

type UserOption = { id: string; name: string; isActive?: boolean };

type CostByPayer = { userId: string | null; userName: string; totalCost: number; count: number };

type SaveStatus = "idle" | "saving" | "saved" | "error";

function formatVnd(amount: number) {
  return `${amount.toLocaleString("vi-VN")} đ`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("vi-VN");
}

function dateInputValue(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

function monthKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  return `Tháng ${Number(month)}/${year}`;
}

async function readApiJson(response: Response) {
  const text = await response.text();
  if (!text) throw new Error(`Máy chủ không trả về dữ liệu (HTTP ${response.status}).`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Phản hồi máy chủ không hợp lệ (HTTP ${response.status}).`);
  }
}

export default function PersonalAccountClient({ role }: { role: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [costByPayer, setCostByPayer] = useState<CostByPayer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({});
  const [drafts, setDrafts] = useState<Record<string, { receivingAccount: string; note: string }>>({});
  const savedTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    Promise.all([
      fetch("/api/personal-account").then(readApiJson),
      fetch("/api/users").then(readApiJson).catch(() => null),
    ])
      .then(([entryJson, userJson]) => {
        if (!entryJson.success) throw new Error(entryJson.error || "Không thể tải dữ liệu.");
        setEntries(entryJson.data);
        if (userJson?.success) setUsers(userJson.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, []);

  // Chi phí "do ai chi" là dữ liệu giá vốn ADMIN-only — chỉ ADMIN mới gọi (và endpoint cũng chặn
  // 403 ở server), ACCOUNTANT xem trang này sẽ không thấy phần báo cáo chi.
  useEffect(() => {
    if (role !== "ADMIN") return;
    fetch("/api/personal-account/cost-by-payer")
      .then(readApiJson)
      .then((json) => { if (json.success) setCostByPayer(json.data); })
      .catch(() => { /* báo cáo phụ, lỗi tải không chặn trang chính */ });
  }, [role]);

  useEffect(() => {
    const timers = savedTimers.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  async function saveEntry(id: string, patch: Record<string, string | null>) {
    setSaveStatus((current) => ({ ...current, [id]: "saving" }));
    setError(null);
    try {
      const response = await fetch(`/api/personal-account/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await readApiJson(response);
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể lưu.");
      setEntries((current) => current.map((entry) => (entry.id === id ? json.data : entry)));
      setSaveStatus((current) => ({ ...current, [id]: "saved" }));
      const existingTimer = savedTimers.current.get(id);
      if (existingTimer) clearTimeout(existingTimer);
      savedTimers.current.set(
        id,
        setTimeout(() => setSaveStatus((current) => ({ ...current, [id]: "idle" })), 2_000)
      );
    } catch (err) {
      setSaveStatus((current) => ({ ...current, [id]: "error" }));
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    }
  }

  function draftFor(entry: Entry) {
    return (
      drafts[entry.id] ?? {
        receivingAccount: entry.receivingAccount || "",
        note: entry.note || "",
      }
    );
  }

  function updateDraft(entry: Entry, patch: Partial<{ receivingAccount: string; note: string }>) {
    setDrafts((current) => ({ ...current, [entry.id]: { ...draftFor(entry), ...patch } }));
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (statusFilter === "paid" && entry.paidStatus === "unpaid") return false;
      if (statusFilter === "unpaid" && entry.paidStatus === "paid") return false;
      if (!query) return true;
      return [
        entry.shipment.declarationNo,
        entry.shipment.goodsName,
        entry.shipment.customerName,
        entry.shipment.shipmentCode,
        entry.receivingAccount,
        entry.assignedUser?.name,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [entries, search, statusFilter]);

  const totals = useMemo(() => {
    // Đã thu / còn lại tính theo số tiền thực thu từ Công nợ, không phải toàn bộ số của dòng.
    return entries.reduce(
      (acc, entry) => {
        acc.total += entry.amount;
        acc.paid += entry.paidAmount;
        acc.unpaid += entry.remainingAmount;
        return acc;
      },
      { total: 0, paid: 0, unpaid: 0 }
    );
  }, [entries]);

  const byMonth = useMemo(() => {
    const groups = new Map<string, { count: number; total: number }>();
    let unpaidCount = 0;
    let unpaidTotal = 0;
    for (const entry of entries) {
      if (entry.paidStatus === "unpaid" || !entry.effectivePaymentDate) {
        unpaidCount += 1;
        unpaidTotal += entry.remainingAmount;
        continue;
      }
      const key = monthKey(entry.effectivePaymentDate);
      const group = groups.get(key) ?? { count: 0, total: 0 };
      group.count += 1;
      group.total += entry.paidAmount;
      groups.set(key, group);
    }
    const rows = [...groups.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, group]) => ({ label: monthLabel(key), ...group }));
    return { rows, unpaidCount, unpaidTotal };
  }, [entries]);

  const byAssignee = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; count: number; total: number; unpaid: number }>();
    for (const entry of entries) {
      const key = entry.assignedUser?.id ?? "__none__";
      const group = groups.get(key) ?? {
        key,
        name: entry.assignedUser?.name ?? "Chưa gán người phụ trách",
        count: 0,
        total: 0,
        unpaid: 0,
      };
      group.count += 1;
      group.total += entry.amount;
      group.unpaid += entry.remainingAmount;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.total - a.total);
  }, [entries]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Tài khoản cá nhân</h1>
        <p className="mt-1 text-sm text-gray-500">
          Phần báo giá <span className="font-medium text-orange-700">không hóa đơn</span> của từng lô hàng được tự động
          liên kết về đây. Số tiền đồng bộ từ tab Báo giá trong Chi phí lô hàng; trạng thái thanh toán lấy theo các
          khoản thu phần không hóa đơn ghi trong Công nợ. Điền tay số TK nhận tiền và người phụ trách.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard label="Tổng tiền không hóa đơn" value={formatVnd(totals.total)} className="border-orange-200 bg-orange-50 text-orange-800" />
        <SummaryCard label="Đã thanh toán" value={formatVnd(totals.paid)} className="border-emerald-200 bg-emerald-50 text-emerald-800" />
        <SummaryCard label="Chưa thanh toán" value={formatVnd(totals.unpaid)} className="border-red-200 bg-red-50 text-red-800" />
        <SummaryCard label="Số lô theo dõi" value={String(entries.length)} className="border-gray-200 bg-white text-gray-800" />
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="input w-72"
            placeholder="Tìm số tờ khai, tên hàng, khách hàng..."
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="input w-44"
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="unpaid">Chưa thanh toán</option>
            <option value="paid">Đã thanh toán</option>
          </select>
          <span className="text-sm text-gray-500">{filtered.length} dòng</span>
        </div>

        {isLoading ? (
          <p className="py-12 text-center text-gray-400">Đang tải dữ liệu...</p>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-gray-400">
            Chưa có lô hàng nào có chi phí không hóa đơn. Nhập phần &quot;Không hóa đơn&quot; ở tab Báo giá trong Chi phí lô
            hàng để dòng tự xuất hiện tại đây.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-[1100px] divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500">Ngày thanh toán</th>
                  <th className="px-3 py-2 text-left text-gray-500">Số tờ khai</th>
                  <th className="px-3 py-2 text-left text-gray-500">Ngày tờ khai</th>
                  <th className="px-3 py-2 text-left text-gray-500">Tên hàng</th>
                  <th className="px-3 py-2 text-right text-gray-500">Số tiền</th>
                  <th className="px-3 py-2 text-right text-gray-500">Còn lại</th>
                  <th className="px-3 py-2 text-left text-gray-500">Số TK nhận tiền</th>
                  <th className="px-3 py-2 text-left text-gray-500">Người phụ trách</th>
                  <th className="px-3 py-2 text-left text-gray-500">Ghi chú</th>
                  <th className="px-3 py-2 text-left text-gray-500">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((entry) => {
                  const draft = draftFor(entry);
                  // Có thanh toán từ Công nợ → hiển thị ngày thực thu (chỉ đọc), không cho sửa tay
                  // để hai module không lệch nhau. Chưa có công nợ đồng bộ mới cho điền tay ngày.
                  const hasDebtPayment = entry.paidAmount > 0 && entry.paidStatus !== "unpaid" && !entry.paymentDate;
                  return (
                    <tr key={entry.id} className={entry.paidStatus === "paid" ? "" : "bg-red-50/40"}>
                      <td className="px-3 py-2">
                        {hasDebtPayment ? (
                          <span className="block w-36 text-gray-700">
                            {formatDate(entry.effectivePaymentDate)}
                            <span className="block text-[10px] text-gray-400">Thu qua Công nợ</span>
                          </span>
                        ) : (
                          <input
                            type="date"
                            value={dateInputValue(entry.paymentDate)}
                            onChange={(event) => saveEntry(entry.id, { paymentDate: event.target.value || null })}
                            className="input w-36"
                          />
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <ShipmentLink shipmentId={entry.shipment.id} className="font-medium text-blue-700 hover:underline">
                          {entry.shipment.declarationNo || entry.shipment.shipmentCode}
                        </ShipmentLink>
                        <span className="block text-xs text-gray-400">{entry.shipment.customerName}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700">{formatDate(entry.shipment.declarationDate)}</td>
                      <td className="max-w-64 px-3 py-2 text-gray-700">
                        <span className="line-clamp-2">{entry.shipment.goodsName || "—"}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-orange-700">{formatVnd(entry.amount)}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-medium ${entry.remainingAmount > 0 ? "text-red-700" : "text-emerald-700"}`}>
                        {entry.remainingAmount > 0 ? formatVnd(entry.remainingAmount) : "Đã thu đủ"}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={draft.receivingAccount}
                          onChange={(event) => updateDraft(entry, { receivingAccount: event.target.value })}
                          onBlur={() => {
                            if ((entry.receivingAccount || "") !== draft.receivingAccount) {
                              saveEntry(entry.id, { receivingAccount: draft.receivingAccount || null });
                            }
                          }}
                          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                          className="input w-40"
                          placeholder="Số TK nhận tiền"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={entry.assignedUserId || ""}
                          onChange={(event) => saveEntry(entry.id, { assignedUserId: event.target.value || null })}
                          className="input min-w-40"
                        >
                          <option value="">Chưa gán</option>
                          {users.map((user) => (
                            <option key={user.id} value={user.id}>{user.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={draft.note}
                          onChange={(event) => updateDraft(entry, { note: event.target.value })}
                          onBlur={() => {
                            if ((entry.note || "") !== draft.note) {
                              saveEntry(entry.id, { note: draft.note || null });
                            }
                          }}
                          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                          className="input w-44"
                          placeholder="Ghi chú"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex flex-col gap-1">
                          {entry.paidStatus === "paid" ? (
                            <span className="w-fit rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Đã thanh toán</span>
                          ) : entry.paidStatus === "partial" ? (
                            <span className="w-fit rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                              Thu một phần · {formatVnd(entry.paidAmount)}
                            </span>
                          ) : (
                            <span className="w-fit rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">Chưa thanh toán</span>
                          )}
                          <SaveIndicator status={saveStatus[entry.id] || "idle"} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 font-semibold text-gray-900">Báo cáo theo tháng thanh toán</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2">Tháng</th>
                <th className="py-2 text-right">Số lô</th>
                <th className="py-2 text-right">Tổng tiền</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byMonth.rows.map((row) => (
                <tr key={row.label}>
                  <td className="py-2 text-gray-700">{row.label}</td>
                  <td className="py-2 text-right text-gray-700">{row.count}</td>
                  <td className="py-2 text-right font-medium text-gray-900">{formatVnd(row.total)}</td>
                </tr>
              ))}
              {byMonth.unpaidCount > 0 && (
                <tr className="bg-red-50/50">
                  <td className="py-2 font-medium text-red-700">Chưa thanh toán</td>
                  <td className="py-2 text-right text-red-700">{byMonth.unpaidCount}</td>
                  <td className="py-2 text-right font-semibold text-red-700">{formatVnd(byMonth.unpaidTotal)}</td>
                </tr>
              )}
              {byMonth.rows.length === 0 && byMonth.unpaidCount === 0 && (
                <tr><td colSpan={3} className="py-6 text-center text-gray-400">Chưa có dữ liệu.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 font-semibold text-gray-900">Báo cáo theo người phụ trách</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2">Người phụ trách</th>
                <th className="py-2 text-right">Số lô</th>
                <th className="py-2 text-right">Tổng tiền</th>
                <th className="py-2 text-right">Chưa thanh toán</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byAssignee.map((row) => (
                <tr key={row.key}>
                  <td className="py-2 text-gray-700">{row.name}</td>
                  <td className="py-2 text-right text-gray-700">{row.count}</td>
                  <td className="py-2 text-right font-medium text-gray-900">{formatVnd(row.total)}</td>
                  <td className={`py-2 text-right font-medium ${row.unpaid > 0 ? "text-red-700" : "text-gray-400"}`}>
                    {row.unpaid > 0 ? formatVnd(row.unpaid) : "—"}
                  </td>
                </tr>
              ))}
              {byAssignee.length === 0 && (
                <tr><td colSpan={4} className="py-6 text-center text-gray-400">Chưa có dữ liệu.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {role === "ADMIN" && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-1 font-semibold text-gray-900">Chi phí theo người chi</h2>
          <p className="mb-3 text-xs text-gray-500">
            Tổng chi phí lô hàng gom theo &quot;Do ai chi&quot; đã chọn ở bảng chi phí. Chỉ ADMIN xem được.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-2">Người chi</th>
                <th className="py-2 text-right">Số khoản</th>
                <th className="py-2 text-right">Tổng đã chi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {costByPayer.map((row) => (
                <tr key={row.userId ?? "__none__"}>
                  <td className="py-2 text-gray-700">{row.userName}</td>
                  <td className="py-2 text-right text-gray-700">{row.count}</td>
                  <td className="py-2 text-right font-medium text-gray-900">{formatVnd(row.totalCost)}</td>
                </tr>
              ))}
              {costByPayer.length === 0 && (
                <tr><td colSpan={3} className="py-6 text-center text-gray-400">Chưa gán &quot;Do ai chi&quot; cho khoản chi phí nào.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function SummaryCard({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className={`rounded-xl border p-4 ${className}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") return <span className="text-[10px] font-medium text-blue-600">Đang lưu...</span>;
  if (status === "saved") return <span className="text-[10px] font-medium text-emerald-700">✓ Đã lưu</span>;
  if (status === "error") return <span className="text-[10px] font-medium text-red-600">Lỗi lưu</span>;
  return null;
}
