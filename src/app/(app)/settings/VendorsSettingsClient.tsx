"use client";

import { useCallback, useEffect, useState } from "react";

type Vendor = {
  id: string;
  name: string;
  type: string | null;
  taxCode: string | null;
  phone: string | null;
  address: string | null;
  note: string | null;
};

type VendorForm = {
  id: string;
  name: string;
  type: string;
  taxCode: string;
  phone: string;
  address: string;
  note: string;
};

const EMPTY_FORM: VendorForm = {
  id: "",
  name: "",
  type: "",
  taxCode: "",
  phone: "",
  address: "",
  note: "",
};

async function readApiJson(response: Response) {
  const text = await response.text();
  if (!text) throw new Error(`Máy chủ không trả về dữ liệu (HTTP ${response.status}).`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Phản hồi máy chủ không hợp lệ (HTTP ${response.status}).`);
  }
}

export default function VendorsSettingsClient() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [form, setForm] = useState<VendorForm>(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadVendors = useCallback(async (query = search) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("search", query.trim());
    const response = await fetch(`/api/vendors?${params}`, { cache: "no-store" });
    const json = await readApiJson(response);
    if (!response.ok || !json.success) throw new Error(json.error || "Không thể tải nhà cung cấp.");
    setVendors(json.data);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      setError(null);
      loadVendors()
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Không thể tải nhà cung cấp.");
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadVendors]);

  function updateForm(field: keyof VendorForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("Vui lòng nhập tên nhà cung cấp.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(form.id ? `/api/vendors/${form.id}` : "/api/vendors", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          type: form.type.trim(),
          taxCode: form.taxCode.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          note: form.note.trim(),
        }),
      });
      const json = await readApiJson(response);
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể lưu nhà cung cấp.");

      setMessage(form.id ? "Đã cập nhật nhà cung cấp." : "Đã thêm nhà cung cấp mới.");
      setForm(EMPTY_FORM);
      if (search) setSearch("");
      else await loadVendors("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể lưu nhà cung cấp.");
    } finally {
      setIsSaving(false);
    }
  }

  function editVendor(vendor: Vendor) {
    setForm({
      id: vendor.id,
      name: vendor.name,
      type: vendor.type || "",
      taxCode: vendor.taxCode || "",
      phone: vendor.phone || "",
      address: vendor.address || "",
      note: vendor.note || "",
    });
    setMessage(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteVendor(vendor: Vendor) {
    if (!confirm(`Xóa nhà cung cấp "${vendor.name}"? Các khoản đang liên kết sẽ chuyển thành chưa gắn nhà cung cấp.`)) return;
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/vendors/${vendor.id}`, { method: "DELETE" });
      const json = await readApiJson(response);
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể xóa nhà cung cấp.");
      setVendors((current) => current.filter((item) => item.id !== vendor.id));
      if (form.id === vendor.id) setForm(EMPTY_FORM);
      setMessage("Đã xóa nhà cung cấp.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể xóa nhà cung cấp.");
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-900">Thông tin nhà cung cấp</h2>
        <p className="mt-1 text-sm text-gray-500">Thông tin tại đây được dùng cho chi phí, công nợ và đối chiếu hóa đơn đầu vào.</p>
      </div>

      <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block xl:col-span-2">
            <span className="mb-1 block text-sm font-medium text-gray-700">Tên nhà cung cấp *</span>
            <input value={form.name} onChange={(event) => updateForm("name", event.target.value)} className="input" placeholder="VD: Công ty vận tải ABC" required />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Loại nhà cung cấp</span>
            <input value={form.type} onChange={(event) => updateForm("type", event.target.value)} className="input" placeholder="Vận tải, bến bãi..." list="vendor-type-options" />
            <datalist id="vendor-type-options">
              <option value="Vận tải" />
              <option value="Bến bãi" />
              <option value="Sang tải" />
              <option value="Hãng tàu" />
              <option value="Kho bãi" />
              <option value="Đại lý" />
              <option value="Khác" />
            </datalist>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Mã số thuế</span>
            <input value={form.taxCode} onChange={(event) => updateForm("taxCode", event.target.value)} className="input" placeholder="Mã số thuế" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Số điện thoại</span>
            <input value={form.phone} onChange={(event) => updateForm("phone", event.target.value)} className="input" placeholder="Số điện thoại" />
          </label>
          <label className="block xl:col-span-2">
            <span className="mb-1 block text-sm font-medium text-gray-700">Địa chỉ</span>
            <input value={form.address} onChange={(event) => updateForm("address", event.target.value)} className="input" placeholder="Địa chỉ nhà cung cấp" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</span>
            <input value={form.note} onChange={(event) => updateForm("note", event.target.value)} className="input" placeholder="Ghi chú" />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={isSaving} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {isSaving ? "Đang lưu..." : form.id ? "Lưu thay đổi" : "+ Thêm nhà cung cấp"}
          </button>
          {form.id && <button type="button" onClick={() => setForm(EMPTY_FORM)} className="text-sm text-gray-500 hover:underline">Hủy sửa</button>}
          {message && <span className="text-sm text-green-700">{message}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>

      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4">
          <div>
            <h3 className="font-semibold text-gray-900">Danh sách nhà cung cấp</h3>
            <p className="text-xs text-gray-500">{isLoading ? "Đang tải..." : `${vendors.length} nhà cung cấp`}</p>
          </div>
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="input w-72" placeholder="Tìm tên hoặc mã số thuế..." />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50"><tr>
              <th className="w-14 px-4 py-3 text-center font-medium text-gray-500">STT</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Tên nhà cung cấp</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Loại</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Mã số thuế</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Điện thoại</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Địa chỉ / ghi chú</th>
              <th className="px-4 py-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Đang tải nhà cung cấp...</td></tr>}
              {!isLoading && vendors.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Chưa có nhà cung cấp phù hợp.</td></tr>}
              {!isLoading && vendors.map((vendor, index) => (
                <tr key={vendor.id} className="align-top hover:bg-gray-50">
                  <td className="px-4 py-3 text-center text-gray-400">{index + 1}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{vendor.name}</td>
                  <td className="px-4 py-3 text-gray-600">{vendor.type || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{vendor.taxCode || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{vendor.phone || "—"}</td>
                  <td className="max-w-sm px-4 py-3 text-gray-600"><span>{vendor.address || "—"}</span>{vendor.note && <span className="mt-1 block text-xs text-gray-400">{vendor.note}</span>}</td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-3">
                    <button type="button" onClick={() => editVendor(vendor)} className="text-blue-600 hover:underline">Sửa</button>
                    <button type="button" onClick={() => void deleteVendor(vendor)} className="text-red-600 hover:underline">Xóa</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
