"use client";

import { useEffect, useState } from "react";
import CustomerCombobox from "@/components/customers/CustomerCombobox";
import ShipmentVehiclesEditor, {
  type ShipmentVehicleDraft,
} from "@/components/shipments/ShipmentVehiclesEditor";
import {
  CHANNEL_OPTIONS,
  CUSTOMS_TYPE_OPTIONS,
  shipmentRequiresHys,
  STATUS_OPTIONS,
} from "@/lib/shipment-constants";
import type { ShipmentDTO } from "@/lib/types";

type EditForm = {
  transport: string;
  transportRoute: string;
  vehiclePlate: string;
  status: string;
  note: string;
  customerName: string;
  customerId: string | null;
  taxCode: string;
  declarationNo: string;
  declarationDate: string;
  consultationDate: string;
  invoiceNo: string;
  customsType: string;
  port: string;
  goodsName: string;
  channel: string;
  customsOffice: string;
  vehicles: ShipmentVehicleDraft[];
};

function formFromShipment(shipment: ShipmentDTO): EditForm {
  return {
    transport: shipment.transport || "",
    transportRoute: shipment.transportRoute || "",
    vehiclePlate: shipment.vehiclePlate || "",
    status: shipment.status,
    note: shipment.note || "",
    customerName: shipment.customerName,
    customerId: shipment.customerId,
    taxCode: shipment.taxCode || "",
    declarationNo: shipment.declarationNo || "",
    declarationDate: shipment.declarationDate ? shipment.declarationDate.slice(0, 10) : "",
    consultationDate: shipment.consultationDate ? shipment.consultationDate.slice(0, 10) : "",
    invoiceNo: shipment.invoiceNo || "",
    customsType: shipment.customsType || "",
    port: shipment.port || "",
    goodsName: shipment.goodsName || "",
    channel: shipment.channel || "",
    customsOffice: shipment.customsOffice || "",
    vehicles: shipment.vehicles.map((vehicle) => ({
      chassisNo: vehicle.chassisNo || "",
      engineNo: vehicle.engineNo || "",
    })),
  };
}

export default function ShipmentEditModal({
  shipment,
  onClose,
  onSaved,
}: {
  shipment: ShipmentDTO;
  onClose: () => void;
  onSaved: (shipment: ShipmentDTO) => void;
}) {
  const [form, setForm] = useState<EditForm>(() => formFromShipment(shipment));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSaving) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSaving, onClose]);

  function handleChange(
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/shipments/${shipment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const text = await response.text();
      const json = text ? JSON.parse(text) : null;
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || "Không thể cập nhật lô hàng.");
      }
      onSaved(json.data as ShipmentDTO);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không thể cập nhật lô hàng.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-2 sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
      role="presentation"
    >
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipment-edit-modal-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 sm:px-6">
          <div>
            <h2 id="shipment-edit-modal-title" className="text-xl font-semibold text-gray-950">
              Chỉnh sửa lô hàng
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              TK {shipment.declarationNo || "Chưa có số tờ khai"} · {shipment.customerName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md p-2 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
            aria-label="Đóng cửa sổ chỉnh sửa lô hàng"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="block md:col-span-2 xl:col-span-1">
              <span className="mb-1 block text-sm font-medium text-gray-700">Khách hàng</span>
              <CustomerCombobox
                customerName={form.customerName}
                customerId={form.customerId}
                onChange={({ customerName, customerId }) =>
                  setForm((current) => ({ ...current, customerName, customerId }))
                }
              />
            </label>

            <Field label="Mã số thuế" name="taxCode" value={form.taxCode} onChange={handleChange} />
            <Field label="Số tờ khai" name="declarationNo" value={form.declarationNo} onChange={handleChange} />
            <Field label="Ngày tờ khai" name="declarationDate" value={form.declarationDate} type="date" onChange={handleChange} />
            <Field label="Ngày tham vấn" name="consultationDate" value={form.consultationDate} type="date" onChange={handleChange} />
            <Field label="Số invoice" name="invoiceNo" value={form.invoiceNo} onChange={handleChange} />

            <SelectField label="Loại hình" name="customsType" value={form.customsType} onChange={handleChange}>
              <option value="">-- Chọn loại hình --</option>
              {CUSTOMS_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </SelectField>

            <Field label="Cửa khẩu/Cảng" name="port" value={form.port} onChange={handleChange} />
            <Field label="Tên hàng" name="goodsName" value={form.goodsName} onChange={handleChange} />

            <SelectField label="Phân luồng" name="channel" value={form.channel} onChange={handleChange}>
              <option value="">-- Chọn phân luồng --</option>
              {CHANNEL_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </SelectField>

            <Field label="HQ tiếp nhận" name="customsOffice" value={form.customsOffice} onChange={handleChange} />
            <Field
              label="Vận tải"
              name="transport"
              value={form.transport}
              placeholder="VD: Đường biển - Hãng tàu ABC"
              onChange={handleChange}
            />
            <Field
              label="Cung đường vận chuyển"
              name="transportRoute"
              value={form.transportRoute}
              placeholder="VD: Hữu Nghị → Hà Nội"
              onChange={handleChange}
            />
            <Field
              label="BKS xe vận chuyển"
              name="vehiclePlate"
              value={form.vehiclePlate}
              placeholder="VD: 29C-123.45"
              onChange={handleChange}
            />

            <SelectField label="Trạng thái" name="status" value={form.status} onChange={handleChange}>
              {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </SelectField>

            <label className="block md:col-span-2 xl:col-span-3">
              <span className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</span>
              <textarea name="note" value={form.note} onChange={handleChange} rows={3} className="input" />
            </label>
          </div>

          {(shipmentRequiresHys(form.goodsName) || form.vehicles.length > 0) && (
            <ShipmentVehiclesEditor
              vehicles={form.vehicles}
              onChange={(vehicles) => setForm((current) => ({ ...current, vehicles }))}
            />
          )}

          {error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? "Đang lưu..." : "Lưu cập nhật"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function Field({
  label,
  ...props
}: {
  label: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <input {...props} className="input" />
    </label>
  );
}

function SelectField({
  label,
  children,
  ...props
}: {
  label: string;
  children: React.ReactNode;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <select {...props} className="input">
        {children}
      </select>
    </label>
  );
}
