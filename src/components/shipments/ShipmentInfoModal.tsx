"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AttachmentPreviewModal from "@/components/shipments/AttachmentPreviewModal";
import Badge from "@/components/shipments/Badge";
import ShipmentDetailsTable from "@/components/shipments/ShipmentDetailsTable";
import TaskStepper from "@/components/shipments/TaskStepper";
import {
  channelBadgeClass,
  statusBadgeClass,
  type Attachment,
} from "@/lib/shipment-constants";
import type { ShipmentDTO } from "@/lib/types";

export default function ShipmentInfoModal({
  shipmentId,
  onClose,
}: {
  shipmentId: string;
  onClose: () => void;
}) {
  const [shipment, setShipment] = useState<ShipmentDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<Attachment | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadShipment() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/shipments/${shipmentId}`);
        const text = await response.text();
        const json = text ? JSON.parse(text) : null;
        if (!response.ok || !json?.success) {
          throw new Error(json?.error || "Không thể tải thông tin lô hàng.");
        }
        if (!cancelled) setShipment(json.data as ShipmentDTO);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Không thể tải thông tin lô hàng.");
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
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-3 sm:p-6"
        onClick={onClose}
        role="presentation"
      >
        <div
          className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="shipment-info-title"
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 sm:px-6">
            <div>
              <h2 id="shipment-info-title" className="text-xl font-semibold text-gray-900">
                Thông tin lô hàng
              </h2>
              {shipment && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-blue-700">
                    TK {shipment.declarationNo || "Chưa có số tờ khai"}
                  </span>
                  <span className="text-sm text-gray-400">·</span>
                  <span className="text-sm text-gray-500">
                    Ngày TK {formatDate(shipment.declarationDate)}
                  </span>
                  <Badge label={shipment.status} className={statusBadgeClass(shipment.status)} />
                  {shipment.channel && (
                    <Badge label={shipment.channel} className={channelBadgeClass(shipment.channel)} />
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-2 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Đóng cửa sổ thông tin lô hàng"
            >
              ×
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-5 sm:p-6">
            {isLoading && <p className="py-16 text-center text-sm text-gray-400">Đang tải thông tin lô hàng...</p>}

            {!isLoading && error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {!isLoading && shipment && (
              <div className="space-y-6">
                <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-5">
                  <h3 className="mb-4 text-base font-semibold text-gray-900">Tiến trình xử lý</h3>
                  <TaskStepper shipmentId={shipment.id} />
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-5">
                  <h3 className="mb-4 text-base font-semibold text-gray-900">Thông tin chi tiết</h3>
                  <ShipmentDetailsTable shipment={shipment} />
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-5">
                  <h3 className="mb-3 text-base font-semibold text-gray-900">Chứng từ đính kèm</h3>
                  {shipment.attachments && shipment.attachments.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {shipment.attachments.map((attachment, index) => (
                        <button
                          key={`${attachment.url}-${index}`}
                          type="button"
                          onClick={() => setPreviewing(attachment)}
                          className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-100"
                        >
                          📎 {attachment.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">Chưa có chứng từ đính kèm.</p>
                  )}
                </section>
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3 sm:px-6">
            <Link
              href={`/shipments/${shipmentId}`}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Mở trang chi tiết
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Đóng
            </button>
          </footer>
        </div>
      </div>

      <AttachmentPreviewModal
        key={previewing?.url}
        attachment={previewing}
        onClose={() => setPreviewing(null)}
      />
    </>
  );
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("vi-VN") : "—";
}
