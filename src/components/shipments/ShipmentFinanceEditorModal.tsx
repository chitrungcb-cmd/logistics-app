"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  COST_CATEGORY_LABELS,
  COST_CATEGORY_OPTIONS,
  isInvoiceCostCategory,
  isVendorlessCostCategory,
} from "@/lib/shipment-cost-constants";
import { QUOTE_LINE_LABELS, QUOTE_LINE_OPTIONS } from "@/lib/quote-line-constants";

type CostDraft = {
  clientKey: string;
  id: string;
  category: string;
  unitPrice: string;
  quantity: string;
  invoiceNumber: string;
  note: string;
  vendorId: string;
  isActual: boolean;
  presetId?: string | null;
};

type CostSaveStatus = "idle" | "saving" | "saved" | "error";

type VendorOption = { id: string; name: string; type: string | null };

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
    unitPrice: "",
    quantity: "1",
    invoiceNumber: "",
    note: "",
    vendorId: "",
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
  const [vendors, setVendors] = useState<VendorOption[]>([]);
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

  useEffect(() => {
    Promise.all([
      fetch(`/api/costs?shipmentId=${shipment.id}`).then(readApiJson),
      fetch(`/api/shipments/${shipment.id}/quote-lines`).then(readApiJson),
      fetch("/api/vendors").then(readApiJson),
    ])
      .then(([costJson, quoteJson, vendorJson]) => {
        if (!costJson.success) throw new Error(costJson.error || "Không thể tải chi phí.");
        const loadedCosts: CostDraft[] = costJson.data.map((cost: { id: string; category: string; unitPrice: number; quantity: number; invoiceNumber: string | null; note: string | null; presetId?: string | null; vendorId?: string | null; isActual?: boolean }) => ({
          clientKey: `cost-${cost.id}`,
          id: cost.id,
          category: cost.category,
          unitPrice: String(cost.unitPrice),
          quantity: String(cost.quantity),
          invoiceNumber: cost.invoiceNumber || "",
          note: cost.note || "",
          vendorId: isVendorlessCostCategory(cost.category) ? "" : cost.vendorId || "",
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
        const loadedQuotes = (quoteJson.data as Array<{
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
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, [shipment.id]);

  useEffect(() => {
    const timers = autoSaveTimers.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  const quoteTotals = useMemo(() => {
    return quotes.reduce(
      (totals, line) => {
        const amount = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
        totals.total += amount;
        if (line.hasInvoice) totals.withInvoice += amount;
        else totals.withoutInvoice += amount;
        return totals;
      },
      { total: 0, withInvoice: 0, withoutInvoice: 0 }
    );
  }, [quotes]);
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
        body: JSON.stringify({ lines: quotes }),
      });
      const json = await readApiJson(response);
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể lưu báo giá.");
      onCostsChanged();
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
              Báo giá <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">{formatVnd(quoteTotals.total)}</span>
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
              {activeTab === "quote" && <section className="rounded-xl border border-blue-200 bg-blue-50/30 p-5">
                <div className="mb-3">
                  <h3 className="font-semibold text-gray-900">Bảng báo giá</h3>
                  <p className="text-xs text-gray-500">Thêm dòng tùy ý và phân bổ theo loại hóa đơn</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div className="rounded-md bg-blue-100 px-3 py-2"><p className="text-[10px] text-blue-600">Tổng báo giá</p><p className="font-bold text-blue-800">{formatVnd(quoteTotals.total)}</p></div>
                    <div className="rounded-md bg-green-100 px-3 py-2"><p className="text-[10px] text-green-700">Có hóa đơn</p><p className="font-bold text-green-800">{formatVnd(quoteTotals.withInvoice)}</p></div>
                    <div className="rounded-md bg-orange-100 px-3 py-2"><p className="text-[10px] text-orange-700">Không hóa đơn</p><p className="font-bold text-orange-800">{formatVnd(quoteTotals.withoutInvoice)}</p></div>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                  <table className="min-w-[980px] divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50"><tr>
                      <th className="px-2 py-2 text-left text-gray-500">Nội dung</th>
                      <th className="px-2 py-2 text-left text-gray-500">SL</th>
                      <th className="px-2 py-2 text-left text-gray-500">ĐVT</th>
                      <th className="px-2 py-2 text-left text-gray-500">Đơn giá</th>
                      <th className="px-2 py-2 text-left text-gray-500">Thành tiền</th>
                      <th className="px-2 py-2 text-left text-gray-500">Hóa đơn</th>
                      <th className="px-2 py-2 text-left text-gray-500">Ghi chú</th>
                      <th></th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-100">{quotes.map((line, index) => {
                      const amount = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
                      return <tr key={line.id || `quote-${index}`}>
                        <td className="px-2 py-2"><input value={line.description} onChange={(event) => updateQuote(index, { description: event.target.value })} className="input min-w-44" placeholder="Nội dung báo giá" /></td>
                        <td className="px-2 py-2"><input type="number" min="0" step="any" value={line.quantity} onChange={(event) => updateQuote(index, { quantity: event.target.value })} className="input w-16" /></td>
                        <td className="px-2 py-2"><input value={line.unit} onChange={(event) => updateQuote(index, { unit: event.target.value })} className="input w-20" placeholder="Lần, xe..." /></td>
                        <td className="px-2 py-2"><input type="number" min="0" value={line.unitPrice} onChange={(event) => updateQuote(index, { unitPrice: event.target.value })} className="input w-28" /></td>
                        <td className="whitespace-nowrap px-2 py-2 font-medium text-gray-900">{formatVnd(amount)}</td>
                        <td className="px-2 py-2"><select value={line.hasInvoice ? "yes" : "no"} onChange={(event) => updateQuote(index, { hasInvoice: event.target.value === "yes" })} className="input min-w-32"><option value="yes">Có hóa đơn</option><option value="no">Không hóa đơn</option></select></td>
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
                  <table className="min-w-[1050px] divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50"><tr><th className="px-2 py-2 text-left text-gray-500">Hạng mục</th><th className="px-2 py-2 text-left text-gray-500">Nhà cung cấp</th><th className="px-2 py-2 text-left text-gray-500">Đơn giá</th><th className="px-2 py-2 text-left text-gray-500">SL</th><th className="px-2 py-2 text-left text-gray-500">Số HĐ</th><th className="px-2 py-2 text-left text-gray-500">Ghi chú</th><th></th></tr></thead>
                    <tbody className="divide-y divide-gray-100">{costs.map((cost, index) => <tr key={cost.clientKey}>
                      <td className="px-2 py-2"><select value={cost.category} onChange={(event) => { const category = event.target.value; updateCost(index, { category, invoiceNumber: isInvoiceCostCategory(category) ? cost.invoiceNumber : "", vendorId: isVendorlessCostCategory(category) ? "" : cost.vendorId }, true); }} className="input min-w-32">{COST_CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{COST_CATEGORY_LABELS[category]}</option>)}</select>{cost.presetId && !cost.isActual && <span className="mt-1 block text-[10px] font-medium text-amber-700">Dự kiến tự động</span>}{cost.isActual && cost.id && <span className="mt-1 block text-[10px] font-medium text-emerald-700">✓ Chi phí thực tế</span>}</td>
                      <td className="px-2 py-2">{isVendorlessCostCategory(cost.category) ? <div className="flex min-h-10 min-w-48 items-center rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-500">Không áp dụng</div> : <select value={cost.vendorId} onChange={(event) => updateCost(index, { vendorId: event.target.value }, true)} className={`input min-w-48 ${cost.vendorId ? "" : "border-amber-300 bg-amber-50"}`}><option value="">Chưa gắn nhà cung cấp</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.type ? ` · ${vendor.type}` : ""}</option>)}</select>}</td>
                      <td className="px-2 py-2"><input type="number" min="0" value={cost.unitPrice} onChange={(event) => updateCost(index, { unitPrice: event.target.value }, true)} onBlur={() => flushCostSave(index)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className="input w-32" /></td>
                      <td className="px-2 py-2"><input type="number" min="0" step="any" value={cost.quantity} onChange={(event) => updateCost(index, { quantity: event.target.value }, true)} onBlur={() => flushCostSave(index)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className="input w-20" /></td>
                      <td className="px-2 py-2"><input value={cost.invoiceNumber} onChange={(event) => updateCost(index, { invoiceNumber: event.target.value }, true)} onBlur={() => flushCostSave(index)} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} disabled={!isInvoiceCostCategory(cost.category)} className="input w-32" placeholder={isInvoiceCostCategory(cost.category) ? "Số HĐ" : "—"} /></td>
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
