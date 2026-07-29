"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import CustomerCombobox from "@/components/customers/CustomerCombobox";
import {
  CHANNEL_OPTIONS,
  CUSTOMS_TYPE_OPTIONS,
  STATUS_OPTIONS,
} from "@/lib/shipment-constants";

const initialForm = {
  customerName: "",
  customerId: null as string | null,
  declarationNo: "",
  customsType: "",
  invoiceNo: "",
  port: "",
  goodsName: "",
  channel: "",
  status: STATUS_OPTIONS[0],
  customsOffice: "",
  note: "",
};

export default function NewShipmentPage() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!form.customerName.trim()) {
      setError("Vui lòng nhập tên khách hàng.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Không thể tạo lô hàng.");
      }
      router.push("/shipments");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/shipments" className="text-sm text-blue-600 hover:underline">
          ← Quay lại danh sách
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">Tạo lô hàng mới</h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="max-w-3xl space-y-5 rounded-lg border border-gray-200 bg-white p-6"
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Khách hàng" required>
            <CustomerCombobox
              customerName={form.customerName}
              customerId={form.customerId}
              onChange={({ customerName, customerId }) =>
                setForm((prev) => ({ ...prev, customerName, customerId }))
              }
            />
          </Field>

          <Field label="Số tờ khai">
            <input
              name="declarationNo"
              value={form.declarationNo}
              onChange={handleChange}
              className="input"
            />
          </Field>

          <Field label="Loại hình">
            <select name="customsType" value={form.customsType} onChange={handleChange} className="input">
              <option value="">-- Chọn loại hình --</option>
              {CUSTOMS_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Số invoice">
            <input
              name="invoiceNo"
              value={form.invoiceNo}
              onChange={handleChange}
              className="input"
            />
          </Field>

          <Field label="Cửa khẩu/Cảng">
            <input name="port" value={form.port} onChange={handleChange} className="input" />
          </Field>

          <Field label="Tên hàng">
            <input
              name="goodsName"
              value={form.goodsName}
              onChange={handleChange}
              className="input"
            />
          </Field>

          <Field label="Phân luồng">
            <select name="channel" value={form.channel} onChange={handleChange} className="input">
              <option value="">-- Chọn phân luồng --</option>
              {CHANNEL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Trạng thái">
            <select name="status" value={form.status} onChange={handleChange} className="input">
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>

          <Field label="HQ tiếp nhận">
            <input
              name="customsOffice"
              value={form.customsOffice}
              onChange={handleChange}
              className="input"
            />
          </Field>
        </div>

        <Field label="Ghi chú">
          <textarea
            name="note"
            value={form.note}
            onChange={handleChange}
            rows={3}
            className="input"
          />
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Link
            href="/shipments"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Hủy
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? "Đang lưu..." : "Tạo lô hàng"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
