"use client";

import Link from "next/link";
import ShipmentLink from "@/components/shipments/ShipmentLink";
import { useCallback, useEffect, useState } from "react";
import GmailSyncPanel from "@/components/shipments/GmailSyncPanel";
import AttachmentPreviewButton from "@/components/shipments/AttachmentPreviewButton";
import VendorsSettingsClient from "./VendorsSettingsClient";

type InvoiceStatus = "MATCHED" | "UNMATCHED" | "NEEDS_REVIEW";
type InvoiceDirection = "INPUT" | "OUTPUT" | "UNRELATED" | "UNKNOWN";

type InvoiceRow = {
  id: string;
  sellerName: string | null;
  sellerTaxCode: string | null;
  buyerName: string | null;
  buyerTaxCode: string | null;
  invoiceDirection: InvoiceDirection;
  isIssuedToNq: boolean | null;
  invoiceNumber: string | null;
  invoiceSymbol: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  currency: string;
  attachmentName: string;
  attachmentUrl: string;
  xmlUrl: string | null;
  pdfUrl: string | null;
  status: InvoiceStatus;
  note: string | null;
  vendor: { id: string; name: string; taxCode: string | null; type: string | null } | null;
  shipmentCost: {
    id: string;
    category: string;
    costPrice: number;
    invoiceNumber: string | null;
    shipment: {
      id: string;
      declarationNo: string | null;
      declarationDate: string | null;
      goodsName: string | null;
      customerName: string;
    };
  } | null;
  linkedShipment: {
    id: string;
    declarationNo: string | null;
    declarationDate: string | null;
    goodsName: string | null;
    customerName: string;
  } | null;
  linkedDebt: { id: string; totalAmount: number; status: string; dueDate: string | null } | null;
};

type PartnerRow = {
  id: string;
  name: string;
  taxCode: string | null;
  type: string | null;
  phone: string | null;
  invoiceCount: number;
  matchedCount: number;
  totalAmount: number;
};

type ShipmentOption = {
  id: string;
  declarationNo: string | null;
  goodsName: string | null;
  customerName: string;
  taxCode: string | null;
  quoteAmount: number | null;
};

type InvoiceData = {
  invoices: InvoiceRow[];
  totals: {
    count: number;
    inputCount: number;
    outputCount: number;
    matched: number;
    unmatched: number;
    needsReview: number;
    inputAmount: number;
    outputAmount: number;
  };
  partners: PartnerRow[];
  shipmentOptions: ShipmentOption[];
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMoney(amount: number | null, currency = "VND") {
  if (amount === null) return "—";
  if (currency === "VND") return `${amount.toLocaleString("vi-VN")} đ`;
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency }).format(amount);
}

function StatusBadge({ invoice }: { invoice: InvoiceRow }) {
  if (invoice.invoiceDirection === "OUTPUT") {
    return invoice.linkedShipment ? (
      <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">✓ Đã gắn lô – theo dõi phải thu</span>
    ) : (
      <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Chờ xác định lô hàng</span>
    );
  }
  if (invoice.invoiceDirection === "UNRELATED" || invoice.invoiceDirection === "UNKNOWN") {
    return <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">Cần kiểm tra</span>;
  }
  if (invoice.status === "MATCHED") {
    return <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">✓ Đã đối chiếu – sẵn sàng trả</span>;
  }
  if (invoice.status === "UNMATCHED") {
    return <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Chờ đối chiếu trước khi trả</span>;
  }
  return <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">Cần kiểm tra</span>;
}

function DirectionBadge({ direction }: { direction: InvoiceDirection }) {
  if (direction === "INPUT") {
    return <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Hóa đơn đầu vào</span>;
  }
  if (direction === "OUTPUT") {
    return <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">Hóa đơn đầu ra</span>;
  }
  if (direction === "UNRELATED") {
    return <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">Không liên quan NQ</span>;
  }
  return <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">Chưa xác định</span>;
}

export function InvoiceManagementPanel({ isAdmin, embedded = false }: { isAdmin: boolean; embedded?: boolean }) {
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(currentMonth);
  const [status, setStatus] = useState("");
  const [direction, setDirection] = useState("");
  const [data, setData] = useState<InvoiceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (month) params.set("month", month);
      if (status) params.set("status", status);
      if (direction) params.set("direction", direction);
      const response = await fetch(`/api/vendor-invoices?${params}`, { cache: "no-store" });
      const text = await response.text();
      if (!text) throw new Error(`Máy chủ không trả về dữ liệu (HTTP ${response.status}).`);
      const json = JSON.parse(text);
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể tải hóa đơn đối tác.");
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải hóa đơn đối tác.");
    } finally {
      setIsLoading(false);
    }
  }, [direction, month, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 250);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const pending = (data?.totals.unmatched ?? 0) + (data?.totals.needsReview ?? 0);

  return (
    <div className={embedded ? "" : "p-8"}>
      {!embedded && <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Đối tác & hóa đơn</h1>
        <p className="mt-1 text-sm text-gray-500">
          NQ Logistics là bên mua trên hóa đơn đầu vào và là bên bán trên hóa đơn đầu ra.
        </p>
      </div>}

      {isAdmin && <GmailSyncPanel onSynced={loadData} />}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Hóa đơn đầu vào" value={formatMoney(data?.totals.inputAmount ?? 0)} note={`${data?.totals.inputCount ?? 0} hóa đơn · NQ là bên mua`} accent="green" />
        <Metric label="Hóa đơn đầu ra" value={formatMoney(data?.totals.outputAmount ?? 0)} note={`${data?.totals.outputCount ?? 0} hóa đơn · NQ là bên bán`} accent="blue" />
        <Metric label="Sẵn sàng thanh toán" value={String(data?.totals.matched ?? 0)} note="Hóa đơn đầu vào đã đối chiếu" accent="green" />
        <Metric label="Chờ xử lý" value={String(pending)} note="Chưa khớp hoặc cần kiểm tra" accent={pending > 0 ? "amber" : "default"} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="font-semibold text-gray-900">Hóa đơn đầu vào và đầu ra</h2>
            <p className="mt-1 text-xs text-gray-500">Đối chiếu hóa đơn đầu vào trước khi thanh toán công nợ phải trả.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên đối tác, MST, số hóa đơn, số TK..." className="input w-72" />
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="input w-44" />
            <select value={direction} onChange={(event) => setDirection(event.target.value)} className="input w-48">
              <option value="">Tất cả loại hóa đơn</option>
              <option value="INPUT">Hóa đơn đầu vào</option>
              <option value="OUTPUT">Hóa đơn đầu ra</option>
              <option value="UNRELATED">Không liên quan NQ</option>
              <option value="UNKNOWN">Chưa xác định</option>
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="input w-48">
              <option value="">Tất cả trạng thái</option>
              <option value="MATCHED">Đã khớp chi phí</option>
              <option value="UNMATCHED">Chưa khớp chi phí</option>
              <option value="NEEDS_REVIEW">Cần kiểm tra</option>
            </select>
          </div>
        </div>

        {error && <p className="m-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <InvoiceTable
          rows={data?.invoices ?? []}
          shipmentOptions={data?.shipmentOptions ?? []}
          isLoading={isLoading}
          isAdmin={isAdmin}
          onLinked={loadData}
        />
      </div>
    </div>
  );
}

type PartnersTab = "overview" | "vendors";

export default function PartnersClient() {
  const [activeTab, setActiveTab] = useState<PartnersTab>("overview");
  const [rows, setRows] = useState<PartnerRow[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<PartnerRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/vendor-invoices", { cache: "no-store" })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(json.error || "Không thể tải danh sách đối tác.");
        setRows(json.data.partners);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Không thể tải danh sách đối tác."))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div>
      <header className="px-8 pt-8">
        <h1 className="text-2xl font-semibold text-gray-900">Đối tác</h1>
        <p className="mt-1 text-sm text-gray-500">Danh sách nhà cung cấp và đối tác của NQ Logistics.</p>
      </header>

      <nav className="mt-6 flex gap-6 border-b border-gray-200 px-8" aria-label="Mục đối tác">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`border-b-2 px-1 pb-3 text-sm font-semibold ${
            activeTab === "overview"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
          aria-current={activeTab === "overview" ? "page" : undefined}
        >
          Danh sách đối tác
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("vendors")}
          className={`border-b-2 px-1 pb-3 text-sm font-semibold ${
            activeTab === "vendors"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
          aria-current={activeTab === "vendors" ? "page" : undefined}
        >
          Nhà cung cấp
        </button>
      </nav>

      {activeTab === "overview" ? (
        <div className="p-8">
          {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <div className="rounded-xl border border-gray-200 bg-white">
            <PartnerTable
              rows={rows}
              isLoading={isLoading}
              onOpenInvoices={setSelectedPartner}
            />
          </div>
        </div>
      ) : (
        <VendorsSettingsClient />
      )}
      {selectedPartner && (
        <PartnerInvoicesModal
          partner={selectedPartner}
          onClose={() => setSelectedPartner(null)}
        />
      )}
    </div>
  );
}

function InvoiceTable({
  rows,
  shipmentOptions,
  isLoading,
  isAdmin,
  onLinked,
}: {
  rows: InvoiceRow[];
  shipmentOptions: ShipmentOption[];
  isLoading: boolean;
  isAdmin: boolean;
  onLinked: () => Promise<void>;
}) {
  return <div className="overflow-x-auto"><table className="min-w-[1180px] w-full divide-y divide-gray-200 text-sm">
    <thead className="bg-gray-50"><tr>
      <th className="w-14 px-4 py-3 text-center font-medium text-gray-500">STT</th>
      <th className="px-4 py-3 text-left font-medium text-gray-500">Ngày / số hóa đơn</th>
      <th className="px-4 py-3 text-left font-medium text-gray-500">Loại hóa đơn</th>
      <th className="px-4 py-3 text-left font-medium text-gray-500">Bên bán</th>
      <th className="px-4 py-3 text-left font-medium text-gray-500">Bên mua</th>
      <th className="px-4 py-3 text-right font-medium text-gray-500">Tổng tiền</th>
      <th className="px-4 py-3 text-left font-medium text-gray-500">Đối chiếu thanh toán</th>
      <th className="px-4 py-3 text-left font-medium text-gray-500">Công nợ / lô hàng</th>
      <th className="px-4 py-3 text-right font-medium text-gray-500">File</th>
    </tr></thead>
    <tbody className="divide-y divide-gray-100">
      {isLoading && <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">Đang kiểm tra hóa đơn...</td></tr>}
      {!isLoading && rows.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">Chưa có hóa đơn phù hợp. Hệ thống sẽ tự kiểm tra Gmail mỗi 5 phút.</td></tr>}
      {!isLoading && rows.map((invoice, index) => <tr key={invoice.id} className="align-top hover:bg-gray-50">
        <td className="px-4 py-4 text-center text-gray-400">{index + 1}</td>
        <td className="px-4 py-4"><p className="font-medium text-gray-900">{invoice.invoiceNumber || "Chưa đọc được số HĐ"}</p><p className="mt-1 text-xs text-gray-500">{invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString("vi-VN") : "Chưa có ngày"}{invoice.invoiceSymbol ? ` · ${invoice.invoiceSymbol}` : ""}</p></td>
        <td className="px-4 py-4"><DirectionBadge direction={invoice.invoiceDirection} /></td>
        <td className="px-4 py-4"><p className="max-w-64 font-medium text-gray-900">{invoice.sellerName || invoice.vendor?.name || "Chưa xác định"}</p><p className="mt-1 text-xs text-gray-500">MST: {invoice.sellerTaxCode || invoice.vendor?.taxCode || "—"}</p></td>
        <td className="px-4 py-4"><p className="max-w-56 text-gray-700">{invoice.buyerName || "Chưa đọc được"}</p><p className="mt-1 text-xs text-gray-500">MST: {invoice.buyerTaxCode || "—"}</p></td>
        <td className="whitespace-nowrap px-4 py-4 text-right font-semibold text-gray-900">{formatMoney(invoice.totalAmount, invoice.currency)}</td>
        <td className="px-4 py-4"><StatusBadge invoice={invoice} />{invoice.note && <p className="mt-2 max-w-56 text-xs leading-5 text-gray-500">{invoice.note}</p>}</td>
        <td className="px-4 py-4">
          {invoice.linkedShipment ? (
            <>
              <Link href={`/costs?shipmentId=${invoice.linkedShipment.id}`} className="font-medium text-blue-600 hover:underline">
                TK {invoice.linkedShipment.declarationNo || "chưa có"}
              </Link>
              <p className="mt-1 max-w-64 text-xs text-gray-500">
                {invoice.linkedShipment.goodsName || invoice.linkedShipment.customerName}
              </p>
              {invoice.invoiceDirection === "INPUT" && invoice.shipmentCost && (
                <p className="mt-1 text-xs text-gray-400">Chi phí: {formatMoney(invoice.shipmentCost.costPrice)}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <ShipmentLink shipmentId={invoice.linkedShipment.id} className="inline-flex rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200">
                  Mở lô hàng
                </ShipmentLink>
                {invoice.linkedDebt && isAdmin && (
                  <Link href={`/debts/${invoice.linkedDebt.id}`} className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${invoice.invoiceDirection === "OUTPUT" ? "bg-blue-50 text-blue-700 hover:bg-blue-100" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}>
                    {invoice.invoiceDirection === "OUTPUT" ? "Mở khoản phải thu" : "Mở khoản phải trả"}
                  </Link>
                )}
              </div>
              {!invoice.linkedDebt && invoice.status === "MATCHED" && (
                <p className="mt-2 text-xs text-amber-600">Chưa có công nợ tự động</p>
              )}
            </>
          ) : (
            <span className="text-gray-400">Chưa xác định lô hàng</span>
          )}
          {invoice.invoiceDirection === "OUTPUT" && isAdmin && (
            <OutputShipmentLinkControl invoice={invoice} shipmentOptions={shipmentOptions} onLinked={onLinked} />
          )}
        </td>
        <td className="px-4 py-4 text-right">
          <div className="flex justify-end gap-3">
            {invoice.pdfUrl && (
              <AttachmentPreviewButton url={invoice.pdfUrl} name={invoice.attachmentName} className="font-medium text-blue-600 hover:underline">
                Xem PDF
              </AttachmentPreviewButton>
            )}
            {invoice.xmlUrl && <a href={invoice.xmlUrl} target="_blank" rel="noreferrer" className="font-medium text-emerald-600 hover:underline">XML</a>}
            {!invoice.pdfUrl && !invoice.xmlUrl && (
              <AttachmentPreviewButton url={invoice.attachmentUrl} name={invoice.attachmentName} className="font-medium text-blue-600 hover:underline">
                Mở file
              </AttachmentPreviewButton>
            )}
          </div>
        </td>
      </tr>)}
    </tbody>
  </table></div>;
}

function OutputShipmentLinkControl({
  invoice,
  shipmentOptions,
  onLinked,
}: {
  invoice: InvoiceRow;
  shipmentOptions: ShipmentOption[];
  onLinked: () => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [shipmentId, setShipmentId] = useState(invoice.linkedShipment?.id || "");
  const [isSaving, setIsSaving] = useState(false);

  const normalizedBuyerTaxCode = (invoice.buyerTaxCode || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  const sameCustomerOptions = shipmentOptions.filter(
    (shipment) => (shipment.taxCode || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase() === normalizedBuyerTaxCode
  );
  const options = sameCustomerOptions.length > 0 ? sameCustomerOptions : shipmentOptions;

  async function saveLink() {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/vendor-invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentId: shipmentId || null }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể liên kết hóa đơn.");
      setIsOpen(false);
      await onLinked();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Không thể liên kết hóa đơn.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!isOpen) {
    return (
      <button type="button" onClick={() => setIsOpen(true)} className="mt-2 block text-xs font-medium text-blue-700 hover:underline">
        {invoice.linkedShipment ? "Đổi lô hàng" : "+ Chọn lô hàng"}
      </button>
    );
  }

  return (
    <div className="mt-2 min-w-72 rounded-md border border-blue-200 bg-blue-50 p-2">
      <select value={shipmentId} onChange={(event) => setShipmentId(event.target.value)} className="input w-full text-xs">
        <option value="">Bỏ liên kết</option>
        {options.map((shipment) => (
          <option key={shipment.id} value={shipment.id}>
            TK {shipment.declarationNo || "—"} · {shipment.goodsName || shipment.customerName}
            {shipment.quoteAmount ? ` · ${formatMoney(shipment.quoteAmount)}` : ""}
          </option>
        ))}
      </select>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => void saveLink()} disabled={isSaving} className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
          {isSaving ? "Đang lưu..." : "Lưu liên kết"}
        </button>
        <button type="button" onClick={() => setIsOpen(false)} className="px-2 py-1 text-xs text-gray-500 hover:underline">Hủy</button>
      </div>
    </div>
  );
}

function PartnerTable({
  rows,
  isLoading,
  onOpenInvoices,
}: {
  rows: PartnerRow[];
  isLoading: boolean;
  onOpenInvoices: (partner: PartnerRow) => void;
}) {
  return <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 text-sm">
    <thead className="bg-gray-50"><tr><th className="w-16 px-4 py-3 text-center font-medium text-gray-500">STT</th><th className="px-4 py-3 text-left font-medium text-gray-500">Tên đối tác</th><th className="px-4 py-3 text-left font-medium text-gray-500">Mã số thuế</th><th className="px-4 py-3 text-left font-medium text-gray-500">Loại đối tác</th><th className="px-4 py-3 text-right font-medium text-gray-500">Số hóa đơn</th><th className="px-4 py-3 text-right font-medium text-gray-500">Đã khớp</th><th className="px-4 py-3 text-right font-medium text-gray-500">Tổng tiền</th></tr></thead>
    <tbody className="divide-y divide-gray-100">{isLoading && <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Đang tải đối tác...</td></tr>}{!isLoading && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Chưa có đối tác được nhận diện từ hóa đơn.</td></tr>}{!isLoading && rows.map((partner, index) => <tr key={partner.id} className="hover:bg-gray-50"><td className="px-4 py-3 text-center text-gray-400">{index + 1}</td><td className="px-4 py-3 font-medium"><button type="button" onClick={() => onOpenInvoices(partner)} className="text-left text-gray-900 hover:text-blue-700 hover:underline">{partner.name}</button></td><td className="px-4 py-3 text-gray-600">{partner.taxCode || "—"}</td><td className="px-4 py-3 text-gray-600">{partner.type || "—"}</td><td className="px-4 py-3 text-right"><button type="button" onClick={() => onOpenInvoices(partner)} className="font-semibold text-blue-600 hover:underline">{partner.invoiceCount}</button></td><td className="px-4 py-3 text-right text-emerald-700">{partner.matchedCount}</td><td className="px-4 py-3 text-right font-semibold text-gray-900">{formatMoney(partner.totalAmount)}</td></tr>)}</tbody>
  </table></div>;
}

function PartnerInvoicesModal({
  partner,
  onClose,
}: {
  partner: PartnerRow;
  onClose: () => void;
}) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/vendor-invoices?vendorId=${encodeURIComponent(partner.id)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok || !json.success) {
          throw new Error(json.error || "Không thể tải hóa đơn của đối tác.");
        }
        if (!cancelled) setInvoices(json.data.invoices);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Không thể tải hóa đơn của đối tác.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [partner.id]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="partner-invoices-title"
        className="flex max-h-[92vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
          <div>
            <h2 id="partner-invoices-title" className="text-xl font-semibold text-gray-900">
              Hóa đơn của {partner.name}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              MST: {partner.taxCode || "—"} · {partner.invoiceCount} hóa đơn · Tổng{" "}
              {formatMoney(partner.totalAmount)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-md px-3 py-1.5 text-2xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            ×
          </button>
        </div>

        <div className="overflow-auto p-5">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          )}
          {isLoading ? (
            <p className="py-12 text-center text-sm text-gray-400">Đang tải hóa đơn...</p>
          ) : invoices.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">
              Không tìm thấy hóa đơn của đối tác này.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-[1180px] w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-14 px-4 py-3 text-center font-medium text-gray-500">STT</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Ngày / số hóa đơn</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Loại</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Bên bán</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Bên mua</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Tổng tiền</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Đối chiếu</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Lô hàng</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">File</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {invoices.map((invoice, index) => (
                    <tr key={invoice.id} className="align-top hover:bg-gray-50">
                      <td className="px-4 py-4 text-center text-gray-400">{index + 1}</td>
                      <td className="px-4 py-4">
                        <p className="font-medium text-gray-900">
                          {invoice.invoiceNumber || "Chưa đọc được số HĐ"}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {invoice.invoiceDate
                            ? new Date(invoice.invoiceDate).toLocaleDateString("vi-VN")
                            : "Chưa có ngày"}
                          {invoice.invoiceSymbol ? ` · ${invoice.invoiceSymbol}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <DirectionBadge direction={invoice.invoiceDirection} />
                      </td>
                      <td className="px-4 py-4">
                        <p className="max-w-64 font-medium text-gray-900">
                          {invoice.sellerName || invoice.vendor?.name || "Chưa xác định"}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          MST: {invoice.sellerTaxCode || invoice.vendor?.taxCode || "—"}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="max-w-64 text-gray-700">
                          {invoice.buyerName || "Chưa đọc được"}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          MST: {invoice.buyerTaxCode || "—"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-right font-semibold text-gray-900">
                        {formatMoney(invoice.totalAmount, invoice.currency)}
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge invoice={invoice} />
                      </td>
                      <td className="px-4 py-4">
                        {invoice.linkedShipment ? (
                          <ShipmentLink
                            shipmentId={invoice.linkedShipment.id}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            TK {invoice.linkedShipment.declarationNo || "chưa có"}
                          </ShipmentLink>
                        ) : (
                          <span className="text-gray-400">Chưa xác định</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {invoice.pdfUrl ? (
                          <AttachmentPreviewButton
                            url={invoice.pdfUrl}
                            name={invoice.attachmentName}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            Xem PDF
                          </AttachmentPreviewButton>
                        ) : invoice.xmlUrl ? (
                          <a
                            href={invoice.xmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-emerald-600 hover:underline"
                          >
                            XML
                          </a>
                        ) : (
                          <AttachmentPreviewButton
                            url={invoice.attachmentUrl}
                            name={invoice.attachmentName}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            Mở file
                          </AttachmentPreviewButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, note, accent = "default" }: { label: string; value: string; note: string; accent?: "default" | "blue" | "green" | "amber" }) {
  const color = accent === "blue" ? "border-blue-200 bg-blue-50 text-blue-900" : accent === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : accent === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-gray-200 bg-white text-gray-900";
  return <div className={`rounded-xl border p-4 ${color}`}><p className="text-xs opacity-70">{label}</p><p className="mt-1 text-xl font-bold">{value}</p><p className="mt-1 text-xs opacity-60">{note}</p></div>;
}
