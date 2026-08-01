import Link from "next/link";
import { getDeclarationBranches } from "@/lib/shipment-constants";
import type { ShipmentDTO } from "@/lib/types";

type DetailCell = {
  label: string;
  value: React.ReactNode;
  warn?: boolean;
};

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("vi-VN") : "—";
}

export default function ShipmentDetailsTable({
  shipment,
  linkCustomer = false,
  onCustomerClick,
  warnConsultationDate = false,
}: {
  shipment: ShipmentDTO;
  linkCustomer?: boolean;
  onCustomerClick?: () => void;
  warnConsultationDate?: boolean;
}) {
  const branches = getDeclarationBranches(shipment.declarationBranches);
  const declarationValue = branches ? (
    <div className="space-y-1">
      {branches.map((branch) => (
        <div key={branch.number}>
          <span className="text-gray-500">{branch.label}:</span> {branch.number}
        </div>
      ))}
    </div>
  ) : (
    shipment.declarationNo
  );
  const customerValue = onCustomerClick && shipment.customerId ? (
    <button
      type="button"
      onClick={onCustomerClick}
      className="text-left font-medium text-blue-600 hover:underline"
    >
      {shipment.customerName}
    </button>
  ) : linkCustomer && shipment.customerId ? (
    <Link href={`/customers/${shipment.customerId}`} className="font-medium text-blue-600 hover:underline">
      {shipment.customerName}
    </Link>
  ) : (
    shipment.customerName
  );

  const rows: DetailCell[][] = [
    [
      { label: "Khách hàng", value: customerValue },
      { label: "Mã số thuế", value: shipment.taxCode },
    ],
    [
      { label: "Số tờ khai", value: declarationValue },
      { label: "Ngày tờ khai", value: formatDate(shipment.declarationDate) },
    ],
    [
      {
        label: "Ngày tham vấn",
        value: formatDate(shipment.consultationDate),
        warn: warnConsultationDate,
      },
      { label: "Loại hình", value: shipment.customsType },
    ],
    [
      { label: "Số invoice", value: shipment.invoiceNo },
      { label: "Cửa khẩu/Cảng", value: shipment.port },
    ],
    [
      { label: "Tên hàng", value: shipment.goodsName },
      { label: "HQ tiếp nhận", value: shipment.customsOffice },
    ],
    [
      { label: "Vận tải", value: shipment.transport },
      { label: "Cung đường vận chuyển", value: shipment.transportRoute },
    ],
    [
      { label: "BKS xe vận chuyển", value: shipment.vehiclePlate },
      { label: "Ghi chú", value: shipment.note },
    ],
  ];

  return (
    <dl className="overflow-hidden rounded-lg border border-gray-200">
      {rows.map((row, rowIndex) => (
        <div
          key={row.map((cell) => cell.label).join("-")}
          className={`grid divide-y divide-gray-200 md:grid-cols-2 md:divide-x md:divide-y-0 ${
            rowIndex > 0 ? "border-t border-gray-200" : ""
          }`}
        >
          {row.map((cell) => (
            <div
              key={cell.label}
              className="grid min-w-0 grid-cols-[8.5rem_minmax(0,1fr)] sm:grid-cols-[10rem_minmax(0,1fr)]"
            >
              <dt className="flex items-center bg-gray-50 px-3 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:px-4">
                {cell.label}
              </dt>
              <dd
                className={`min-w-0 break-words px-3 py-3 text-sm sm:px-4 ${
                  cell.warn ? "font-medium text-red-600" : "text-gray-900"
                }`}
              >
                {cell.warn ? "⚠ " : ""}
                {cell.value === null || cell.value === undefined || cell.value === "" ? "—" : cell.value}
              </dd>
            </div>
          ))}
        </div>
      ))}
    </dl>
  );
}
