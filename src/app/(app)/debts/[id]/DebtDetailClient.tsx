"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DEBT_PORTION_LABELS,
  DEBT_TYPE_LABELS,
  computeInvoiceSplitBreakdown,
  debtStatusBadge,
  hasInvoiceSplit,
  type DebtPortionValue,
} from "@/lib/debt-constants";
import AttachmentPreviewButton from "@/components/shipments/AttachmentPreviewButton";
import { INVOICE_VAT_RATE } from "@/lib/personal-account-sync";
import ShipmentFinanceEditorModal from "@/components/shipments/ShipmentFinanceEditorModal";
import MoneyInput from "@/components/MoneyInput";
import ShipmentLink from "@/components/shipments/ShipmentLink";

type DebtStats = { paidAmount: number; remainingAmount: number; status: string };

type Payment = {
  id: string;
  amount: number;
  paymentDate: string;
  method: string | null;
  portion: DebtPortionValue | null;
  attachmentUrl: string | null;
  note: string | null;
  createdAt: string;
};

type DebtDetail = {
  id: string;
  sourceKey: string | null;
  type: "RECEIVABLE" | "PAYABLE";
  totalAmount: number;
  invoiceAmount: number | null;
  noInvoiceAmount: number | null;
  dueDate: string | null;
  status: string;
  note: string | null;
  createdAt: string;
  customer: { id: string; companyName: string; taxCode: string } | null;
  vendor: { id: string; name: string } | null;
  shipment: {
    id: string;
    shipmentCode: string;
    customerName: string;
    goodsName: string | null;
    declarationNo: string | null;
    declarationDate: string | null;
    invoiceNo: string | null;
  } | null;
  payments: Payment[];
  linkedInvoices: Array<{
    id: string;
    invoiceDirection: "INPUT" | "OUTPUT" | "UNRELATED" | "UNKNOWN";
    invoiceNumber: string | null;
    invoiceDate: string | null;
    totalAmount: number | null;
    currency: string;
    attachmentName: string;
    attachmentUrl: string;
    xmlUrl: string | null;
    pdfUrl: string | null;
  }>;
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
  portion: "INVOICE" as DebtPortionValue,
  note: "",
  attachmentUrl: null as string | null,
};

export default function DebtDetailClient({ debtId, isAdmin }: { debtId: string; isAdmin: boolean }) {
  const router = useRouter();
  const [debt, setDebt] = useState<DebtDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  // null = đang thêm mới; có id = đang sửa khoản thanh toán đó (dùng chung một form).
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyPaymentForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cửa sổ "Báo giá & chi phí" của lô hàng liên quan — ADMIN-only, vì chi phí là dữ liệu chỉ ADMIN xem được.
  const [isFinanceOpen, setIsFinanceOpen] = useState(false);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ totalAmount: "", dueDate: "", note: "" });
  const [editError, setEditError] = useState<string | null>(null);

  // Fold the {paidAmount, remainingAmount, status} an API returns back into debt state — shared by
  // add-payment, delete-payment and edit-debt so the recompute isn't spelled out three times.
  function applyStats(stats: DebtStats) {
    setDebt((prev) => (prev ? { ...prev, ...stats } : prev));
  }

  const loadDebt = useCallback(() => {
    return fetch(`/api/debts/${debtId}`)
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể tải công nợ.");
        setDebt(json.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, [debtId]);

  useEffect(() => {
    loadDebt();
  }, [loadDebt]);

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
      const res = await fetch(
        editingPaymentId ? `/api/debts/${debtId}/payments/${editingPaymentId}` : `/api/debts/${debtId}/payments`,
        {
          method: editingPaymentId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: form.amount,
            paymentDate: form.paymentDate,
            method: form.method,
            portion: debt && hasInvoiceSplit(debt) ? form.portion : undefined,
            attachmentUrl: form.attachmentUrl,
            note: form.note,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || (editingPaymentId ? "Không thể sửa thanh toán." : "Không thể ghi nhận thanh toán."));
      }

      setDebt((prev) =>
        prev
          ? {
              ...prev,
              payments: editingPaymentId
                ? prev.payments.map((p) => (p.id === editingPaymentId ? json.data.payment : p))
                : [json.data.payment, ...prev.payments],
            }
          : prev
      );
      applyStats(json.data);
      setEditingPaymentId(null);
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

  function openPaymentForm() {
    // Mặc định chọn phần còn nợ: nếu phần có hóa đơn đã trả đủ thì nhảy sang không hóa đơn.
    const bd = debt ? computeInvoiceSplitBreakdown(debt) : null;
    const defaultPortion: DebtPortionValue =
      bd && bd.remainingInvoice <= 0 && bd.remainingNoInvoice > 0 ? "NO_INVOICE" : "INVOICE";
    setEditingPaymentId(null);
    setForm({ ...emptyPaymentForm, portion: defaultPortion });
    setFormError(null);
    setIsFormOpen(true);
  }

  /** Cùng form với "Ghi nhận thanh toán"; `editingPaymentId` khác null nghĩa là đang sửa. */
  function openEditPayment(payment: Payment) {
    setEditingPaymentId(payment.id);
    setForm({
      amount: String(payment.amount),
      paymentDate: payment.paymentDate.slice(0, 10),
      method: payment.method || "",
      portion: payment.portion ?? "INVOICE",
      note: payment.note || "",
      attachmentUrl: payment.attachmentUrl,
    });
    setFormError(null);
    setIsFormOpen(true);
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
    if (!debt?.sourceKey && (!editForm.totalAmount || Number(editForm.totalAmount) <= 0)) {
      setEditError("Tổng tiền phải lớn hơn 0.");
      return;
    }
    try {
      const res = await fetch(`/api/debts/${debtId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(debt?.sourceKey ? {} : { totalAmount: editForm.totalAmount }),
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
  const breakdown = computeInvoiceSplitBreakdown(debt);
  const invoiceBeforeTax = breakdown
    ? Math.round(breakdown.invoiceAmount / (1 + INVOICE_VAT_RATE))
    : 0;
  const invoiceTaxAmount = breakdown ? breakdown.invoiceAmount - invoiceBeforeTax : 0;
  const invoiceVatPercent = Math.round(INVOICE_VAT_RATE * 100);
  const partnerName =
    debt.customer?.companyName ||
    debt.vendor?.name ||
    (debt.sourceKey
      ? debt.type === "RECEIVABLE"
        ? debt.shipment?.customerName || "Khách hàng lô hàng"
        : "Chi phí lô hàng"
      : "—");

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
            {debt.sourceKey && (
              <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                Tự động từ lô hàng
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={openEdit}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Sửa
            </button>
            {!debt.sourceKey && (
              <button
                type="button"
                onClick={handleDeleteDebt}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Xóa nợ
              </button>
            )}
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
                  <ShipmentLink shipmentId={debt.shipment.id} className="text-blue-600 hover:underline">
                    {debt.shipment.goodsName || debt.shipment.shipmentCode}
                  </ShipmentLink>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <Info label="Ghi chú" value={debt.note} />
            {debt.sourceKey && <Info label="Nguồn" value="Đồng bộ tự động từ tài chính lô hàng" />}
          </dl>

          {breakdown && (
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <PortionCard
                label={`Có hóa đơn (VAT ${invoiceVatPercent}%)`}
                total={breakdown.invoiceAmount}
                beforeTax={invoiceBeforeTax}
                taxAmount={invoiceTaxAmount}
                taxRatePercent={invoiceVatPercent}
                paid={breakdown.paidInvoice}
                remaining={breakdown.remainingInvoice}
                className="border-green-200 bg-green-50/60"
                accent="text-green-800"
              />
              <PortionCard
                label="Không hóa đơn"
                total={breakdown.noInvoiceAmount}
                paid={breakdown.paidNoInvoice}
                remaining={breakdown.remainingNoInvoice}
                className="border-orange-200 bg-orange-50/60"
                accent="text-orange-800"
              />
            </div>
          )}

          {debt.shipment && (
            <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Chi phí và hóa đơn liên kết</h3>
                {isAdmin && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setIsFinanceOpen(true)}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700"
                    >
                      Xem báo giá &amp; chi phí
                    </button>
                    <Link
                      href={`/costs?shipmentId=${debt.shipment.id}`}
                      className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-blue-700 shadow-sm ring-1 ring-blue-200 hover:bg-blue-50"
                    >
                      Mở chi phí lô hàng
                    </Link>
                  </div>
                )}
              </div>
              {debt.linkedInvoices.length === 0 ? (
                <p className="mt-3 text-sm text-gray-400">Chưa có hóa đơn được xác định thuộc lô hàng này.</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {debt.linkedInvoices.map((invoice) => {
                    const fileUrl = invoice.pdfUrl || invoice.xmlUrl || invoice.attachmentUrl;
                    return (
                      <AttachmentPreviewButton
                        key={invoice.id}
                        url={fileUrl}
                        name={invoice.attachmentName}
                        className="rounded-md bg-white px-3 py-2 text-xs text-gray-700 shadow-sm ring-1 ring-gray-200 hover:ring-blue-300"
                      >
                        <span className={`mr-1.5 font-semibold ${invoice.invoiceDirection === "OUTPUT" ? "text-blue-700" : "text-emerald-700"}`}>
                          {invoice.invoiceDirection === "OUTPUT" ? "Bán ra" : "Đầu vào"}
                        </span>
                        HĐ {invoice.invoiceNumber || "chưa rõ số"}
                        {invoice.totalAmount !== null && ` · ${formatVnd(invoice.totalAmount)}`}
                      </AttachmentPreviewButton>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Lịch sử thanh toán</h3>
              <button
                type="button"
                onClick={openPaymentForm}
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
                      {breakdown && <th className="px-3 py-2 text-left font-medium text-gray-500">Phần</th>}
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
                        {breakdown && (
                          <td className="px-3 py-2">
                            {p.portion ? (
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${p.portion === "INVOICE" ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}>
                                {DEBT_PORTION_LABELS[p.portion]}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2 text-gray-600">{p.method || "—"}</td>
                        <td className="px-3 py-2 text-gray-600">{p.note || "—"}</td>
                        <td className="px-3 py-2">
                          {p.attachmentUrl ? (
                            <AttachmentPreviewButton
                              url={p.attachmentUrl}
                              className="text-blue-600 hover:underline"
                            >
                              📎 Xem
                            </AttachmentPreviewButton>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <button
                            type="button"
                            onClick={() => openEditPayment(p)}
                            className="text-xs font-medium text-blue-600 hover:underline"
                          >
                            ✏️ Sửa
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePayment(p.id)}
                            className="ml-3 text-xs font-medium text-red-600 hover:underline"
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
            <h2 className="mb-4 text-base font-semibold text-gray-900">
              {editingPaymentId ? "Sửa thanh toán" : "Ghi nhận thanh toán"}
            </h2>
            <form onSubmit={handleSubmitPayment} className="space-y-4">
              {breakdown && (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-gray-700">Thanh toán cho phần</span>
                  <select
                    value={form.portion}
                    onChange={(e) => setForm((prev) => ({ ...prev, portion: e.target.value as DebtPortionValue }))}
                    className="input"
                  >
                    <option value="INVOICE">
                      {DEBT_PORTION_LABELS.INVOICE} · còn {formatVnd(breakdown.remainingInvoice)}
                    </option>
                    <option value="NO_INVOICE">
                      {DEBT_PORTION_LABELS.NO_INVOICE} · còn {formatVnd(breakdown.remainingNoInvoice)}
                    </option>
                  </select>
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Số tiền</span>
                <MoneyInput
                  value={form.amount}
                  onValueChange={(raw) => setForm((prev) => ({ ...prev, amount: raw }))}
                  className="input"
                />
                {breakdown && (
                  <span className="mt-1 block text-xs text-gray-400">
                    Còn lại phần {DEBT_PORTION_LABELS[form.portion].toLowerCase()}:{" "}
                    {formatVnd(form.portion === "INVOICE" ? breakdown.remainingInvoice : breakdown.remainingNoInvoice)}
                  </span>
                )}
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
                  {editingPaymentId ? "Lưu thay đổi" : "Lưu thanh toán"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPaymentId(null);
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
                <MoneyInput
                  value={editForm.totalAmount}
                  onValueChange={(raw) => setEditForm((prev) => ({ ...prev, totalAmount: raw }))}
                  className={`input ${debt.sourceKey ? "cursor-not-allowed bg-gray-100 text-gray-500" : ""}`}
                  disabled={Boolean(debt.sourceKey)}
                />
                <span className="mt-1 block text-xs text-gray-400">
                  {debt.sourceKey
                    ? "Số tiền được đồng bộ từ báo giá hoặc chi phí lô hàng; hãy sửa tại tài chính lô hàng."
                    : `Đã thanh toán ${formatVnd(debt.paidAmount)} — sửa tổng tiền sẽ tính lại trạng thái.`}
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

      {/* Sửa báo giá trong cửa sổ này sẽ đồng bộ lại công nợ (syncShipmentDebts) → tải lại công nợ. */}
      {isFinanceOpen && debt.shipment && (
        <ShipmentFinanceEditorModal
          shipment={debt.shipment}
          onClose={() => setIsFinanceOpen(false)}
          onCostsChanged={loadDebt}
        />
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

function PortionCard({
  label,
  total,
  beforeTax,
  taxAmount,
  taxRatePercent,
  paid,
  remaining,
  className,
  accent,
}: {
  label: string;
  total: number;
  beforeTax?: number;
  taxAmount?: number;
  taxRatePercent?: number;
  paid: number;
  remaining: number;
  className: string;
  accent: string;
}) {
  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold ${accent}`}>{label}</span>
        {remaining <= 0 && total > 0 && (
          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Đã thu đủ
          </span>
        )}
      </div>
      <dl className="mt-2 space-y-1 text-sm">
        {beforeTax !== undefined && (
          <div className="flex justify-between">
            <dt className="text-gray-500">Tiền trước thuế</dt>
            <dd className="font-medium text-gray-900">{formatVnd(beforeTax)}</dd>
          </div>
        )}
        {taxAmount !== undefined && (
          <div className="flex justify-between">
            <dt className="text-gray-500">
              Thuế VAT{taxRatePercent !== undefined ? ` (${taxRatePercent}%)` : ""}
            </dt>
            <dd className="font-medium text-gray-900">{formatVnd(taxAmount)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className={beforeTax !== undefined ? "font-medium text-gray-700" : "text-gray-500"}>
            {beforeTax !== undefined ? "Tổng gồm thuế" : "Tổng"}
          </dt>
          <dd className="font-semibold text-gray-900">{formatVnd(total)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Đã thu</dt>
          <dd className="font-medium text-green-700">{formatVnd(paid)}</dd>
        </div>
        <div className="flex justify-between border-t border-gray-200/70 pt-1">
          <dt className="text-gray-600">Còn lại</dt>
          <dd className={`font-semibold ${remaining > 0 ? accent : "text-gray-400"}`}>{formatVnd(remaining)}</dd>
        </div>
      </dl>
    </div>
  );
}
