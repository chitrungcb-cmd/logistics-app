"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { computeCashFlowTotals } from "@/lib/cash-flow-report";

type Account = { id: string; name: string; isActive?: boolean; thu: number; chi: number; balance: number; chiCount: number; thuCount: number };
type Report = {
  companyAccounts: Account[];
  persons: Account[];
  unassignedChi: { amount: number; count: number };
  unassignedThu: { amount: number; count: number };
};

function formatVnd(n: number) {
  return n.toLocaleString("vi-VN") + " đ";
}

function Balance({ value }: { value: number }) {
  return <span className={value >= 0 ? "text-blue-700" : "text-orange-700"}>{formatVnd(value)}</span>;
}

export default function CashFlowReportClient({ canManageAccounts }: { canManageAccounts: boolean }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    return fetch("/api/reports/cash-flow")
      .then((r) => r.json())
      .then((j) => {
        if (!j.success) throw new Error(j.error || "Không thể tải báo cáo.");
        setReport(j.data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Đã có lỗi."))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addAccount() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/company-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error || "Không thể thêm tài khoản.");
      setNewName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Đã có lỗi.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAccount(id: string, isActive: boolean) {
    await fetch(`/api/company-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    await load();
  }

  const totals = report ? computeCashFlowTotals(report) : { thu: 0, chi: 0, balance: 0 };
  const totalThu = totals.thu;
  const totalChi = totals.chi;

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Thu – chi theo tài khoản</h1>
          <p className="mt-1 text-sm text-gray-500">
            Ai thu, ai chi những gì. THU = tiền vào theo &quot;TK nhận tiền&quot;; CHI = chi phí thực tế theo &quot;Chi từ TK&quot;.
          </p>
        </div>
        <Link href="/reports" className="text-sm text-blue-600 hover:underline">← Báo cáo</Link>
      </div>

      {isLoading ? (
        <p className="py-16 text-center text-gray-400">Đang tải...</p>
      ) : error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : report ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-medium text-emerald-700">Tổng thu</p>
              <p className="mt-1 text-2xl font-bold text-emerald-800">{formatVnd(totalThu)}</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-xs font-medium text-red-700">Tổng chi</p>
              <p className="mt-1 text-2xl font-bold text-red-800">{formatVnd(totalChi)}</p>
            </div>
            <div className={`rounded-xl border p-4 ${totalThu - totalChi >= 0 ? "border-blue-200 bg-blue-50" : "border-orange-200 bg-orange-50"}`}>
              <p className={`text-xs font-medium ${totalThu - totalChi >= 0 ? "text-blue-700" : "text-orange-700"}`}>Số dư (Thu − Chi)</p>
              <p className="mt-1 text-2xl font-bold"><Balance value={totalThu - totalChi} /></p>
            </div>
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-gray-900">Tài khoản công ty</h2>
              {canManageAccounts && (
                <div className="flex gap-2">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addAccount()}
                    className="input w-64"
                    placeholder="Tên TK (vd: VCB - Cty A)"
                  />
                  <button type="button" onClick={addAccount} disabled={busy || !newName.trim()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                    + Thêm TK
                  </button>
                </div>
              )}
            </div>
            <AccountTable
              rows={report.companyAccounts}
              onToggle={canManageAccounts ? toggleAccount : undefined}
              showToggle={canManageAccounts}
            />
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="mb-4 font-semibold text-gray-900">Cá nhân</h2>
            <AccountTable rows={report.persons.filter((p) => p.thu > 0 || p.chi > 0)} emptyText="Chưa có thu/chi nào gắn cá nhân." />
          </section>

          {(report.unassignedChi.count > 0 || report.unassignedThu.count > 0) && (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {report.unassignedChi.count > 0 && (
                <p>⚠ {report.unassignedChi.count} khoản chi ({formatVnd(report.unassignedChi.amount)}) <b>chưa gán &quot;Chi từ TK&quot;</b> — coi như <b>chưa chi</b>, cập nhật trong bảng chi phí để báo cáo đủ.</p>
              )}
              {report.unassignedThu.count > 0 && (
                <p>⚠ {report.unassignedThu.count} khoản thu ({formatVnd(report.unassignedThu.amount)}) <b>chưa gán &quot;TK nhận tiền&quot;</b> — cập nhật khi ghi nhận thanh toán ở Công nợ.</p>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function AccountTable({
  rows,
  onToggle,
  showToggle,
  emptyText,
}: {
  rows: Account[];
  onToggle?: (id: string, isActive: boolean) => void;
  showToggle?: boolean;
  emptyText?: string;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-gray-500">
          <th className="py-2">Tài khoản</th>
          <th className="py-2 text-right">Thu</th>
          <th className="py-2 text-right">Chi</th>
          <th className="py-2 text-right">Số dư</th>
          {showToggle && <th className="py-2 text-right">Trạng thái</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.length === 0 && (
          <tr><td colSpan={showToggle ? 5 : 4} className="py-6 text-center text-gray-400">{emptyText ?? "Chưa có tài khoản. Thêm ở ô trên."}</td></tr>
        )}
        {rows.map((a) => (
          <tr key={a.id} className={a.isActive === false ? "opacity-50" : ""}>
            <td className="py-2 font-medium text-gray-900">{a.name}</td>
            <td className="py-2 text-right font-medium text-emerald-700">{a.thu > 0 ? formatVnd(a.thu) : <span className="text-gray-300">—</span>}</td>
            <td className="py-2 text-right font-medium text-red-700">{a.chi > 0 ? formatVnd(a.chi) : <span className="text-gray-300">—</span>}</td>
            <td className="py-2 text-right font-semibold"><Balance value={a.balance} /></td>
            {showToggle && onToggle && (
              <td className="py-2 text-right">
                <button type="button" onClick={() => onToggle(a.id, a.isActive !== false)} className="text-xs text-blue-600 hover:underline">
                  {a.isActive !== false ? "Đang dùng · Tắt" : "Đã tắt · Bật"}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
