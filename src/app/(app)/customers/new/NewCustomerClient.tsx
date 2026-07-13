"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

const initialForm = {
  companyName: "",
  taxCode: "",
  address: "",
  legalRepName: "",
  legalRepIdNumber: "",
  phone: "",
  email: "",
  notes: "",
};

export default function NewCustomerClient() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!form.companyName.trim() || !form.taxCode.trim()) {
      setError("Vui lòng nhập tên công ty và mã số thuế.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Không thể tạo khách hàng.");
      }
      router.push(`/customers/${json.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/customers" className="text-sm text-blue-600 hover:underline">
          ← Quay lại danh sách
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">Thêm khách hàng mới</h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="max-w-3xl space-y-5 rounded-lg border border-gray-200 bg-white p-6"
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Tên công ty" required>
            <input name="companyName" value={form.companyName} onChange={handleChange} className="input" />
          </Field>

          <Field label="Mã số thuế" required>
            <input name="taxCode" value={form.taxCode} onChange={handleChange} className="input" />
          </Field>

          <Field label="Người đại diện pháp luật">
            <input name="legalRepName" value={form.legalRepName} onChange={handleChange} className="input" />
          </Field>

          <Field label="Số CCCD đại diện pháp luật">
            <input
              name="legalRepIdNumber"
              value={form.legalRepIdNumber}
              onChange={handleChange}
              className="input"
            />
          </Field>

          <Field label="Số điện thoại">
            <input name="phone" value={form.phone} onChange={handleChange} className="input" />
          </Field>

          <Field label="Email">
            <input type="email" name="email" value={form.email} onChange={handleChange} className="input" />
          </Field>
        </div>

        <Field label="Địa chỉ">
          <input name="address" value={form.address} onChange={handleChange} className="input" />
        </Field>

        <Field label="Ghi chú">
          <textarea name="notes" value={form.notes} onChange={handleChange} rows={3} className="input" />
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Link
            href="/customers"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Hủy
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? "Đang lưu..." : "Thêm khách hàng"}
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
