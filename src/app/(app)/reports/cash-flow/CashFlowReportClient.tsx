"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type CompanyAccount = { id: string; name: string; isActive: boolean; chi: number; count: number };
type Person = { id: string; name: string; chi: number; count: number };
type Report = {
  companyThu: number;
  companyAccounts: CompanyAccount[];
  persons: Person[];
  unassigned: { chi: number; count: number };
};

function formatVnd(n: number) {
  return n.toLocaleString("vi-VN") + " đ";
}

export default function CashFlowReportClient() {
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

  const companyChiTotal = report?.companyAccounts.reduce((s, a) => s + a.chi, 0) ?? 0;
  const companyBalance = (report?.companyThu ?? 0) - companyChiTotal;
  const personChiTotal = report?.persons.reduce((s, p) => s + p.chi, 0) ?? 0;

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Thu – chi theo tài khoản</h1>
          <p className="mt-1 text-sm text-gray-500">
            Ai thu, ai chi những gì. THU công ty = tiền thu qua hóa đơn; CHI = chi phí thực tế theo &quot;Chi từ TK&quot;.
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
          {/* KPI công ty */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-medium text-emerald-700">THU công ty (qua hóa đơn)</p>
              <p className="mt-1 text-2xl font-bold text-emerald-800">{formatVnd(report.companyThu)}</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-xs font-medium text-red-700">CHI từ các TK công ty</p>
              <p className="mt-1 text-2xl font-bold text-red-800">{formatVnd(companyChiTotal)}</p>
            </div>
            <div className={`rounded-xl border p-4 ${companyBalance >= 0 ? "border-blue-200 bg-blue-50" : "border-orange-200 bg-orange-50"}`}>
              <p className={`text-xs font-medium ${companyBalance >= 0 ? "text-blue-700" : "text-orange-700"}`}>Số dư công ty (THU − CHI)</p>
              <p className={`mt-1 text-2xl font-bold ${companyBalance >= 0 ? "text-blue-800" : "text-orange-800"}`}>{formatVnd(companyBalance)}</p>
            </div>
          </div>

          {/* Tài khoản công ty + chi theo từng TK */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-gray-900">Tài khoản công ty</h2>
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
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-2">Tài khoản</th>
                  <th className="py-2 text-right">Số khoản chi</th>
                  <th className="py-2 text-right">Tổng chi</th>
                  <th className="py-2 text-right">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {report.companyAccounts.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-gray-400">Chưa có tài khoản công ty. Thêm ở ô trên.</td></tr>
                )}
                {report.companyAccounts.map((a) => (
                  <tr key={a.id} className={a.isActive ? "" : "opacity-50"}>
                    <td className="py-2 font-medium text-gray-900">{a.name}</td>
                    <td className="py-2 text-right text-gray-600">{a.count}</td>
                    <td className="py-2 text-right font-medium text-red-700">{formatVnd(a.chi)}</td>
                    <td className="py-2 text-right">
                      <button type="button" onClick={() => toggleAccount(a.id, a.isActive)} className="text-xs text-blue-600 hover:underline">
                        {a.isActive ? "Đang dùng · Tắt" : "Đã tắt · Bật"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Chi theo cá nhân */}
          <section className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Chi theo cá nhân</h2>
              <span className="text-sm text-gray-500">Tổng: {formatVnd(personChiTotal)}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-2">Người chi</th>
                  <th className="py-2 text-right">Số khoản</th>
                  <th className="py-2 text-right">Tổng chi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {report.persons.filter((p) => p.count > 0).length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-center text-gray-400">Chưa có khoản chi nào gắn cá nhân.</td></tr>
                )}
                {report.persons.filter((p) => p.count > 0).map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 font-medium text-gray-900">{p.name}</td>
                    <td className="py-2 text-right text-gray-600">{p.count}</td>
                    <td className="py-2 text-right font-medium text-red-700">{formatVnd(p.chi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.unassigned.count > 0 && (
              <p className="mt-3 text-xs text-amber-700">
                ⚠ Còn {report.unassigned.count} khoản chi ({formatVnd(report.unassigned.chi)}) chưa gán &quot;Chi từ TK&quot; — cập nhật trong bảng chi phí để báo cáo đủ.
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
