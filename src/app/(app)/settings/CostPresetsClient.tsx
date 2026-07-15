"use client";

import { useEffect, useState } from "react";
import { COST_CATEGORY_LABELS, COST_CATEGORY_OPTIONS } from "@/lib/shipment-cost-constants";
import VendorCombobox from "@/components/vendors/VendorCombobox";

type Preset = {
  id: string;
  goodsName: string;
  goodsKeyword: string;
  category: string;
  unitPrice: number;
  quantity: number;
  note: string | null;
  isActive: boolean;
  vendorId: string | null;
  vendor: { id: string; name: string; type: string | null } | null;
};

const emptyForm = {
  id: "",
  goodsName: "",
  category: COST_CATEGORY_OPTIONS[0] as string,
  unitPrice: "",
  quantity: "1",
  note: "",
  vendorId: null as string | null,
  vendorName: "",
};

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

export default function CostPresetsClient() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadPresets() {
    return fetch("/api/cost-presets")
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể tải bảng giá.");
        setPresets(json.data);
      });
  }

  useEffect(() => {
    loadPresets()
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(form.id ? `/api/cost-presets/${form.id}` : "/api/cost-presets", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể lưu cấu hình.");
      setMessage(`Đã lưu và áp dụng cho ${json.data.matchedShipments} lô hàng có tờ khai.`);
      setForm(emptyForm);
      await loadPresets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Xóa cấu hình giá này? Các chi phí đã sinh trên lô hàng vẫn được giữ lại.")) return;
    const response = await fetch(`/api/cost-presets/${id}`, { method: "DELETE" });
    const json = await response.json();
    if (json.success) setPresets((current) => current.filter((item) => item.id !== id));
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Cài đặt chi phí mặt hàng</h1>
        <p className="mt-1 text-sm text-gray-500">
          Khi lô hàng có số tờ khai, hệ thống tự thêm chi phí theo nhóm hai từ đầu của tên hàng.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-8">
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm font-medium text-gray-700">Tên/nhóm mặt hàng</span>
            <input
              value={form.goodsName}
              onChange={(event) => setForm((current) => ({ ...current, goodsName: event.target.value }))}
              className="input"
              placeholder="VD: MÁY ÉP CỌC"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Hạng mục</span>
            <select
              value={form.category}
              onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
              className="input"
            >
              {COST_CATEGORY_OPTIONS.map((category) => (
                <option key={category} value={category}>{COST_CATEGORY_LABELS[category]}</option>
              ))}
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm font-medium text-gray-700">Nhà cung cấp mặc định</span>
            <VendorCombobox
              vendorName={form.vendorName}
              vendorId={form.vendorId}
              onChange={({ vendorName, vendorId }) => setForm((current) => ({ ...current, vendorName, vendorId }))}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Đơn giá</span>
            <input type="number" min="0" value={form.unitPrice} onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))} className="input" required />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Số lượng</span>
            <input type="number" min="0.01" step="any" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} className="input" required />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</span>
            <input value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} className="input" />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="submit" disabled={isSaving} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {isSaving ? "Đang áp dụng..." : form.id ? "Lưu thay đổi" : "+ Thêm cấu hình"}
          </button>
          {form.id && <button type="button" onClick={() => setForm(emptyForm)} className="text-sm text-gray-500 hover:underline">Hủy sửa</button>}
          {message && <span className="text-sm text-green-700">{message}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50"><tr>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Tên hàng</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Nhóm khớp</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Hạng mục</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Nhà cung cấp</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Đơn giá × SL</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Thành tiền</th>
            <th className="px-4 py-3"></th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Đang tải...</td></tr>}
            {!isLoading && presets.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Chưa có cấu hình giá.</td></tr>}
            {presets.map((preset) => <tr key={preset.id}>
              <td className="px-4 py-3 font-medium text-gray-900">{preset.goodsName}</td>
              <td className="px-4 py-3 text-gray-500">{preset.goodsKeyword}</td>
              <td className="px-4 py-3 text-gray-700">{COST_CATEGORY_LABELS[preset.category]}</td>
              <td className="px-4 py-3 text-gray-600">{preset.vendor?.name || <span className="text-amber-600">Chưa gắn</span>}</td>
              <td className="px-4 py-3 text-gray-600">{formatVnd(preset.unitPrice)} × {preset.quantity}</td>
              <td className="px-4 py-3 font-medium text-gray-900">{formatVnd(preset.unitPrice * preset.quantity)}</td>
              <td className="px-4 py-3"><div className="flex gap-3">
                <button type="button" onClick={() => setForm({ id: preset.id, goodsName: preset.goodsName, category: preset.category, unitPrice: String(preset.unitPrice), quantity: String(preset.quantity), note: preset.note || "", vendorId: preset.vendorId, vendorName: preset.vendor?.name || "" })} className="text-blue-600 hover:underline">Sửa</button>
                <button type="button" onClick={() => handleDelete(preset.id)} className="text-red-600 hover:underline">Xóa</button>
              </div></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
