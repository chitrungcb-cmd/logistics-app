"use client";

import { useState } from "react";
import ShipmentInfoModal from "@/components/shipments/ShipmentInfoModal";
import { statusBadgeClass } from "@/lib/shipment-constants";

// Dữ liệu đã tính sẵn phía server (Date -> chuỗi) để component client chỉ hiển thị + mở modal.
export type ConsultationRow = {
  id: string;
  goodsName: string | null;
  customerName: string;
  declarationNo: string | null;
  status: string;
  port: string | null;
  dateLabel: string;
  overdue: boolean;
  approaching: boolean;
};

// Bảng "Lịch tham vấn cần xử lý": bấm CẢ DÒNG để mở cửa sổ thông tin lô hàng (một modal dùng chung).
export default function ConsultationTable({ rows }: { rows: ConsultationRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-3 text-left text-xs font-medium text-gray-500">Tên hàng</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Khách hàng</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Số tờ khai</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Trạng thái</th>
              <th className="py-2 pl-3 text-right text-xs font-medium text-gray-500">Ngày tham vấn</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((s) => {
              const dateClass = s.overdue ? "text-red-600" : s.approaching ? "text-amber-700" : "text-gray-600";
              return (
                <tr
                  key={s.id}
                  onClick={() => setOpenId(s.id)}
                  className={`cursor-pointer hover:bg-gray-50 ${s.overdue ? "bg-red-50/40" : ""}`}
                >
                  <td className="max-w-[14rem] py-2.5 pr-3">
                    <span className="block truncate font-medium text-gray-900">
                      {s.goodsName || "Chưa có tên hàng"}
                    </span>
                    {s.port && <p className="truncate text-xs text-gray-400">{s.port}</p>}
                  </td>
                  <td className="max-w-[10rem] truncate px-3 py-2.5 text-gray-600">{s.customerName}</td>
                  <td className="px-3 py-2.5 text-gray-600">{s.declarationNo || "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(s.status)}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className={`whitespace-nowrap py-2.5 pl-3 text-right font-medium ${dateClass}`}>
                    {s.overdue ? "⚠ Quá hạn · " : s.approaching ? "⏰ " : ""}
                    {s.dateLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {openId && <ShipmentInfoModal shipmentId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
