"use client";

import { useState } from "react";
import ShipmentInfoModal from "@/components/shipments/ShipmentInfoModal";

/**
 * Thay cho `<Link href="/shipments/[id]">` ở mọi module: bấm vào mở cửa sổ thông tin lô hàng
 * (`ShipmentInfoModal`) ngay tại chỗ thay vì điều hướng sang tab Lô hàng. Tự quản lý trạng thái mở
 * để chỗ gọi chỉ cần đổi tên thẻ. `stopPropagation` để không kích hoạt onClick của hàng bảng bao
 * ngoài (ví dụ hàng công nợ vốn điều hướng sang trang chi tiết khi bấm).
 */
export default function ShipmentLink({
  shipmentId,
  className,
  children,
}: {
  shipmentId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen(true);
        }}
        className={className}
      >
        {children}
      </button>
      {isOpen && <ShipmentInfoModal shipmentId={shipmentId} onClose={() => setIsOpen(false)} />}
    </>
  );
}
