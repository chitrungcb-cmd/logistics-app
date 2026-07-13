"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Badge from "@/components/shipments/Badge";
import AttachmentPreviewModal from "@/components/shipments/AttachmentPreviewModal";
import CustomerCombobox from "@/components/customers/CustomerCombobox";
import ShipmentFinancials from "@/components/shipments/ShipmentFinancials";
import TaskStepper from "@/components/shipments/TaskStepper";
import {
  channelBadgeClass,
  statusBadgeClass,
  getDeclarationBranches,
  isDateApproaching,
  STATUS_OPTIONS,
  type Attachment,
} from "@/lib/shipment-constants";
import type { ShipmentDTO } from "@/lib/types";

export default function ShipmentDetailClient({
  shipmentId,
  role,
}: {
  shipmentId: string;
  role: string;
}) {
  const [shipment, setShipment] = useState<ShipmentDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<Attachment | null>(null);
  const [linkedConversationId, setLinkedConversationId] = useState<string | null>(null);

  const [editForm, setEditForm] = useState({
    transport: "",
    status: STATUS_OPTIONS[0] as string,
    note: "",
    customerName: "",
    customerId: null as string | null,
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
            status: data.status,
            note: data.note || "",
            customerName: data.customerName,
            customerId: data.customerId,
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
        body: JSON.stringify({
          transport: editForm.transport,
          status: editForm.status,
          note: editForm.note,
          customerName: editForm.customerName,
          customerId: editForm.customerId,
        }),
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
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">{shipment.shipmentCode}</h1>
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
        <section className="rounded-lg border border-gray-200 bg-white p-6 lg:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Thông tin lô hàng</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Khách hàng</dt>
              <dd className="mt-0.5 text-sm text-gray-900">
                {shipment.customerId ? (
                  <Link href={`/customers/${shipment.customerId}`} className="text-blue-600 hover:underline">
                    {shipment.customerName}
                  </Link>
                ) : (
                  shipment.customerName || "—"
                )}
              </dd>
            </div>
            <Info label="Mã số thuế" value={shipment.taxCode} />
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Số tờ khai</dt>
              <dd className="mt-0.5 text-sm text-gray-900">
                {(() => {
                  const branches = getDeclarationBranches(shipment.declarationBranches);
                  if (!branches) return shipment.declarationNo || "—";
                  return (
                    <div className="space-y-0.5">
                      {branches.map((b) => (
                        <div key={b.number}>
                          <span className="text-gray-400">{b.label}:</span> {b.number}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </dd>
            </div>
            <Info
              label="Ngày tờ khai"
              value={
                shipment.declarationDate
                  ? new Date(shipment.declarationDate).toLocaleDateString("vi-VN")
                  : null
              }
            />
            <Info
              label="Ngày tham vấn"
              value={
                shipment.consultationDate
                  ? new Date(shipment.consultationDate).toLocaleDateString("vi-VN")
                  : null
              }
              warn={isDateApproaching(shipment.consultationDate)}
            />
            <Info label="Loại hình" value={shipment.customsType} />
            <Info label="Số invoice" value={shipment.invoiceNo} />
            <Info label="Cửa khẩu/Cảng" value={shipment.port} />
            <Info label="Tên hàng" value={shipment.goodsName} />
            <Info label="HQ tiếp nhận" value={shipment.customsOffice} />
            <Info label="Vận tải" value={shipment.transport} />
            <Info label="Ghi chú" value={shipment.note} />
          </dl>

          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-gray-900">Chứng từ đính kèm</h3>
            {shipment.attachments && shipment.attachments.length > 0 ? (
              <ul className="space-y-1">
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

        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Cập nhật lô hàng</h2>
          <form onSubmit={handleSave} className="space-y-4">
            <label className="block">
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

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</span>
              <textarea
                name="note"
                value={editForm.note}
                onChange={handleEditChange}
                rows={3}
                className="input"
              />
            </label>

            {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            {successMessage && <p className="text-sm text-green-600">{successMessage}</p>}

            <button
              type="submit"
              disabled={isSaving}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? "Đang lưu..." : "Lưu cập nhật"}
            </button>
          </form>
        </section>
      </div>

      {role !== "FIELD_STAFF" && (
        <div className="mt-6">
          <ShipmentFinancials shipmentId={shipmentId} isAdmin={role === "ADMIN"} />
        </div>
      )}

      <AttachmentPreviewModal key={previewing?.url} attachment={previewing} onClose={() => setPreviewing(null)} />
    </div>
  );
}

function Info({
  label,
  value,
  warn,
}: {
  label: string;
  value: string | null | undefined;
  warn?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className={`mt-0.5 text-sm ${warn ? "font-medium text-red-600" : "text-gray-900"}`}>
        {warn ? "⚠ " : ""}
        {value || "—"}
      </dd>
    </div>
  );
}
