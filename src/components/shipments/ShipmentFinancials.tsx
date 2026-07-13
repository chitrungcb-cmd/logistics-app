"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type QuoteRow = {
  id: string;
  quoteAmount: number;
  quoteDate: string | null;
  attachmentUrl: string | null;
  note: string | null;
  createdAt: string;
};

const emptyQuoteForm = {
  quoteAmount: "0",
  quoteDate: "",
  note: "",
};

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

// Deliberately does NOT show ShipmentCost here (amounts or otherwise) — this page is reached by
// every role (ACCOUNTANT, FIELD_STAFF included), and cost/profit data must stay ADMIN-only with a
// single API surface to guard. All cost editing lives at /costs; ADMIN gets a plain link, nobody
// else sees any mention of cost data on this page at all.
export default function ShipmentFinancials({ shipmentId, isAdmin }: { shipmentId: string; isAdmin: boolean }) {
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [quoteForm, setQuoteForm] = useState(emptyQuoteForm);
  const [isUploadingQuote, setIsUploadingQuote] = useState(false);
  const [pendingQuoteAttachment, setPendingQuoteAttachment] = useState<string | null>(null);
  const quoteFileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/shipments/${shipmentId}/quotes`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.success) setQuotes(json.data);
      })
      .catch(() => {
        if (!cancelled) setError("Không thể tải báo giá.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shipmentId]);

  async function handleQuoteFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploadingQuote(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Tải file thất bại.");
      setPendingQuoteAttachment(json.data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsUploadingQuote(false);
    }
  }

  async function handleAddQuote(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteAmount: quoteForm.quoteAmount,
          quoteDate: quoteForm.quoteDate || null,
          note: quoteForm.note,
          attachmentUrl: pendingQuoteAttachment,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể thêm báo giá.");
      setQuotes((prev) => [json.data, ...prev]);
      setQuoteForm(emptyQuoteForm);
      setPendingQuoteAttachment(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    }
  }

  async function handleDeleteQuote(quoteId: string) {
    if (!confirm("Xóa báo giá này?")) return;
    const res = await fetch(`/api/shipments/${shipmentId}/quotes/${quoteId}`, { method: "DELETE" });
    const json = await res.json();
    if (json.success) setQuotes((prev) => prev.filter((q) => q.id !== quoteId));
  }

  if (isLoading) return null;

  return (
    <div className="space-y-6">
      {isAdmin && (
        <Link href={`/costs?shipmentId=${shipmentId}`} className="text-sm text-blue-600 hover:underline">
          Xem chi phí tại trang Chi phí →
        </Link>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Báo giá</h2>
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Số tiền</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Ngày báo giá</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">File</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Ghi chú</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {quotes.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-gray-400">
                    Chưa có báo giá nào.
                  </td>
                </tr>
              )}
              {quotes.map((quote, index) => (
                <tr key={quote.id}>
                  <td className="px-3 py-2 text-gray-900">
                    {formatVnd(quote.quoteAmount)}
                    {index === 0 && (
                      <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                        Mới nhất
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {quote.quoteDate ? new Date(quote.quoteDate).toLocaleDateString("vi-VN") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {quote.attachmentUrl ? (
                      <a
                        href={quote.attachmentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        Xem file
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{quote.note || "—"}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => handleDeleteQuote(quote.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Xóa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={handleAddQuote} className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <input
            type="number"
            placeholder="Số tiền báo giá"
            value={quoteForm.quoteAmount}
            onChange={(e) => setQuoteForm((prev) => ({ ...prev, quoteAmount: e.target.value }))}
            className="input"
          />
          <input
            type="date"
            value={quoteForm.quoteDate}
            onChange={(e) => setQuoteForm((prev) => ({ ...prev, quoteDate: e.target.value }))}
            className="input"
          />
          <input
            placeholder="Ghi chú"
            value={quoteForm.note}
            onChange={(e) => setQuoteForm((prev) => ({ ...prev, note: e.target.value }))}
            className="input"
          />
          <button
            type="button"
            onClick={() => quoteFileInputRef.current?.click()}
            disabled={isUploadingQuote}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {isUploadingQuote ? "Đang tải..." : pendingQuoteAttachment ? "Đã đính kèm" : "+ Đính kèm file"}
          </button>
          <input ref={quoteFileInputRef} type="file" className="hidden" onChange={handleQuoteFileChange} />
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Thêm báo giá
          </button>
        </form>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
