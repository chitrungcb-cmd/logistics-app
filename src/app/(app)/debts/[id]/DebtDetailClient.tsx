"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DEBT_TYPE_LABELS,
  debtStatusBadge,
} from "@/lib/debt-constants";

type DebtStats = { paidAmount: number; remainingAmount: number; status: string };

type Payment = {
  id: string;
  amount: number;
  paymentDate: string;
  method: string | null;
  attachmentUrl: string | null;
  note: string | null;
  createdAt: string;
};

type DebtDetail = {
  id: string;
  type: "RECEIVABLE" | "PAYABLE";
  totalAmount: number;
  dueDate: string | null;
  status: string;
  note: string | null;
  createdAt: string;
  customer: { id: string; companyName: string; taxCode: string } | null;
  vendor: { id: string; name: string } | null;
  shipment: {
    id: string;
    shipmentCode: string;
    goodsName: string | null;
    declarationNo: string | null;
    declarationDate: string | null;
    invoiceNo: string | null;
  } | null;
  payments: Payment[];
  paidAmount: number;
  remainingAmount: number;
};

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

const emptyPaymentForm = {
  amount: "",
  paymentDate: new Date().toISOString().slice(0, 10),
  method: "",
  note: "",
  attachmentUrl: null as string | null,
};

export default function DebtDetailClient({ debtId }: { debtId: string }) {
  const router = useRouter();
  const [debt, setDebt] = useState<DebtDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState(emptyPaymentForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ totalAmount: "", dueDate: "", note: "" });
  const [editError, setEditError] = useState<string | null>(null);

  // Fold the {paidAmount, remainingAmount, status} an API returns back into debt state — shared by
  // add-payment, delete-payment and edit-debt so the recompute isn't spelled out three times.
  function applyStats(stats: DebtStats) {
    setDebt((prev) => (prev ? { ...prev, ...stats } : prev));
  }

  useEffect(() => {
    fetch(`/api/debts/${debtId}`)
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể tải công nợ.");
        setDebt(json.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, [debtId]);

  async function handleAttachmentChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Tải file thất bại.");
      setForm((prev) => ({ ...prev, attachmentUrl: json.data.url }));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSubmitPayment(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!form.amount || Number(form.amount) <= 0) {
      setFormError("Vui lòng nhập số tiền hợp lệ.");
      return;
    }

    try {
      const res = await fetch(`/api/debts/${debtId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: form.amount,
          paymentDate: form.paymentDate,
          method: form.method,
          attachmentUrl: form.attachmentUrl,
          note: form.note,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể ghi nhận thanh toán.");

      setDebt((prev) => (prev ? { ...prev, payments: [json.data.payment, ...prev.payments] } : prev));
      applyStats(json.data);
      setForm(emptyPaymentForm);
      setIsFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    }
  }

  async function handleDeletePayment(paymentId: string) {
    if (!confirm("Xóa khoản thanh toán này? Trạng thái công nợ sẽ được tính lại.")) return;
    const res = await fetch(`/api/debts/${debtId}/payments/${paymentId}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      alert(json.error || "Không thể xóa thanh toán.");
      return;
    }
    setDebt((prev) => (prev ? { ...prev, payments: prev.payments.filter((p) => p.id !== paymentId) } : prev));
    applyStats(json.data);
  }

  async function handleDeleteDebt() {
    if (!confirm("Xóa công nợ này? Toàn bộ lịch sử thanh toán của nó cũng bị xóa. Không thể hoàn tác.")) return;
    const res = await fetch(`/api/debts/${debtId}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      alert(json.error || "Không thể xóa công nợ.");
      return;
    }
    router.push("/debts");
  }

  function openEdit() {
    if (!debt) return;
    setEditForm({
      totalAmount: String(debt.totalAmount),
      dueDate: debt.dueDate ? debt.dueDate.slice(0, 10) : "",
      note: debt.note || "",
    });
    setEditError(null);
    setIsEditOpen(true);
  }

  async function handleEditSave(event: React.FormEvent) {
    event.preventDefault();
    setEditError(null);
    if (!editForm.totalAmount || Number(editForm.totalAmount) <= 0) {
      setEditError("Tổng tiền phải lớn hơn 0.");
      return;
    }
    try {
      const res = await fetch(`/api/debts/${debtId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalAmount: editForm.totalAmount,
          dueDate: editForm.dueDate || null,
          note: editForm.note,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể cập nhật công nợ.");
      // PATCH returns the full debt (with recomputed status + remaining) — merge it in.
      setDebt((prev) => (prev ? { ...prev, ...json.data } : prev));
      setIsEditOpen(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    }
  }

  if (isLoading) return <div className="p-8 text-gray-400">Đang tải dữ liệu...</div>;

  if (error || !debt) {
    return (
      <div className="p-8">
        <p className="text-red-600">{error || "Không tìm thấy công nợ."}</p>
        <Link href="/debts" className="mt-4 inline-block text-blue-600 hover:underline">
          ← Quay lại danh sách
        </Link>
      </div>
    );
  }

  const badge = debtStatusBadge(debt.status, debt.dueDate);
  const partnerName = debt.customer?.companyName || debt.vendor?.name || "—";

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/debts" className="text-sm text-blue-600 hover:underline">
          ← Quay lại danh sách công nợ
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">{partnerName}</h1>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
              {badge.label}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={openEdit}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Sửa
            </button>
            <button
              type="button"
              onClick={handleDeleteDebt}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Xóa nợ
            </button>
          </div>
        </div>
        <p className="mt-1 text-sm text-gray-500">{DEBT_TYPE_LABELS[debt.type]}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-lg border border-gray-200 bg-white p-6 lg:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Thông tin công nợ</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Info label="Tổng tiền" value={formatVnd(debt.totalAmount)} />
            <Info label="Đã thanh toán" value={formatVnd(debt.paidAmount)} />
            <Info label="Còn lại" value={formatVnd(debt.remainingAmount)} />
            <Info
              label="Hạn thanh toán"
              value={debt.dueDate ? new Date(debt.dueDate).toLocaleDateString("vi-VN") : null}
            />
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Lô hàng liên quan</dt>
              <dd className="mt-0.5 text-sm text-gray-900">
                {debt.shipment ? (
                  <Link href={`/shipments/${debt.shipment.id}`} className="text-blue-600 hover:underline">
                    {debt.shipment.goodsName || debt.shipment.shipmentCode}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <Info label="Ghi chú" value={debt.note} />
          </dl>

          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Lịch sử thanh toán</h3>
              <button
                type="button"
                onClick={() => setIsFormOpen(true)}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                + Ghi nhận thanh toán
              </button>
            </div>

            {debt.payments.length === 0 ? (
              <p className="text-sm text-gray-400">Chưa có thanh toán nào.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Ngày</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Số tiền</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Phương thức</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Ghi chú</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Biên lai</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {debt.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 text-gray-600">
                          {new Date(p.paymentDate).toLocaleDateString("vi-VN")}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-900">{formatVnd(p.amount)}</td>
                        <td className="px-3 py-2 text-gray-600">{p.method || "—"}</td>
                        <td className="px-3 py-2 text-gray-600">{p.note || "—"}</td>
                        <td className="px-3 py-2">
                          {p.attachmentUrl ? (
                            <a
                              href={p.attachmentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              📎 Xem
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => handleDeletePayment(p.id)}
                            className="text-xs font-medium text-red-600 hover:underline"
                          >
                            🗑 Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Tóm tắt</h2>
          <dl className="space-y-3">
            <div className="flex justify-between text-sm">
              <dt className="text-gray-500">Tổng tiền</dt>
              <dd className="font-medium text-gray-900">{formatVnd(debt.totalAmount)}</dd>
            </div>
            <div className="flex justify-between text-sm">
              <dt className="text-gray-500">Đã thanh toán</dt>
              <dd className="font-medium text-green-700">{formatVnd(debt.paidAmount)}</dd>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-3 text-sm">
              <dt className="font-medium text-gray-700">Còn lại</dt>
              <dd className="font-semibold text-gray-900">{formatVnd(debt.remainingAmount)}</dd>
            </div>
          </dl>
        </section>
      </div>

      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIsFormOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-base font-semibold text-gray-900">Ghi nhận thanh toán</h2>
            <form onSubmit={handleSubmitPayment} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Số tiền</span>
                <input
                  type="number"
                  value={form.amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                  className="input"
                  min={0}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Ngày thanh toán</span>
                <input
                  type="date"
                  value={form.paymentDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, paymentDate: e.target.value }))}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Phương thức</span>
                <select
                  value={form.method}
                  onChange={(e) => setForm((prev) => ({ ...prev, method: e.target.value }))}
                  className="input"
                >
                  <option value="">— Chọn —</option>
                  <option value="Tiền mặt">Tiền mặt</option>
                  <option value="Chuyển khoản">Chuyển khoản</option>
                </select>
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {isUploading ? "Đang tải..." : form.attachmentUrl ? "Đã đính kèm biên lai" : "+ Đính kèm biên lai"}
                </button>
                <input ref={fileInputRef} type="file" className="hidden" onChange={handleAttachmentChange} />
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</span>
                <input
                  value={form.note}
                  onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                  className="input"
                />
              </label>

              {formError && <p className="text-sm text-red-600">{formError}</p>}

              <div className="flex gap-3">
                <button
                  type="submit"
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Lưu thanh toán
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForm(emptyPaymentForm);
                    setIsFormOpen(false);
                  }}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isEditOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIsEditOpen(false)}
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-base font-semibold text-gray-900">Sửa công nợ</h2>
            <form onSubmit={handleEditSave} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Tổng tiền</span>
                <input
                  type="number"
                  value={editForm.totalAmount}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, totalAmount: e.target.value }))}
                  className="input"
                  min={0}
                />
                <span className="mt-1 block text-xs text-gray-400">
                  Đã thanh toán {formatVnd(debt.paidAmount)} — sửa tổng tiền sẽ tính lại trạng thái.
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Hạn thanh toán</span>
                <input
                  type="date"
                  value={editForm.dueDate}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</span>
                <textarea
                  value={editForm.note}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, note: e.target.value }))}
                  rows={2}
                  className="input"
                />
              </label>

              {editError && <p className="text-sm text-red-600">{editError}</p>}

              <div className="flex gap-3">
                <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  Lưu
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value || "—"}</dd>
    </div>
  );
}
