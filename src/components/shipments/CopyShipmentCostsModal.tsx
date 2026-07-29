"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COST_CATEGORY_BADGE_CLASS,
  COST_CATEGORY_ICON,
  COST_CATEGORY_LABELS,
  isVendorlessCostCategory,
} from "@/lib/shipment-cost-constants";

type Scope = "customer" | "goods" | "all";

type SourceCost = {
  id: string;
  category: string;
  customLabel: string | null;
  unit: string | null;
  unitPrice: number;
  quantity: number;
  costPrice: number;
  vendor: { id: string; name: string; type: string | null } | null;
  paidBy: { id: string; name: string } | null;
  paidFromCompanyAccount: { id: string; name: string } | null;
  alreadyExists: boolean;
};

type SourceShipment = {
  id: string;
  customerName: string;
  declarationNo: string | null;
  declarationDate: string | null;
  goodsName: string | null;
  totalCost: number;
  costs: SourceCost[];
};

type TargetShipment = {
  id: string;
  customerName: string;
  declarationNo: string | null;
  goodsName: string | null;
};

const SCOPES: Array<{ value: Scope; label: string; help: string }> = [
  { value: "customer", label: "Cùng công ty", help: "Ưu tiên các lô trước của đúng khách hàng này." },
  { value: "goods", label: "Cùng nhóm hàng", help: "Tìm lô có tên hàng tương tự, không phân biệt công ty." },
  { value: "all", label: "Tất cả lô", help: "Tìm trong toàn bộ lô đã có chi phí." },
];

function formatVnd(amount: number) {
  return `${amount.toLocaleString("vi-VN")} đ`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("vi-VN") : "—";
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

export default function CopyShipmentCostsModal({
  target,
  onClose,
  onCopied,
}: {
  target: TargetShipment;
  onClose: () => void;
  onCopied: () => void;
}) {
  const [scope, setScope] = useState<Scope>("customer");
  const [sources, setSources] = useState<SourceShipment[]>([]);
  const [sourceId, setSourceId] = useState("");
  const sourceIdRef = useRef("");
  const [selectedCostIds, setSelectedCostIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCopying, setIsCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/costs/copy?targetShipmentId=${encodeURIComponent(target.id)}&scope=${scope}`,
        { cache: "no-store" }
      );
      const json = await readApiJson(response);
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể tải lô nguồn.");
      const loaded = json.data.sources as SourceShipment[];
      const nextSourceId = loaded.some((source) => source.id === sourceIdRef.current)
        ? sourceIdRef.current
        : loaded[0]?.id ?? "";
      const nextSource = loaded.find((source) => source.id === nextSourceId);
      setSources(loaded);
      sourceIdRef.current = nextSourceId;
      setSourceId(nextSourceId);
      setSelectedCostIds(
        new Set(nextSource?.costs.filter((cost) => !cost.alreadyExists).map((cost) => cost.id) ?? [])
      );
    } catch (err) {
      setSources([]);
      sourceIdRef.current = "";
      setSourceId("");
      setSelectedCostIds(new Set());
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsLoading(false);
    }
  }, [scope, target.id]);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/costs/copy?targetShipmentId=${encodeURIComponent(target.id)}&scope=${scope}`,
      { cache: "no-store" }
    )
      .then(async (response) => {
        const json = await readApiJson(response);
        if (!response.ok || !json.success) throw new Error(json.error || "Không thể tải lô nguồn.");
        return json.data.sources as SourceShipment[];
      })
      .then((loaded) => {
        if (cancelled) return;
        const nextSourceId = loaded.some((source) => source.id === sourceIdRef.current)
          ? sourceIdRef.current
          : loaded[0]?.id ?? "";
        const nextSource = loaded.find((source) => source.id === nextSourceId);
        setSources(loaded);
        sourceIdRef.current = nextSourceId;
        setSourceId(nextSourceId);
        setSelectedCostIds(
          new Set(nextSource?.costs.filter((cost) => !cost.alreadyExists).map((cost) => cost.id) ?? [])
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setSources([]);
        sourceIdRef.current = "";
        setSourceId("");
        setSelectedCostIds(new Set());
        setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, target.id]);

  const filteredSources = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("vi");
    if (!keyword) return sources;
    return sources.filter((source) =>
      [source.customerName, source.declarationNo, source.goodsName]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("vi").includes(keyword))
    );
  }, [query, sources]);

  const selectedSource = sources.find((source) => source.id === sourceId) ?? null;

  const selectableCosts = selectedSource?.costs.filter((cost) => !cost.alreadyExists) ?? [];
  const selectedTotal = selectedSource?.costs
    .filter((cost) => selectedCostIds.has(cost.id))
    .reduce((sum, cost) => sum + cost.costPrice, 0) ?? 0;

  function toggleAll(checked: boolean) {
    setSelectedCostIds(new Set(checked ? selectableCosts.map((cost) => cost.id) : []));
  }

  async function copyCosts() {
    if (!selectedSource || selectedCostIds.size === 0) return;
    setIsCopying(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/costs/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetShipmentId: target.id,
          sourceShipmentId: selectedSource.id,
          costIds: [...selectedCostIds],
        }),
      });
      const json = await readApiJson(response);
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể sao chép chi phí.");
      setMessage(json.data.message);
      onCopied();
      await loadSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsCopying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="border-b border-gray-200 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Sao chép chi phí từ lô đã làm</h2>
              <p className="mt-1 text-sm text-gray-500">
                Lô nhận: <span className="font-medium text-gray-800">TK {target.declarationNo || "—"} · {target.goodsName || "Chưa có tên hàng"}</span>
              </p>
            </div>
            <button type="button" onClick={onClose} className="text-xl text-gray-400 hover:text-gray-700" aria-label="Đóng">✕</button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {SCOPES.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  sourceIdRef.current = "";
                  setScope(item.value);
                  setQuery("");
                  setMessage(null);
                  setError(null);
                  setIsLoading(true);
                }}
                className={`rounded-lg border px-3 py-2 text-left ${scope === item.value ? "border-blue-500 bg-blue-50 text-blue-800" : "border-gray-200 hover:bg-gray-50"}`}
              >
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="mt-0.5 block text-[11px] text-gray-500">{item.help}</span>
              </button>
            ))}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[360px_1fr]">
          <aside className="min-h-0 overflow-y-auto border-b border-gray-200 p-4 lg:border-b-0 lg:border-r">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="input mb-3"
              placeholder="Tìm công ty, số tờ khai, tên hàng..."
            />
            {isLoading && <p className="py-8 text-center text-sm text-gray-400">Đang tìm lô phù hợp...</p>}
            {!isLoading && filteredSources.length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center">
                <p className="text-sm font-medium text-gray-700">Chưa có lô nguồn phù hợp</p>
                <p className="mt-1 text-xs text-gray-500">Đổi phạm vi sang “Cùng nhóm hàng” hoặc “Tất cả lô”.</p>
              </div>
            )}
            <div className="space-y-2">
              {filteredSources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => {
                    sourceIdRef.current = source.id;
                    setSourceId(source.id);
                    setSelectedCostIds(new Set(source.costs.filter((cost) => !cost.alreadyExists).map((cost) => cost.id)));
                    setMessage(null);
                  }}
                  className={`w-full rounded-lg border p-3 text-left ${source.id === sourceId ? "border-blue-500 bg-blue-50 ring-1 ring-blue-200" : "border-gray-200 hover:bg-gray-50"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-semibold text-gray-900">TK {source.declarationNo || "—"}</span>
                    <span className="whitespace-nowrap text-xs text-gray-500">{formatDate(source.declarationDate)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-600">{source.customerName}</p>
                  <p className="mt-1 truncate text-xs text-gray-500">{source.goodsName || "Chưa có tên hàng"}</p>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-gray-500">{source.costs.length} khoản</span>
                    <span className="font-semibold text-emerald-700">{formatVnd(source.totalCost)}</span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-4 sm:p-5">
            {selectedSource ? (
              <>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Chọn khoản cần sao chép</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Số hóa đơn, tệp đính kèm và trạng thái thanh toán của lô cũ không được mang sang.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      checked={selectableCosts.length > 0 && selectedCostIds.size === selectableCosts.length}
                      onChange={(event) => toggleAll(event.target.checked)}
                    />
                    Chọn tất cả khoản mới
                  </label>
                </div>
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="divide-y divide-gray-100">
                    {selectedSource.costs.map((cost) => {
                      const paymentSource = cost.paidFromCompanyAccount?.name || cost.paidBy?.name || "Chưa chọn TK chi";
                      return (
                        <label key={cost.id} className={`grid gap-3 px-4 py-3 sm:grid-cols-[28px_1.2fr_1.4fr_1fr_auto] sm:items-center ${cost.alreadyExists ? "bg-gray-50 opacity-60" : "cursor-pointer hover:bg-blue-50/50"}`}>
                          <input
                            type="checkbox"
                            disabled={cost.alreadyExists}
                            checked={selectedCostIds.has(cost.id)}
                            onChange={(event) => {
                              setSelectedCostIds((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(cost.id);
                                else next.delete(cost.id);
                                return next;
                              });
                            }}
                          />
                          <div>
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${COST_CATEGORY_BADGE_CLASS[cost.category] || "bg-gray-100 text-gray-700"}`}>
                              {COST_CATEGORY_ICON[cost.category]} {cost.customLabel || COST_CATEGORY_LABELS[cost.category] || cost.category}
                            </span>
                            {cost.alreadyExists && <span className="ml-2 text-[11px] font-medium text-gray-500">Đã có ở lô nhận</span>}
                          </div>
                          <span className={`text-sm ${!isVendorlessCostCategory(cost.category) && !cost.vendor ? "font-medium text-amber-600" : "text-gray-600"}`}>
                            {isVendorlessCostCategory(cost.category) ? "Không cần nhà cung cấp" : cost.vendor?.name || "Chưa gắn nhà cung cấp"}
                          </span>
                          <span className="text-sm text-gray-500">TK chi: {paymentSource}</span>
                          <span className="whitespace-nowrap text-right text-sm font-semibold text-gray-900">{formatVnd(cost.costPrice)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : !isLoading ? (
              <div className="flex h-full min-h-48 items-center justify-center text-sm text-gray-400">Chọn một lô nguồn ở bên trái.</div>
            ) : null}
          </main>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4 sm:px-6">
          <div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {message && <p className="text-sm font-medium text-emerald-700">{message}</p>}
            {!error && !message && <p className="text-sm text-gray-600">Đã chọn <strong>{selectedCostIds.size}</strong> khoản · {formatVnd(selectedTotal)}</p>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Đóng</button>
            <button
              type="button"
              onClick={copyCosts}
              disabled={isCopying || !selectedSource || selectedCostIds.size === 0}
              className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isCopying ? "Đang sao chép..." : `Sao chép ${selectedCostIds.size} khoản`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
