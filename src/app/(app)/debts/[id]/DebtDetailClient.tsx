"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { COST_CATEGORY_LABELS, isVendorlessCostCategory } from "@/lib/shipment-cost-constants";
import { INVOICE_VAT_RATE } from "@/lib/personal-account-sync";
import { resolveCostPaymentAccount } from "@/lib/cost-payment-account";
import ShipmentFinanceEditorModal from "@/components/shipments/ShipmentFinanceEditorModal";
import MoneyInput from "@/components/MoneyInput";
import ShipmentLink from "@/components/shipments/ShipmentLink";

type DebtStats = { paidAmount: number; remainingAmount: number; status: string };

type NamedRef = { id: string; name: string } | null;

type Payment = {
  id: string;
  amount: number;
  paymentDate: string;
  method: string | null;
  portion: DebtPortionValue | null;
  receivedToCompanyAccount: NamedRef;
  receivedBy: NamedRef;
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
  status: string;
  note: string | null;
  createdAt: string;
  customer: { id: string; companyName: string; taxCode: string } | null;
  vendor: { id: string; name: string } | null;
  shipment: {
    id: string;
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
    subtotal: number | null;
    taxAmount: number | null;
    totalAmount: number | null;
    currency: string;
    attachmentName: string;
    attachmentUrl: string;
    xmlUrl: string | null;
    pdfUrl: string | null;
  }>;
  paidAmount: number;
  remainingAmount: number;
  payableCosts?: PayableCost[];
};

type PayableCost = {
  id: string;
  category: string;
  customLabel: string | null;
  unit: string | null;
  quantity: number;
  costPrice: number;
  isPaid: boolean;
  paidAt: string | null;
  vendor: { name: string } | null;
  paidBy: { id: string; name: string } | null;
  paidFromCompanyAccount: { id: string; name: string } | null;
  paidConfirmedBy: { name: string } | null;
};

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

function formatInvoiceMoney(amount: number | null, currency: string) {
  if (amount === null) return "—";
  return currency === "VND" ? formatVnd(amount) : `${amount.toLocaleString("vi-VN")} ${currency}`;
}

// "TK nhận tiền": giá trị gộp "company:<id>" | "user:<id>" | "" để dùng trong 1 dropdown, tách ra khi lưu.
const emptyPaymentForm = {
  amount: "",
  paymentDate: new Date().toISOString().slice(0, 10),
  method: "",
  portion: "INVOICE" as DebtPortionValue,
  receivingAccount: "",
  note: "",
  attachmentUrl: null as string | null,
};

export default function DebtDetailClient({ debtId, isAdmin, currentUserId }: { debtId: string; isAdmin: boolean; currentUserId: string }) {
  const router = useRouter();
  const [debt, setDebt] = useState<DebtDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paidCostError, setPaidCostError] = useState<string | null>(null);
  const [togglingCostId, setTogglingCostId] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  // null = đang thêm mới; có id = đang sửa khoản thanh toán đó (dùng chung một form).
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyPaymentForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tùy chọn "TK nhận tiền": TK công ty + TK cá nhân (người dùng).
  const [companyAccounts, setCompanyAccounts] = useState<Array<{ id: string; name: string; isActive: boolean }>>([]);
  const [users, setUsers] = useState<Array<{ id: string; name: string; isActive: boolean }>>([]);

  // Cửa sổ "Báo giá & chi phí" của lô hàng liên quan — ADMIN-only, vì chi phí là dữ liệu chỉ ADMIN xem được.
  const [isFinanceOpen, setIsFinanceOpen] = useState(false);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ totalAmount: "", note: "" });
  const [editError, setEditError] = useState<string | null>(null);

  // Fold the {paidAmount, remainingAmount, status} an API returns back into debt state — shared by
  // add-payment, delete-payment and edit-debt so the recompute isn't spelled out three times.
  function applyStats(stats: DebtStats) {
    setDebt((prev) => (prev ? { ...prev, ...stats } : prev));
    setPairDebts((prev) =>
      prev.map((item) =>
        item.id === debtId
          ? { ...item, paidAmount: stats.paidAmount, remainingAmount: stats.remainingAmount }
          : item
      )
    );
  }

  const loadDebt = useCallback(() => {
    return fetch(`/api/debts/${debtId}`, { cache: "no-store" })
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

  // Cả cặp công nợ (phải thu + phải trả) của lô — để xem cả hai ngay tại đây, khỏi mở riêng từng cái.
  const [pairDebts, setPairDebts] = useState<
    Array<{ id: string; type: "RECEIVABLE" | "PAYABLE"; totalAmount: number; paidAmount: number; remainingAmount: number }>
  >([]);
  const shipmentIdForPair = debt?.shipment?.id;
  const loadPairDebts = useCallback((shipmentId: string) => {
    return fetch(`/api/shipments/${shipmentId}/debts`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.success) setPairDebts(json.data);
      })
      .catch(() => {
        /* panel bổ sung, lỗi tải bỏ qua */
      });
  }, []);

  useEffect(() => {
    if (!shipmentIdForPair) return;
    void loadPairDebts(shipmentIdForPair);
  }, [loadPairDebts, shipmentIdForPair]);

  useEffect(() => {
    fetch("/api/company-accounts")
      .then((res) => res.json())
      .then((json) => { if (json.success) setCompanyAccounts(json.data); })
      .catch(() => { /* danh sách TK là phụ trợ, lỗi tải không chặn form */ });
    fetch("/api/users")
      .then((res) => res.json())
      .then((json) => { if (json.success) setUsers(json.data); })
      .catch(() => { /* tương tự */ });
  }, []);

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
            receivedToCompanyAccountId: form.receivingAccount.startsWith("company:")
              ? form.receivingAccount.slice("company:".length)
              : null,
            receivedByUserId: form.receivingAccount.startsWith("user:")
              ? form.receivingAccount.slice("user:".length)
              : null,
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

  async function handleToggleCostPaid(
    cost: PayableCost,
    nextPaid: boolean,
    paidAt?: string
  ) {
    setPaidCostError(null);
    setTogglingCostId(cost.id);
    try {
      const res = await fetch(`/api/debts/${debtId}/payable-costs/${cost.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isPaid: nextPaid,
          ...(paidAt ? { paidAt } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể cập nhật.");
      setDebt((prev) =>
        prev
          ? {
              ...prev,
              payableCosts: (prev.payableCosts ?? []).map((c) =>
                c.id === cost.id
                  ? { ...c, isPaid: json.data.isPaid, paidAt: json.data.paidAt, paidConfirmedBy: json.data.paidConfirmedBy }
                  : c
              ),
            }
          : prev
      );
    } catch (err) {
      setPaidCostError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setTogglingCostId(null);
    }
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
      receivingAccount: payment.receivedToCompanyAccount
        ? `company:${payment.receivedToCompanyAccount.id}`
        : payment.receivedBy
          ? `user:${payment.receivedBy.id}`
          : "",
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

  const badge = debtStatusBadge(debt.status, null);
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
  const paidPercent =
    debt.totalAmount > 0 ? Math.min(100, Math.round((debt.paidAmount / debt.totalAmount) * 100)) : 0;
  const receivableDebt = pairDebts.find((item) => item.type === "RECEIVABLE");
  const payableDebt = pairDebts.find((item) => item.type === "PAYABLE");
  const estimatedMargin =
    receivableDebt && payableDebt ? receivableDebt.totalAmount - payableDebt.totalAmount : null;
  const payableCostTotal = (debt.payableCosts ?? []).reduce((sum, cost) => sum + cost.costPrice, 0);
  const paidCostTotal = (debt.payableCosts ?? [])
    .filter((cost) => cost.isPaid)
    .reduce((sum, cost) => sum + cost.costPrice, 0);
  const unpaidCostTotal = payableCostTotal - paidCostTotal;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
      <Link href="/debts" className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-700">
        ← Quay lại danh sách công nợ
      </Link>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                Công nợ {DEBT_TYPE_LABELS[debt.type].toLowerCase()}
              </span>
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
                {badge.label}
              </span>
              {debt.sourceKey && (
                <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  Đồng bộ tự động
                </span>
              )}
            </div>
            <h1 className="mt-2 break-words text-2xl font-bold text-gray-950 sm:text-3xl">{partnerName}</h1>
            {debt.shipment && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
                <ShipmentLink shipmentId={debt.shipment.id} className="font-semibold text-blue-700 hover:underline">
                  TK {debt.shipment.declarationNo || "Chưa có số tờ khai"}
                </ShipmentLink>
                <span>{debt.shipment.goodsName || "Chưa có tên hàng"}</span>
                {debt.shipment.declarationDate && (
                  <span>Ngày TK {new Date(debt.shipment.declarationDate).toLocaleDateString("vi-VN")}</span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            {debt.remainingAmount > 0 && (
              <button
                type="button"
                onClick={openPaymentForm}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                + Ghi nhận thanh toán
              </button>
            )}
            <button
              type="button"
              onClick={openEdit}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Sửa thông tin
            </button>
            {!debt.sourceKey && (
              <button
                type="button"
                onClick={handleDeleteDebt}
                className="rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                Xóa công nợ
              </button>
            )}
          </div>
        </div>
      </section>

      <section aria-label="Tổng quan công nợ" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Tổng công nợ" value={formatVnd(debt.totalAmount)} tone="neutral" />
        <MetricCard label="Đã thanh toán" value={formatVnd(debt.paidAmount)} tone="success" />
        <MetricCard
          label={debt.type === "RECEIVABLE" ? "Còn phải thu" : "Còn phải trả"}
          value={formatVnd(debt.remainingAmount)}
          tone={debt.remainingAmount > 0 ? "danger" : "success"}
        />
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Tiến độ thanh toán</p>
            <span className="text-sm font-bold text-gray-900">{paidPercent}%</span>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${paidPercent}%` }} />
          </div>
          <p className="mt-3 text-xs text-gray-500">{debt.payments.length} lần thanh toán đã ghi nhận</p>
        </div>
      </section>

      {debt.shipment && pairDebts.some((d) => d.id === debt.id) && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-gray-950">Đối chiếu tài chính theo tờ khai</h2>
              <p className="mt-1 text-sm text-gray-500">So sánh phải thu và phải trả của cùng số tờ khai.</p>
            </div>
            {estimatedMargin !== null && (
              <div className="rounded-lg bg-violet-50 px-4 py-2 text-right">
                <p className="text-xs font-medium text-violet-600">Chênh lệch thu − chi</p>
                <p className={`text-base font-bold ${estimatedMargin >= 0 ? "text-violet-800" : "text-red-700"}`}>
                  {formatVnd(estimatedMargin)}
                </p>
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["RECEIVABLE", "PAYABLE"] as const).map((type) => {
              const d = pairDebts.find((x) => x.type === type);
              const isCurrent = d?.id === debt.id;
              const isReceivable = type === "RECEIVABLE";
              const card = (
                <div
                  className={`h-full rounded-lg border p-4 ${
                    isReceivable ? "border-blue-200 bg-blue-50/60" : "border-emerald-200 bg-emerald-50/60"
                  } ${isCurrent ? (isReceivable ? "ring-2 ring-blue-400" : "ring-2 ring-emerald-400") : d ? "hover:brightness-95" : "opacity-60"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${isReceivable ? "text-blue-800" : "text-emerald-800"}`}>
                      {isReceivable ? "Khách hàng phải trả NQ" : "NQ phải trả chi phí"}
                    </span>
                    {isCurrent && (
                      <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                        Đang xem
                      </span>
                    )}
                  </div>
                  {d ? (
                    <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                      <PairMetric label="Tổng" value={d.totalAmount} />
                      <PairMetric label={isReceivable ? "Đã thu" : "Đã trả"} value={d.paidAmount} valueClassName="text-emerald-700" />
                      <PairMetric label="Còn lại" value={d.remainingAmount} valueClassName="text-gray-950" />
                    </dl>
                  ) : (
                    <p className="mt-3 text-sm text-gray-400">Chưa phát sinh công nợ.</p>
                  )}
                </div>
              );
              if (d && !isCurrent) {
                return (
                  <button key={type} type="button" onClick={() => router.push(`/debts/${d.id}`)} className="text-left">
                    {card}
                  </button>
                );
              }
              return <div key={type}>{card}</div>;
            })}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-4 sm:px-6">
          <h2 className="text-base font-semibold text-gray-950">Thông tin tờ khai và đối tác</h2>
          <p className="mt-1 text-sm text-gray-500">Thông tin nhận diện dùng để đối chiếu công nợ, chi phí và hóa đơn.</p>
        </div>
        <dl className="grid grid-cols-1 gap-px bg-gray-100 sm:grid-cols-2 xl:grid-cols-4">
          <Info
            label="Số tờ khai"
            value={
              debt.shipment ? (
                <ShipmentLink shipmentId={debt.shipment.id} className="font-semibold text-blue-700 hover:underline">
                  {debt.shipment.declarationNo || "Chưa có số tờ khai"}
                </ShipmentLink>
              ) : null
            }
          />
          <Info
            label="Ngày tờ khai"
            value={debt.shipment?.declarationDate ? new Date(debt.shipment.declarationDate).toLocaleDateString("vi-VN") : null}
          />
          <Info label={debt.type === "RECEIVABLE" ? "Khách hàng" : "Nhà cung cấp"} value={partnerName} />
          <Info label="Loại công nợ" value={DEBT_TYPE_LABELS[debt.type]} />
          <Info label="Tên hàng" value={debt.shipment?.goodsName} className="xl:col-span-2" />
          <Info label="Số invoice trên tờ khai" value={debt.shipment?.invoiceNo} />
          <Info label="Nguồn dữ liệu" value={debt.sourceKey ? "Đồng bộ từ tài chính lô hàng" : "Nhập trực tiếp"} />
          <Info label="Ghi chú" value={debt.note} className="sm:col-span-2 xl:col-span-4" />
        </dl>
      </section>

      {breakdown && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-gray-950">Cơ cấu công nợ</h2>
            <p className="mt-1 text-sm text-gray-500">Tách rõ phần có hóa đơn, tiền trước thuế, VAT và phần không hóa đơn.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <PortionCard
              label={`Có hóa đơn (VAT ${invoiceVatPercent}%)`}
              total={breakdown.invoiceAmount}
              beforeTax={invoiceBeforeTax}
              taxAmount={invoiceTaxAmount}
              taxRatePercent={invoiceVatPercent}
              paid={breakdown.paidInvoice}
              remaining={breakdown.remainingInvoice}
              paidLabel={debt.type === "RECEIVABLE" ? "Đã thu" : "Đã trả"}
              className="border-green-200 bg-green-50/60"
              accent="text-green-800"
            />
            <PortionCard
              label="Không hóa đơn"
              total={breakdown.noInvoiceAmount}
              paid={breakdown.paidNoInvoice}
              remaining={breakdown.remainingNoInvoice}
              paidLabel={debt.type === "RECEIVABLE" ? "Đã thu" : "Đã trả"}
              className="border-orange-200 bg-orange-50/60"
              accent="text-orange-800"
            />
          </div>
        </section>
      )}

      {debt.shipment && (
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-6">
            <div>
              <h2 className="text-base font-semibold text-gray-950">Hóa đơn liên kết</h2>
              <p className="mt-1 text-sm text-gray-500">Đối chiếu hóa đơn đầu vào/đầu ra với tờ khai và công nợ.</p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsFinanceOpen(true)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                Mở báo giá &amp; chi phí lô hàng
              </button>
            )}
          </div>
          {debt.linkedInvoices.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm font-medium text-gray-600">Chưa có hóa đơn liên kết với tờ khai này.</p>
              <p className="mt-1 text-xs text-gray-400">Hệ thống sẽ hiển thị tại đây khi xác định được đúng hóa đơn.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50/80">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold text-gray-600">Loại</th>
                    <th className="px-5 py-3 text-left font-semibold text-gray-600">Số / ngày hóa đơn</th>
                    <th className="px-5 py-3 text-right font-semibold text-gray-600">Trước thuế</th>
                    <th className="px-5 py-3 text-right font-semibold text-gray-600">Thuế VAT</th>
                    <th className="px-5 py-3 text-right font-semibold text-gray-600">Tổng gồm thuế</th>
                    <th className="px-5 py-3 text-center font-semibold text-gray-600">Tệp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {debt.linkedInvoices.map((invoice) => {
                    const fileUrl = invoice.pdfUrl || invoice.xmlUrl || invoice.attachmentUrl;
                    const isOutput = invoice.invoiceDirection === "OUTPUT";
                    const isInput = invoice.invoiceDirection === "INPUT";
                    return (
                      <tr key={invoice.id} className="hover:bg-gray-50/70">
                        <td className="px-5 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${isOutput ? "bg-blue-50 text-blue-700" : isInput ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                            {isOutput ? "Bán ra" : isInput ? "Đầu vào" : "Chưa xác định"}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="font-medium text-gray-900">{invoice.invoiceNumber || "Chưa rõ số"}</div>
                          <div className="mt-0.5 text-xs text-gray-500">
                            {invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString("vi-VN") : "Chưa có ngày hóa đơn"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-gray-700">
                          {formatInvoiceMoney(invoice.subtotal, invoice.currency)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-gray-700">
                          {formatInvoiceMoney(invoice.taxAmount, invoice.currency)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-gray-950">
                          {formatInvoiceMoney(invoice.totalAmount, invoice.currency)}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <AttachmentPreviewButton
                            url={fileUrl}
                            name={invoice.attachmentName}
                            className="font-medium text-blue-700 hover:underline"
                          >
                            Xem tệp
                          </AttachmentPreviewButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {debt.type === "PAYABLE" && (debt.payableCosts?.length ?? 0) > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-950">Theo dõi thanh toán từng khoản chi</h2>
                <p className="mt-1 text-sm text-gray-500">Kiểm tra nhà cung cấp, tài khoản chi và ngày đã thanh toán.</p>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                {debt.payableCosts!.filter((cost) => cost.isPaid).length}/{debt.payableCosts!.length} khoản đã trả
              </span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <CostSummary label="Tổng chi phí" value={payableCostTotal} />
              <CostSummary label="Đã thanh toán" value={paidCostTotal} tone="success" />
              <CostSummary label="Chưa thanh toán" value={unpaidCostTotal} tone="danger" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50/80">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Hạng mục</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Nhà cung cấp</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">SL / ĐVT</th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">Số tiền</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">TK chi</th>
                  <th className="px-5 py-3 text-center font-semibold text-gray-600">Trạng thái / ngày trả</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {debt.payableCosts!.map((cost) => {
                  const paymentAccount = resolveCostPaymentAccount(cost);
                  const canTick = isAdmin || cost.paidBy?.id === currentUserId || Boolean(cost.paidFromCompanyAccount);
                  return (
                    <tr key={cost.id} className={cost.isPaid ? "bg-emerald-50/30" : "hover:bg-gray-50/60"}>
                      <td className="px-5 py-3 font-medium text-gray-900">
                        {cost.customLabel || COST_CATEGORY_LABELS[cost.category] || cost.category}
                      </td>
                      <td className="px-5 py-3 text-gray-600">
                        {isVendorlessCostCategory(cost.category) ? (
                          <span className="text-gray-400">Không áp dụng</span>
                        ) : cost.vendor?.name ? (
                          cost.vendor.name
                        ) : (
                          <span className="font-medium text-amber-600">Chưa gắn NCC</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-gray-600">
                        {cost.quantity.toLocaleString("vi-VN")} {cost.unit || ""}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-gray-950">{formatVnd(cost.costPrice)}</td>
                      <td className="px-5 py-3 text-gray-600">
                        {paymentAccount?.label || <span className="font-medium text-amber-600">Chưa chọn TK chi</span>}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex min-w-36 flex-col items-center gap-1.5">
                          <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-600">
                            <input
                              type="checkbox"
                              checked={cost.isPaid}
                              disabled={!canTick || togglingCostId === cost.id}
                              onChange={(event) => handleToggleCostPaid(cost, event.target.checked)}
                              className="h-4 w-4 cursor-pointer accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                              title={canTick ? "Tích khi đã thanh toán" : "Chỉ người phụ trách TK chi mới tích được"}
                            />
                            {cost.isPaid ? "Đã thanh toán" : "Chưa thanh toán"}
                          </label>
                          {cost.isPaid && cost.paidAt && (
                            <>
                              <input
                                type="date"
                                value={cost.paidAt.slice(0, 10)}
                                disabled={!canTick || togglingCostId === cost.id}
                                onChange={(event) => handleToggleCostPaid(cost, true, event.target.value)}
                                className="input h-8 w-36 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:bg-gray-100"
                                title="Sửa ngày thanh toán"
                              />
                              {cost.paidConfirmedBy?.name && (
                                <span className="text-[11px] text-emerald-700">Xác nhận: {cost.paidConfirmedBy.name}</span>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {paidCostError && <p className="border-t border-red-100 bg-red-50 px-6 py-3 text-sm text-red-700">{paidCostError}</p>}
        </section>
      )}

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-base font-semibold text-gray-950">Lịch sử thanh toán</h2>
            <p className="mt-1 text-sm text-gray-500">Mỗi lần thu hoặc trả tiền được lưu thành một giao dịch riêng.</p>
          </div>
          <button
            type="button"
            onClick={openPaymentForm}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            + Ghi nhận thanh toán
          </button>
        </div>
        {debt.payments.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">Chưa có giao dịch thanh toán nào.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50/80">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Ngày thanh toán</th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">Số tiền</th>
                  {breakdown && <th className="px-5 py-3 text-left font-semibold text-gray-600">Phân loại</th>}
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Phương thức</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">
                    {debt.type === "RECEIVABLE" ? "TK nhận tiền" : "TK thanh toán"}
                  </th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Ghi chú</th>
                  <th className="px-5 py-3 text-center font-semibold text-gray-600">Biên lai</th>
                  <th className="px-5 py-3 text-right font-semibold text-gray-600">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {debt.payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-gray-50/60">
                    <td className="whitespace-nowrap px-5 py-3 text-gray-700">
                      {new Date(payment.paymentDate).toLocaleDateString("vi-VN")}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-gray-950">{formatVnd(payment.amount)}</td>
                    {breakdown && (
                      <td className="px-5 py-3">
                        {payment.portion ? (
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${payment.portion === "INVOICE" ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}>
                            {DEBT_PORTION_LABELS[payment.portion]}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-5 py-3 text-gray-600">{payment.method || "—"}</td>
                    <td className="px-5 py-3">
                      {payment.receivedToCompanyAccount ? (
                        <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">{payment.receivedToCompanyAccount.name}</span>
                      ) : payment.receivedBy ? (
                        <span className="inline-flex rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">{payment.receivedBy.name}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="max-w-xs px-5 py-3 text-gray-600">{payment.note || "—"}</td>
                    <td className="px-5 py-3 text-center">
                      {payment.attachmentUrl ? (
                        <AttachmentPreviewButton url={payment.attachmentUrl} className="font-medium text-blue-700 hover:underline">
                          Xem biên lai
                        </AttachmentPreviewButton>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      <button type="button" onClick={() => openEditPayment(payment)} className="text-xs font-semibold text-blue-700 hover:underline">
                        Sửa
                      </button>
                      <button type="button" onClick={() => handleDeletePayment(payment.id)} className="ml-3 text-xs font-semibold text-red-600 hover:underline">
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  {debt.type === "RECEIVABLE" ? "TK nhận tiền" : "TK thanh toán"}
                </span>
                <select
                  value={form.receivingAccount}
                  onChange={(e) => setForm((prev) => ({ ...prev, receivingAccount: e.target.value }))}
                  className="input"
                >
                  <option value="">— Chưa chọn —</option>
                  {companyAccounts.length > 0 && (
                    <optgroup label="TK công ty">
                      {companyAccounts
                        .filter((a) => a.isActive || form.receivingAccount === `company:${a.id}`)
                        .map((a) => (
                          <option key={a.id} value={`company:${a.id}`}>{a.name}{!a.isActive ? " (ngừng)" : ""}</option>
                        ))}
                    </optgroup>
                  )}
                  {users.length > 0 && (
                    <optgroup label="TK cá nhân">
                      {users
                        .filter((u) => u.isActive || form.receivingAccount === `user:${u.id}`)
                        .map((u) => (
                          <option key={u.id} value={`user:${u.id}`}>{u.name}{!u.isActive ? " (đã khóa)" : ""}</option>
                        ))}
                    </optgroup>
                  )}
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
          onClose={() => {
            setIsFinanceOpen(false);
            void Promise.all([loadDebt(), loadPairDebts(debt.shipment!.id)]);
          }}
          onCostsChanged={() => void Promise.all([loadDebt(), loadPairDebts(debt.shipment!.id)])}
        />
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "success" | "danger";
}) {
  const toneClasses = {
    neutral: "border-gray-200 text-gray-950",
    success: "border-emerald-200 text-emerald-700",
    danger: "border-red-200 text-red-700",
  };
  return (
    <div className={`rounded-xl border bg-white p-5 shadow-sm ${toneClasses[tone]}`}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-3 text-2xl font-bold tracking-tight">{value}</p>
    </div>
  );
}

function PairMetric({
  label,
  value,
  valueClassName = "text-gray-900",
}: {
  label: string;
  value: number;
  valueClassName?: string;
}) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`mt-1 whitespace-nowrap font-semibold ${valueClassName}`}>{formatVnd(value)}</dd>
    </div>
  );
}

function CostSummary({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "success" | "danger";
}) {
  const valueClassName = tone === "success" ? "text-emerald-700" : tone === "danger" ? "text-red-700" : "text-gray-950";
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-4 py-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${valueClassName}`}>{formatVnd(value)}</p>
    </div>
  );
}

function Info({
  label,
  value,
  className = "",
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white px-5 py-4 sm:px-6 ${className}`}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-1.5 break-words text-sm font-medium text-gray-900">{value || "—"}</dd>
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
  paidLabel,
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
  paidLabel: "Đã thu" | "Đã trả";
  className: string;
  accent: string;
}) {
  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold ${accent}`}>{label}</span>
        {remaining <= 0 && total > 0 && (
          <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            {paidLabel} đủ
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
          <dt className="text-gray-500">{paidLabel}</dt>
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
