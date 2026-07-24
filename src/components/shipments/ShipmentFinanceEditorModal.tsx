"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COST_CATEGORY_LABELS,
  COST_CATEGORY_OPTIONS,
  isInvoiceCostCategory,
  isVendorlessCostCategory,
} from "@/lib/shipment-cost-constants";
import { QUOTE_LINE_LABELS, QUOTE_LINE_OPTIONS } from "@/lib/quote-line-constants";
import AttachmentPreviewButton from "./AttachmentPreviewButton";
import MoneyInput from "@/components/MoneyInput";
import { INVOICE_VAT_RATE, computeInvoiceVat, resolveInvoiceAmountWithVat } from "@/lib/personal-account-sync";

type CostDraft = {
  clientKey: string;
  id: string;
  category: string;
  customLabel: string;
  unit: string;
  unitPrice: string;
  quantity: string;
  invoiceNumber: string;
  note: string;
  vendorId: string;
  paidByUserId: string;
  isActual: boolean;
  presetId?: string | null;
};

type CostSaveStatus = "idle" | "saving" | "saved" | "error";

type VendorOption = { id: string; name: string; type: string | null };

type UserOption = { id: string; name: string; isActive: boolean };

type FinanceLinks = {
  debts: Array<{
    id: string;
    type: "RECEIVABLE" | "PAYABLE";
    totalAmount: number;
    status: string;
  }>;
  invoices: Array<{
    id: string;
    invoiceDirection: "INPUT" | "OUTPUT" | "UNRELATED" | "UNKNOWN";
    invoiceNumber: string | null;
    totalAmount: number | null;
    attachmentName: string;
    attachmentUrl: string;
    xmlUrl: string | null;
    pdfUrl: string | null;
  }>;
};

type QuoteDraft = {
  id: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  hasInvoice: boolean;
  note: string;
};

function defaultQuotes(): QuoteDraft[] {
  return QUOTE_LINE_OPTIONS.map((category) => newQuote(QUOTE_LINE_LABELS[category]));
}

function newQuote(description = ""): QuoteDraft {
  return { id: "", description, quantity: "1", unit: "", unitPrice: "0", hasInvoice: false, note: "" };
}

function newCost(category: string = COST_CATEGORY_OPTIONS[0]): CostDraft {
  return {
    clientKey: `draft-${crypto.randomUUID()}`,
    id: "",
    category,
    customLabel: "",
    unit: "",
    unitPrice: "",
    quantity: "1",
    invoiceNumber: "",
    note: "",
    vendorId: "",
    paidByUserId: "",
    isActual: true,
  };
}

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
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

export default function ShipmentFinanceEditorModal({
  shipment,
  onClose,
  onCostsChanged,
}: {
  shipment: { id: string; goodsName: string | null; declarationNo: string | null; customerName: string };
  onClose: () => void;
  onCostsChanged: () => void;
}) {
  const [costs, setCosts] = useState<CostDraft[]>([]);
  const [quotes, setQuotes] = useState<QuoteDraft[]>(defaultQuotes);
  // Phân bổ báo giá nhập tay. `invoiceAmountInput` rỗng = chưa nhập tay (tổng lấy từ bảng chi tiết).
  // `noInvoiceOverride` null = tự tính = phần còn lại của bảng chi tiết sau khi trừ ô có hóa đơn;
  // khác null = người dùng (hoặc dữ liệu đã lưu) tự đặt.
  const [invoiceAmountInput, setInvoiceAmountInput] = useState("");
  const [noInvoiceOverride, setNoInvoiceOverride] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [financeLinks, setFinanceLinks] = useState<FinanceLinks>({ debts: [], invoices: [] });
  const [activeTab, setActiveTab] = useState<"quote" | "cost">("cost");
  const [isLoading, setIsLoading] = useState(true);
  const [costSaveStatus, setCostSaveStatus] = useState<Record<string, CostSaveStatus>>({});
  const [isSavingQuotes, setIsSavingQuotes] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoSaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const costSaveInFlight = useRef(new Set<string>());
  const queuedCostDrafts = useRef(new Map<string, CostDraft>());
  const savedIds = useRef(new Map<string, string>());

  const refreshFinanceLinks = useCallback(async () => {
    try {
      const json = await fetch(`/api/shipments/${shipment.id}/finance-links`).then(readApiJson);
      if (json.success) setFinanceLinks(json.data);
    } catch {
      // Liên kết là thông tin bổ sung; lỗi tải không được làm gián đoạn việc nhập chi phí.
    }
  }, [shipment.id]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/costs?shipmentId=${shipment.id}`).then(readApiJson),
      fetch(`/api/shipments/${shipment.id}/quote-lines`).then(readApiJson),
      fetch("/api/vendors").then(readApiJson),
      fetch(`/api/shipments/${shipment.id}/finance-links`).then(readApiJson),
      fetch("/api/users").then(readApiJson),
    ])
      .then(([costJson, quoteJson, vendorJson, financeJson, userJson]) => {
        if (!costJson.success) throw new Error(costJson.error || "Không thể tải chi phí.");
        const loadedCosts: CostDraft[] = costJson.data.map((cost: { id: string; category: string; customLabel?: string | null; unit?: string | null; unitPrice: number; quantity: number; invoiceNumber: string | null; note: string | null; presetId?: string | null; vendorId?: string | null; paidByUserId?: string | null; isActual?: boolean }) => ({
          clientKey: `cost-${cost.id}`,
          id: cost.id,
          category: cost.category,
          customLabel: cost.customLabel || "",
          unit: cost.unit || "",
          unitPrice: String(cost.unitPrice),
          quantity: String(cost.quantity),
          invoiceNumber: cost.invoiceNumber || "",
          note: cost.note || "",
          vendorId: isVendorlessCostCategory(cost.category) ? "" : cost.vendorId || "",
          paidByUserId: cost.paidByUserId || "",
          presetId: cost.presetId,
          isActual: cost.isActual ?? true,
        }));
        // Always show the complete cost taxonomy. Existing rows stay intact (including multiple
        // entries in one category); a blank draft is added only for categories with no row yet.
        setCosts(
          COST_CATEGORY_OPTIONS.flatMap((category) => {
            const matching = loadedCosts.filter((cost) => cost.category === category);
            return matching.length > 0 ? matching : [newCost(category)];
          })
        );
        if (!quoteJson.success) throw new Error(quoteJson.error || "Không thể tải báo giá.");
        setInvoiceAmountInput(quoteJson.data.invoiceAmount != null ? String(quoteJson.data.invoiceAmount) : "");
        // Giá trị đã lưu là authoritative — giữ nguyên (override) thay vì tự tính lại khi mở modal.
        const savedManual = quoteJson.data.invoiceAmount != null || quoteJson.data.noInvoiceAmount != null;
        setNoInvoiceOverride(savedManual ? String(quoteJson.data.noInvoiceAmount ?? 0) : null);
        const loadedQuotes = (quoteJson.data.lines as Array<{
          id: string;
          description: string;
          quantity: number;
          unit: string | null;
          unitPrice: number;
          hasInvoice: boolean;
          note: string | null;
        }>).map((line) => ({
          id: line.id,
          description: line.description,
          quantity: String(line.quantity),
          unit: line.unit || "",
          unitPrice: String(line.unitPrice),
          hasInvoice: line.hasInvoice,
          note: line.note || "",
        }));
        setQuotes(loadedQuotes.length > 0 ? loadedQuotes : defaultQuotes());
        if (vendorJson.success) setVendors(vendorJson.data);
        if (financeJson.success) setFinanceLinks(financeJson.data);
        if (userJson.success) setUsers(userJson.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, [shipment.id]);

  useEffect(() => {
    const timers = autoSaveTimers.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  const quoteLineTotal = useMemo(
    () => quotes.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), 0),
    [quotes]
  );
  // Ô "Không hóa đơn": nếu người dùng chưa tự sửa (override null) và đã nhập ô "Có hóa đơn" thì
  // luôn bằng phần còn lại của bảng chi tiết — tự cập nhật ngay khi đơn giá trong bảng đổi, không
  // cần xóa/gõ lại ô có hóa đơn. Tính khi render nên không cần effect đồng bộ.
  const noInvoiceAmountInput =
    noInvoiceOverride !== null
      ? noInvoiceOverride
      : invoiceAmountInput.trim() !== ""
        ? String(Math.max(0, quoteLineTotal - (Number(invoiceAmountInput) || 0)))
        : "";
  // Khi đã nhập tay một trong hai ô phân bổ, Tổng báo giá = có hóa đơn ĐÃ CỘNG VAT 8% + không hóa
  // đơn; ô còn trống được hiểu là 0. Chưa nhập tay thì dùng tổng từ bảng chi tiết như cũ.
  // Dùng chung công thức với server (resolveQuoteTotal) để số trên màn hình và số lưu luôn khớp.
  const manualSplitActive = invoiceAmountInput.trim() !== "" || noInvoiceAmountInput.trim() !== "";
  const invoiceBeforeVat = Number(invoiceAmountInput) || 0;
  const invoiceVat = computeInvoiceVat(invoiceBeforeVat);
  const invoiceAfterVat = resolveInvoiceAmountWithVat(invoiceBeforeVat);
  const quoteTotal = manualSplitActive
    ? invoiceAfterVat + (Number(noInvoiceAmountInput) || 0)
    : quoteLineTotal;
  const totalCost = useMemo(
    () => costs.reduce((sum, cost) => sum + (Number(cost.unitPrice) || 0) * (Number(cost.quantity) || 0), 0),
    [costs]
  );

  function updateCost(index: number, patch: Partial<CostDraft>, autoSave = false) {
    const current = costs[index];
    if (!current) return;
    const next = { ...current, ...patch };
    setCosts((rows) => rows.map((cost, i) => (i === index ? next : cost)));
    if (autoSave) scheduleCostSave(next);
  }

  function updateQuote(index: number, patch: Partial<QuoteDraft>) {
    setQuotes((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function saveQuotes() {
    setIsSavingQuotes(true);
    setError(null);
    try {
      const response = await fetch(`/api/shipments/${shipment.id}/quote-lines`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: quotes,
          invoiceAmount: invoiceAmountInput.trim() === "" ? null : Number(invoiceAmountInput),
          noInvoiceAmount: noInvoiceAmountInput.trim() === "" ? null : Number(noInvoiceAmountInput),
        }),
      });
      const json = await readApiJson(response);
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể lưu báo giá.");
      onCostsChanged();
      void refreshFinanceLinks();
      setMessage("Đã lưu bảng báo giá và đồng bộ công nợ khi đủ dữ liệu.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsSavingQuotes(false);
    }
  }

  function scheduleCostSave(cost: CostDraft) {
    const currentTimer = autoSaveTimers.current.get(cost.clientKey);
    if (currentTimer) clearTimeout(currentTimer);
    setCostSaveStatus((current) => ({ ...current, [cost.clientKey]: "idle" }));
    autoSaveTimers.current.set(
      cost.clientKey,
      setTimeout(() => {
        autoSaveTimers.current.delete(cost.clientKey);
        void persistCost(cost);
      }, 700)
    );
  }

  function flushCostSave(index: number) {
    const cost = costs[index];
    if (!cost) return;
    const timer = autoSaveTimers.current.get(cost.clientKey);
    if (timer) clearTimeout(timer);
    autoSaveTimers.current.delete(cost.clientKey);
    void persistCost(cost);
  }

  async function persistCost(cost: CostDraft) {
    const key = cost.clientKey;
    const effectiveId = cost.id || savedIds.current.get(key) || "";
    if (!effectiveId && (!Number.isFinite(Number(cost.unitPrice)) || Number(cost.unitPrice) <= 0)) return;
    if (costSaveInFlight.current.has(key)) {
      queuedCostDrafts.current.set(key, cost);
      return;
    }
    costSaveInFlight.current.add(key);
    setCostSaveStatus((current) => ({ ...current, [key]: "saving" }));
    setError(null);
    try {
      const response = await fetch(effectiveId ? `/api/costs/${effectiveId}` : "/api/costs", {
        method: effectiveId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentId: shipment.id, ...cost }),
      });
      const json = await readApiJson(response);
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể lưu chi phí.");
      const saved = json.data;
      savedIds.current.set(key, saved.id);
      setCosts((current) => current.map((row) => row.clientKey === key ? { ...row, id: saved.id, presetId: saved.presetId, isActual: saved.isActual } : row));
      setCostSaveStatus((current) => ({ ...current, [key]: "saved" }));
      onCostsChanged();
      void refreshFinanceLinks();
    } catch (err) {
      setCostSaveStatus((current) => ({ ...current, [key]: "error" }));
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      costSaveInFlight.current.delete(key);
      const queued = queuedCostDrafts.current.get(key);
      if (queued) {
        queuedCostDrafts.current.delete(key);
        void persistCost({ ...queued, id: savedIds.current.get(key) || queued.id });
      }
    }
  }

  async function deleteCost(index: number) {
    const cost = costs[index];
    const timer = autoSaveTimers.current.get(cost.clientKey);
    if (timer) clearTimeout(timer);
    autoSaveTimers.current.delete(cost.clientKey);
    queuedCostDrafts.current.delete(cost.clientKey);
    if (!cost.id) {
      setCosts((current) => current.filter((_, i) => i !== index));
      return;
    }
    if (!confirm("Xóa dòng chi phí này?")) return;
    const response = await fetch(`/api/costs/${cost.id}`, { method: "DELETE" });
    const json = await readApiJson(response);
    if (json.success) {
      setCosts((current) => current.filter((_, i) => i !== index));
      onCostsChanged();
      void refreshFinanceLinks();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div className="flex max-h-[96vh] w-full max-w-[96vw] flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-gray-200 px-6 pt-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Chi phí lô hàng</h2>
              <p className="mt-1 text-sm text-gray-500">
                {shipment.goodsName || "Chưa có tên hàng"} · TK {shipment.declarationNo || "—"} · {shipment.customerName}
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-xl text-gray-400 hover:text-gray-700" aria-label="Đóng">✕</button>
          </div>
          <div className="mt-4 flex gap-6">
            <button type="button" onClick={() => setActiveTab("quote")} className={`border-b-2 px-1 pb-3 text-sm font-semibold ${activeTab === "quote" ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
              Báo giá <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{formatVnd(quoteTotal)}</span>
            </button>
            <button type="button" onClick={() => setActiveTab("cost")} className={`border-b-2 px-1 pb-3 text-sm font-semibold ${activeTab === "cost" ? "border-emerald-600 text-emerald-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
              Chi phí <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">{formatVnd(totalCost)}</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {isLoading ? <p className="py-12 text-center text-gray-400">Đang tải dữ liệu...</p> : (
            <>
              <p className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-xs text-blue-700">
                Khi báo giá và toàn bộ chi phí thực tế đã được nhập đầy đủ, hệ thống tự động đồng bộ phải thu và phải trả sang Công nợ.
              </p>
              <section className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Liên kết tài chính</span>
                  {financeLinks.debts.map((debt) => (
                    <Link
                      key={debt.id}
                      href={`/debts/${debt.id}`}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium ${debt.type === "RECEIVABLE" ? "bg-blue-100 text-blue-700 hover:bg-blue-200" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"}`}
                    >
                      {debt.type === "RECEIVABLE" ? "Mở phải thu" : "Mở phải trả"} · {formatVnd(debt.totalAmount)}
                    </Link>
                  ))}
                  {financeLinks.invoices.map((invoice) => {
                    const fileUrl = invoice.pdfUrl || invoice.xmlUrl || invoice.attachmentUrl;
                    return (
                      <AttachmentPreviewButton
                        key={invoice.id}
                        url={fileUrl}
                        name={invoice.attachmentName}
                        className="rounded-md bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-200"
                      >
                        {invoice.invoiceDirection === "OUTPUT" ? "HĐ bán ra" : "HĐ đầu vào"} {invoice.invoiceNumber || "chưa rõ số"}
                      </AttachmentPreviewButton>
                    );
                  })}
                  {financeLinks.debts.length === 0 && financeLinks.invoices.length === 0 && (
                    <span className="text-xs text-gray-400">Chưa có công nợ hoặc hóa đơn được liên kết.</span>
                  )}
                </div>
              </section>
              {activeTab === "quote" && <section className="rounded-xl border border-blue-200 bg-blue-50/30 p-5">
                <div className="mb-3">
                  <h3 className="font-semibold text-gray-900">Bảng báo giá</h3>
                  <p className="text-xs text-gray-500">
                    Nhập ô Có hóa đơn — phần còn lại của bảng chi tiết tự chuyển sang ô Không hóa đơn (sửa tay được).
                    Phần Có hóa đơn tự cộng VAT {Math.round(INVOICE_VAT_RATE * 100)}%; Tổng báo giá = Có hóa đơn sau
                    VAT + Không hóa đơn. Để trống cả hai thì tổng lấy từ bảng chi tiết bên dưới. Phần Không
                    hóa đơn tự liên kết sang mô-đun Tài khoản cá nhân.
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-md bg-blue-100 px-3 py-2"><p className="text-[10px] text-blue-600">Tổng báo giá</p><p className="font-bold text-blue-800">{formatVnd(quoteTotal)}</p></div>
                    <div className="rounded-md bg-green-100 px-3 py-2">
                      <p className="text-[10px] text-green-700">Có hóa đơn (chưa VAT) — điền tay</p>
                      <MoneyInput
                        value={invoiceAmountInput}
                        onValueChange={(raw) => {
                          // Gõ ô có hóa đơn → trả ô không hóa đơn về chế độ tự tính (phần còn lại).
                          setNoInvoiceOverride(null);
                          setInvoiceAmountInput(raw);
                        }}
                        className="input mt-1 w-full bg-white font-bold text-green-800"
                        placeholder="0"
                      />
                      <p className="mt-1 text-[10px] leading-4 text-green-700">
                        VAT {Math.round(INVOICE_VAT_RATE * 100)}%: {formatVnd(invoiceVat)}
                        <br />
                        <span className="font-semibold">Sau VAT: {formatVnd(invoiceAfterVat)}</span>
                      </p>
                    </div>
                    <div className="rounded-md bg-orange-100 px-3 py-2">
                      <p className="text-[10px] text-orange-700">Không hóa đơn — điền tay</p>
                      <MoneyInput
                        value={noInvoiceAmountInput}
                        onValueChange={(raw) => setNoInvoiceOverride(raw)}
                        className="input mt-1 w-full bg-white font-bold text-orange-800"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  {manualSplitActive && (
                    <p className="mt-2 text-[11px] text-orange-700">
                      Số tiền không hóa đơn {formatVnd(Number(noInvoiceAmountInput) || 0)} sẽ được theo dõi trong mô-đun{" "}
                      <span className="font-semibold">Tài khoản cá nhân</span> sau khi lưu báo giá.
                    </p>
                  )}
                </div>
                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                  <table className="min-w-[980px] divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50"><tr>
                      <th className="px-2 py-2 text-left text-gray-500">Nội dung</th>
                      <th className="px-2 py-2 text-left text-gray-500">SL</th>
                      <th className="px-2 py-2 text-left text-gray-500">ĐVT</th>
                      <th className="px-2 py-2 text-left text-gray-500">Đơn giá</th>
                      <th className="px-2 py-2 text-left text-gray-500">Thành tiền</th>
                      <th className="px-2 py-2 text-left text-gray-500">Ghi chú</th>
                      <th></th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">{quotes.map((line, index) => {
                      const amount = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
                      return <tr key={line.id || `quote-${index}`}>
                        <td className="px-2 py-2"><input value={line.description} onChange={(event) => updateQuote(index, { description: event.target.value })} className="input min-w-44" placeholder="Nội dung báo giá" /></td>
                        <td className="px-2 py-2"><input type="number" min="0" step="any" value={line.quantity} onChange={(event) => updateQuote(index, { quantity: event.target.value })} className="input w-16" /></td>
                        <td className="px-2 py-2"><input value={line.unit} onChange={(event) => updateQuote(index, { unit: event.target.value })} className="input w-20" placeholder="Lần, xe..." /></td>
                        <td className="px-2 py-2"><MoneyInput value={line.unitPrice} onValueChange={(raw) => updateQuote(index, { unitPrice: raw })} className="input w-32" /></td>
                        <td className="whitespace-nowrap px-2 py-2 font-medium text-gray-900">{formatVnd(amount)}</td>
                        <td className="px-2 py-2"><input value={line.note} onChange={(event) => updateQuote(index, { note: event.target.value })} className="input min-w-36" placeholder="Ghi chú" /></td>
                        <td className="px-2 py-2"><button type="button" onClick={() => setQuotes((current) => current.filter((_, i) => i !== index))} className="text-red-600 hover:underline">Xóa</button></td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => setQuotes((current) => [...current, newQuote()])} className="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">+ Thêm dòng báo giá</button>
                  <button type="button" onClick={saveQuotes} disabled={isSavingQuotes} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{isSavingQuotes ? "Đang lưu..." : "Lưu báo giá"}</button>
                </div>
              </section>}

              {activeTab === "cost" && <section className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div><h3 className="font-semibold text-gray-900">Bảng chi phí chi tiết</h3><p className="text-xs text-gray-500">Hiển thị sẵn mọi hạng mục · Tự động lưu sau khi nhập hoặc rời ô · Dòng “Tự động” được lấy từ Cài đặt</p></div>
                  <p className="text-lg font-bold text-emerald-700">{formatVnd(totalCost)}</p>
                </div>
                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                  <table className="min-w-[1360px] divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50"><tr><th className="px-2 py-2 text-left text-gray-500">Hạng mục</th><th className="px-2 py-2 text-left text-gray-500">Nhà cung cấp</th><th className="px-2 py-2 text-left text-gray-500">Đơn giá</th><th className="px-2 py-2 text-left text-gray-500">SL</th><th className="px-2 py-2 text-left text-gray-500">ĐVT</th><th className="px-2 py-2 text-left text-gray-500">Thành tiền</th><th className="px-2 py-2 text-left text-gray-500">Số HĐ</th><th className="px-2 py-2 text-left text-gray-500">Do ai chi</th><th className="px-2 py-2 text-left text-gray-500">Ghi chú</th><th></th></tr></thead>
                    <tbody className="divide-y divide-gray-100">{costs.map((cost, index) => <tr key={cost.clientKey}>
                      <td className="px-2 py-2"><select value={cost.category} onChange={(event) => { const category = event.target.value; updateCost(index, { category, invoiceNumber: isInvoiceCostCategory(category) ? cost.invoiceNumber : "", vendorId: isVendorlessCostCategory(category) ? "" : cost.vendorId }, true); }} className="input min-w-32">{COST_CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{COST_CATEGORY_LABELS[category]}</option>)}</select><input value={cost.customLabel} onChange={(event) => updateCost(index, { customLabel: event.target.value }, true)} onBlur={() => flushCostSave(index)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className="input mt-1 min-w-32 text-xs" placeholder="Tên riêng (tùy chọn)" />{cost.presetId && !cost.isActual && <span className="mt-1 block text-[10px] font-medium text-amber-700">Dự kiến tự động</span>}{cost.isActual && cost.id && <span className="mt-1 block text-[10px] font-medium text-emerald-700">✓ Chi phí thực tế</span>}</td>
                      <td className="px-2 py-2">{isVendorlessCostCategory(cost.category) ? <div className="flex min-h-10 min-w-48 items-center rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-500">Không áp dụng</div> : <select value={cost.vendorId} onChange={(event) => updateCost(index, { vendorId: event.target.value }, true)} className={`input min-w-48 ${cost.vendorId ? "" : "border-amber-300 bg-amber-50"}`}><option value="">Chưa gắn nhà cung cấp</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.type ? ` · ${vendor.type}` : ""}</option>)}</select>}</td>
                      <td className="px-2 py-2"><MoneyInput value={cost.unitPrice} onValueChange={(raw) => updateCost(index, { unitPrice: raw }, true)} onBlur={() => flushCostSave(index)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className="input w-32" /></td>
                      <td className="px-2 py-2"><input type="number" min="0" step="any" value={cost.quantity} onChange={(event) => updateCost(index, { quantity: event.target.value }, true)} onBlur={() => flushCostSave(index)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className="input w-20" /></td>
                      <td className="px-2 py-2"><input value={cost.unit} onChange={(event) => updateCost(index, { unit: event.target.value }, true)} onBlur={() => flushCostSave(index)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className="input w-20" placeholder="lần, xe..." /></td>
                      <td className="whitespace-nowrap px-2 py-2 font-medium text-gray-900">{formatVnd((Number(cost.unitPrice) || 0) * (Number(cost.quantity) || 0))}</td>
                      <td className="px-2 py-2"><input value={cost.invoiceNumber} onChange={(event) => updateCost(index, { invoiceNumber: event.target.value }, true)} onBlur={() => flushCostSave(index)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} disabled={!isInvoiceCostCategory(cost.category)} className="input w-32" placeholder={isInvoiceCostCategory(cost.category) ? "Số HĐ" : "—"} /></td>
                      <td className="px-2 py-2"><select value={cost.paidByUserId} onChange={(event) => updateCost(index, { paidByUserId: event.target.value }, true)} className="input min-w-40"><option value="">Chưa chọn</option>{users.filter((u) => u.isActive || u.id === cost.paidByUserId).map((u) => <option key={u.id} value={u.id}>{u.name}{!u.isActive ? " (đã khóa)" : ""}</option>)}</select></td>
                      <td className="px-2 py-2"><input value={cost.note} onChange={(event) => updateCost(index, { note: event.target.value }, true)} onBlur={() => flushCostSave(index)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className="input min-w-52" placeholder="Ghi chú" /></td>
                      <td className="px-2 py-2"><div className="flex min-w-36 flex-col items-start gap-1"><SaveIndicator status={costSaveStatus[cost.clientKey] || "idle"} hasValue={!!cost.id || Number(cost.unitPrice) > 0} />{cost.id && !cost.isActual && <button type="button" onClick={() => updateCost(index, { isActual: true }, true)} className="whitespace-nowrap text-xs font-medium text-emerald-700 hover:underline">Xác nhận thực tế</button>}<button type="button" onClick={() => deleteCost(index)} disabled={costSaveStatus[cost.clientKey] === "saving"} className="text-xs text-red-600 hover:underline disabled:opacity-40">Xóa</button></div></td>
                    </tr>)}</tbody>
                  </table>
                </div>
                <button type="button" onClick={() => setCosts((current) => [...current, newCost()])} className="mt-3 rounded-md border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">+ Thêm dòng chi phí</button>
              </section>}
            </>
          )}
          {message && <p className="mt-4 text-sm text-green-700">{message}</p>}
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ status, hasValue }: { status: CostSaveStatus; hasValue: boolean }) {
  if (!hasValue && status === "idle") return <span className="text-[10px] text-gray-400">Chưa nhập</span>;
  if (status === "saving") return <span className="whitespace-nowrap text-[10px] font-medium text-blue-600">Đang lưu...</span>;
  if (status === "error") return <span className="text-[10px] font-medium text-red-600">Lỗi lưu</span>;
  if (status === "saved") return <span className="text-[10px] font-medium text-emerald-700">✓ Đã lưu</span>;
  return <span className="text-[10px] text-gray-400">Tự động lưu</span>;
}
