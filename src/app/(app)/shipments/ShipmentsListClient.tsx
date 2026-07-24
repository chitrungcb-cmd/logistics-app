"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import PaginationControls from "@/components/PaginationControls";
import Badge from "@/components/shipments/Badge";
import AttachmentsCell from "@/components/shipments/AttachmentsCell";
import GmailSyncPanel from "@/components/shipments/GmailSyncPanel";
import ShipmentInfoModal from "@/components/shipments/ShipmentInfoModal";
import TaskStepperCompact from "@/components/shipments/TaskStepperCompact";
import {
  channelBadgeClass,
  statusBadgeClass,
  getDeclarationBranches,
  CHANNEL_OPTIONS,
  STATUS_OPTIONS,
  type Attachment,
} from "@/lib/shipment-constants";
import type { ShipmentDTO } from "@/lib/types";
import type { PaginationMeta } from "@/lib/pagination";

const ALL_FILTER = "__all__";
const PAGE_SIZE = 50;
const LIST_REFRESH_INTERVAL_MS = 90 * 1000;
const EMPTY_PAGINATION: PaginationMeta = { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 };

export default function ShipmentsListClient({ isAdmin }: { isAdmin: boolean }) {
  const [shipments, setShipments] = useState<ShipmentDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [taskStepsSummary, setTaskStepsSummary] = useState<Record<string, (string | null)[]>>({});
  const [pagination, setPagination] = useState<PaginationMeta>(EMPTY_PAGINATION);
  const [currentPage, setCurrentPage] = useState(1);
  const hasLoadedShipments = useRef(false);
  const requestSequence = useRef(0);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL_FILTER);
  const [channelFilter, setChannelFilter] = useState(ALL_FILTER);

  const loadShipments = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: String(PAGE_SIZE) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter !== ALL_FILTER) params.set("status", statusFilter);
      if (channelFilter !== ALL_FILTER) params.set("channel", channelFilter);
      const res = await fetch(`/api/shipments?${params}`, { cache: "no-store" });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Không thể tải danh sách lô hàng.");
      }
      if (sequence !== requestSequence.current) return;
      setShipments(json.data.items);
      setTaskStepsSummary(json.data.taskStepsSummary);
      setPagination(json.data.pagination);
      hasLoadedShipments.current = true;
      setError(null);
    } catch (err) {
      if (sequence !== requestSequence.current) return;
      if (!hasLoadedShipments.current) {
        setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      }
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false);
    }
  }, [channelFilter, currentPage, debouncedSearch, statusFilter]);

  const refreshList = useCallback(() => {
    void loadShipments();
  }, [loadShipments]);

  const closeShipmentInfo = useCallback(() => {
    setSelectedShipmentId(null);
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setCurrentPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(refreshList, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshList();
    }, LIST_REFRESH_INTERVAL_MS);
    const handleFocus = () => refreshList();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshList();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshList]);


  function handleAttached(shipmentId: string, attachments: Attachment[]) {
    setShipments((prev) =>
      prev.map((s) => (s.id === shipmentId ? { ...s, attachments } : s))
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Quản lý lô hàng</h1>
          <p className="mt-1 text-sm text-gray-500">
            Danh sách toàn bộ lô hàng đang xử lý.
          </p>
        </div>
        <Link
          href="/shipments/new"
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Tạo lô hàng mới
        </Link>
      </div>

      {isAdmin && <div className="mt-6"><GmailSyncPanel onSynced={refreshList} /></div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm khách hàng, số tờ khai, tên hàng, invoice..."
          className="input max-w-xs"
        />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }} className="input w-auto">
          <option value={ALL_FILTER}>Tất cả trạng thái</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select value={channelFilter} onChange={(e) => { setChannelFilter(e.target.value); setCurrentPage(1); }} className="input w-auto">
          <option value={ALL_FILTER}>Tất cả phân luồng</option>
          {CHANNEL_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {(search || statusFilter !== ALL_FILTER || channelFilter !== ALL_FILTER) && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setDebouncedSearch("");
              setStatusFilter(ALL_FILTER);
              setChannelFilter(ALL_FILTER);
              setCurrentPage(1);
            }}
            className="text-sm text-gray-500 hover:underline"
          >
            Xóa bộ lọc
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[1810px] table-fixed divide-y divide-gray-200 text-sm">
          <colgroup>
            <col className="w-[48px]" />
            <col className="w-[175px]" />
            <col className="w-[150px]" />
            <col className="w-[105px]" />
            <col className="w-[100px]" />
            <col className="w-[145px]" />
            <col className="w-[120px]" />
            <col className="w-[205px]" />
            <col className="w-[90px]" />
            <col className="w-[145px]" />
            <col className="w-[170px]" />
            <col className="w-[135px]" />
            <col className="w-[130px]" />
            <col className="w-[90px]" />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 text-center font-medium text-gray-500">STT</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Khách hàng</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Số tờ khai</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Ngày tờ khai</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Loại hình</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Số invoice</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Cửa khẩu/Cảng</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Tên hàng</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Phân luồng</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Trạng thái</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">HQ tiếp nhận</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Chứng từ</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Tiến trình</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={14} className="px-4 py-6 text-center text-gray-400">
                  Đang tải dữ liệu...
                </td>
              </tr>
            )}
            {!isLoading && error && (
              <tr>
                <td colSpan={14} className="px-4 py-6 text-center text-red-600">
                  {error}
                </td>
              </tr>
            )}
            {!isLoading && !error && shipments.length === 0 && (
              <tr>
                <td colSpan={14} className="px-4 py-6 text-center text-gray-400">
                  {debouncedSearch || statusFilter !== ALL_FILTER || channelFilter !== ALL_FILTER
                    ? "Không có lô hàng khớp bộ lọc."
                    : "Chưa có lô hàng nào."}
                </td>
              </tr>
            )}
            {!isLoading &&
              !error &&
              shipments.map((shipment, index) => {
                const branches = getDeclarationBranches(shipment.declarationBranches);
                return (
                  <tr
                    key={shipment.id}
                    className="cursor-pointer align-top hover:bg-gray-50"
                    onClick={(event) => {
                      // Clicks on the row's own controls (attachment buttons/preview, links,
                      // the hidden file input) must not also open the information window.
                      const target = event.target as HTMLElement;
                      if (target.closest("a, button, input, select, textarea, label, [role='dialog']")) return;
                      setSelectedShipmentId(shipment.id);
                    }}
                  >
                    <td className="px-3 py-3 text-center text-gray-500">
                      {(pagination.page - 1) * pagination.pageSize + index + 1}
                    </td>
                    <td className="break-words px-3 py-3 font-medium leading-5 text-gray-900">
                      {shipment.customerName}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-600">
                      {branches ? (
                        <div className="space-y-0.5">
                          {branches.map((b) => (
                            <div key={b.number}>
                              <span className="text-gray-400">{b.label}:</span> {b.number}
                            </div>
                          ))}
                        </div>
                      ) : (
                        shipment.declarationNo || "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-600">
                      {shipment.declarationDate
                        ? new Date(shipment.declarationDate).toLocaleDateString("vi-VN")
                        : "—"}
                    </td>
                    <td className="px-3 py-3 leading-5 text-gray-600">{shipment.customsType || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-600">{shipment.invoiceNo || "—"}</td>
                    <td className="break-words px-3 py-3 text-gray-600">{shipment.port || "—"}</td>
                    <td className="break-words px-3 py-3 leading-5 text-gray-600">{shipment.goodsName || "—"}</td>
                    <td className="px-3 py-3">
                      {shipment.channel ? (
                        <Badge label={shipment.channel} className={channelBadgeClass(shipment.channel)} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge label={shipment.status} className={statusBadgeClass(shipment.status)} />
                    </td>
                    <td className="break-words px-3 py-3 leading-5 text-gray-600">{shipment.customsOffice || "—"}</td>
                    <td className="px-3 py-3">
                      <AttachmentsCell
                        shipmentId={shipment.id}
                        attachments={shipment.attachments || []}
                        onAttached={handleAttached}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <TaskStepperCompact statuses={taskStepsSummary[shipment.id] ?? []} />
                    </td>
                    <td className="px-3 py-3">
                      {isAdmin && (
                        <Link
                          href={`/costs?shipmentId=${shipment.id}`}
                          className="whitespace-nowrap text-sm text-blue-600 hover:underline"
                        >
                          Chi phí
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <PaginationControls pagination={pagination} onPageChange={(page) => { setCurrentPage(page); setIsLoading(true); }} />
      {selectedShipmentId && (
        <ShipmentInfoModal shipmentId={selectedShipmentId} onClose={closeShipmentInfo} />
      )}
    </div>
  );
}
