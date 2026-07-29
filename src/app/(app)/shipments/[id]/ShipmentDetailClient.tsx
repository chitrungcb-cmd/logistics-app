"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Badge from "@/components/shipments/Badge";
import AttachmentPreviewModal from "@/components/shipments/AttachmentPreviewModal";
import CustomerCombobox from "@/components/customers/CustomerCombobox";
import ShipmentDetailsTable from "@/components/shipments/ShipmentDetailsTable";
import TaskStepper from "@/components/shipments/TaskStepper";
import {
  channelBadgeClass,
  statusBadgeClass,
  isDateApproaching,
  CHANNEL_OPTIONS,
  CUSTOMS_TYPE_OPTIONS,
  STATUS_OPTIONS,
  type Attachment,
} from "@/lib/shipment-constants";
import type { ShipmentDTO } from "@/lib/types";

export default function ShipmentDetailClient({
  shipmentId,
  canViewCosts,
}: {
  shipmentId: string;
  canViewCosts: boolean;
}) {
  const [shipment, setShipment] = useState<ShipmentDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<Attachment | null>(null);
  const [linkedConversationId, setLinkedConversationId] = useState<string | null>(null);

  const [editForm, setEditForm] = useState({
    transport: "",
    transportRoute: "",
    vehiclePlate: "",
    status: STATUS_OPTIONS[0] as string,
    note: "",
    customerName: "",
    customerId: null as string | null,
    taxCode: "",
    declarationNo: "",
    declarationDate: "",
    consultationDate: "",
    invoiceNo: "",
    customsType: "",
    port: "",
    goodsName: "",
    channel: "",
    customsOffice: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadShipment() {
      try {
        const res = await fetch(`/api/shipments/${shipmentId}`);
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || "Không thể tải chi tiết lô hàng.");
        }
        if (!cancelled) {
          const data: ShipmentDTO = json.data;
          setShipment(data);
          setEditForm({
            transport: data.transport || "",
            transportRoute: data.transportRoute || "",
            vehiclePlate: data.vehiclePlate || "",
            status: data.status,
            note: data.note || "",
            customerName: data.customerName,
            customerId: data.customerId,
            taxCode: data.taxCode || "",
            declarationNo: data.declarationNo || "",
            declarationDate: data.declarationDate ? data.declarationDate.slice(0, 10) : "",
            consultationDate: data.consultationDate ? data.consultationDate.slice(0, 10) : "",
            invoiceNo: data.invoiceNo || "",
            customsType: data.customsType || "",
            port: data.port || "",
            goodsName: data.goodsName || "",
            channel: data.channel || "",
            customsOffice: data.customsOffice || "",
          });
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadShipment();
    return () => {
      cancelled = true;
    };
  }, [shipmentId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/conversations")
      .then((res) => res.json())
      .then((json) => {
        if (cancelled || !json.success) return;
        const match = json.data.find(
          (c: { relatedShipment?: { id: string } | null }) => c.relatedShipment?.id === shipmentId
        );
        setLinkedConversationId(match?.id ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shipmentId]);

  function handleEditChange(
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    const { name, value } = event.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setSaveError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/shipments/${shipmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Cập nhật thất bại.");
      }
      setShipment(json.data);
      setSuccessMessage("Cập nhật lô hàng thành công.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <div className="p-8 text-gray-400">Đang tải dữ liệu...</div>;
  }

  if (loadError || !shipment) {
    return (
      <div className="p-8">
        <p className="text-red-600">{loadError || "Không tìm thấy lô hàng."}</p>
        <Link href="/shipments" className="mt-4 inline-block text-blue-600 hover:underline">
          ← Quay lại danh sách
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/shipments" className="text-sm text-blue-600 hover:underline">
          ← Quay lại danh sách
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              TK {shipment.declarationNo || "Chưa có số tờ khai"}
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Ngày tờ khai: {shipment.declarationDate ? new Date(shipment.declarationDate).toLocaleDateString("vi-VN") : "—"}
            </p>
          </div>
          <Badge label={shipment.status} className={statusBadgeClass(shipment.status)} />
          {shipment.channel && (
            <Badge label={shipment.channel} className={channelBadgeClass(shipment.channel)} />
          )}
        </div>
      </div>

      <div className="mb-6 overflow-x-auto rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Tiến trình xử lý</h2>
        <TaskStepper shipmentId={shipmentId} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-lg border border-gray-200 bg-white p-6 lg:col-span-3">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Thông tin lô hàng</h2>
          <ShipmentDetailsTable
            shipment={shipment}
            linkCustomer
            warnConsultationDate={isDateApproaching(shipment.consultationDate)}
          />

          <div className="mt-4 grid overflow-hidden rounded-lg border border-gray-200 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <h3 className="bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Chứng từ đính kèm</h3>
            <div className="px-4 py-3">
              {shipment.attachments && shipment.attachments.length > 0 ? (
                <ul className="flex flex-wrap gap-x-4 gap-y-2">
                {shipment.attachments.map((file, index) => (
                  <li key={`${file.url}-${index}`}>
                    <button
                      type="button"
                      onClick={() => setPreviewing(file)}
                      className="text-left text-sm text-blue-600 hover:underline"
                    >
                      {file.name}
                    </button>
                  </li>
                ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">Chưa có chứng từ đính kèm.</p>
              )}
            </div>
          </div>

          {linkedConversationId && (
            <div className="mt-4">
              <Link
                href={`/messages?conversationId=${linkedConversationId}`}
                className="text-sm text-blue-600 hover:underline"
              >
                💬 Mở nhóm chat của lô hàng này →
              </Link>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6 lg:col-span-3">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Cập nhật lô hàng</h2>
          <form onSubmit={handleSave}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="block md:col-span-2 xl:col-span-1">
              <span className="mb-1 block text-sm font-medium text-gray-700">Khách hàng</span>
              <CustomerCombobox
                customerName={editForm.customerName}
                customerId={editForm.customerId}
                onChange={({ customerName, customerId }) =>
                  setEditForm((prev) => ({ ...prev, customerName, customerId }))
                }
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Mã số thuế</span>
              <input name="taxCode" value={editForm.taxCode} onChange={handleEditChange} className="input" />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Số tờ khai</span>
              <input name="declarationNo" value={editForm.declarationNo} onChange={handleEditChange} className="input" />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Ngày tờ khai</span>
              <input type="date" name="declarationDate" value={editForm.declarationDate} onChange={handleEditChange} className="input" />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Ngày tham vấn</span>
              <input type="date" name="consultationDate" value={editForm.consultationDate} onChange={handleEditChange} className="input" />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Số invoice</span>
              <input name="invoiceNo" value={editForm.invoiceNo} onChange={handleEditChange} className="input" />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Loại hình</span>
              <select name="customsType" value={editForm.customsType} onChange={handleEditChange} className="input">
                <option value="">-- Chọn loại hình --</option>
                {CUSTOMS_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Cửa khẩu/Cảng</span>
              <input name="port" value={editForm.port} onChange={handleEditChange} className="input" />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Tên hàng</span>
              <input name="goodsName" value={editForm.goodsName} onChange={handleEditChange} className="input" />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Phân luồng</span>
              <select name="channel" value={editForm.channel} onChange={handleEditChange} className="input">
                <option value="">-- Chọn phân luồng --</option>
                {CHANNEL_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">HQ tiếp nhận</span>
              <input name="customsOffice" value={editForm.customsOffice} onChange={handleEditChange} className="input" />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Vận tải</span>
              <input
                name="transport"
                value={editForm.transport}
                onChange={handleEditChange}
                className="input"
                placeholder="VD: Đường biển - Hãng tàu ABC"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Cung đường vận chuyển</span>
              <input name="transportRoute" value={editForm.transportRoute} onChange={handleEditChange} className="input" placeholder="VD: Hữu Nghị → Hà Nội" />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">BKS xe vận chuyển</span>
              <input name="vehiclePlate" value={editForm.vehiclePlate} onChange={handleEditChange} className="input" placeholder="VD: 29C-123.45" />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Trạng thái</span>
              <select
                name="status"
                value={editForm.status}
                onChange={handleEditChange}
                className="input"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="block md:col-span-2 xl:col-span-3">
              <span className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</span>
              <textarea
                name="note"
                value={editForm.note}
                onChange={handleEditChange}
                rows={3}
                className="input"
              />
            </label>
            </div>

            {saveError && <p className="mt-4 text-sm text-red-600">{saveError}</p>}
            {successMessage && <p className="mt-4 text-sm text-green-600">{successMessage}</p>}

            <button
              type="submit"
              disabled={isSaving}
              className="mt-4 rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? "Đang lưu..." : "Lưu cập nhật"}
            </button>
          </form>
        </section>
      </div>

      {canViewCosts && (
        <Link
          href={`/costs?shipmentId=${shipmentId}`}
          className="mt-6 inline-block text-sm text-blue-600 hover:underline"
        >
          Xem chi phí tại trang Chi phí →
        </Link>
      )}

      <AttachmentPreviewModal
        key={`${previewing?.url}-${previewing?.uploadedAt}`}
        attachment={previewing}
        shipmentId={shipmentId}
        onClose={() => setPreviewing(null)}
        onAttachmentReplaced={(current, replacement) => {
          setShipment((existing) =>
            existing
              ? {
                  ...existing,
                  attachments: (existing.attachments ?? []).map((attachment) =>
                    attachment.url === current.url ? replacement : attachment
                  ),
                }
              : existing
          );
          setPreviewing(replacement);
        }}
      />
    </div>
  );
}
