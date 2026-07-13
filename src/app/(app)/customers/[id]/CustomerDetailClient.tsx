"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Badge from "@/components/shipments/Badge";
import { statusBadgeClass } from "@/lib/shipment-constants";

type CustomerShipment = {
  id: string;
  shipmentCode: string;
  declarationNo: string | null;
  status: string;
  createdAt: string;
};

type AssignableUser = { id: string; name: string; email: string };

type Customer = {
  id: string;
  companyName: string;
  taxCode: string;
  address: string | null;
  legalRepName: string | null;
  legalRepIdNumber: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  assignedUser: AssignableUser | null;
  shipments: CustomerShipment[];
};

export default function CustomerDetailClient({
  customerId,
  canManage,
}: {
  customerId: string;
  canManage: boolean;
}) {
  const router = useRouter();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [users, setUsers] = useState<AssignableUser[]>([]);

  const [form, setForm] = useState({
    companyName: "",
    taxCode: "",
    address: "",
    legalRepName: "",
    legalRepIdNumber: "",
    phone: "",
    email: "",
    notes: "",
    assignedUserId: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/customers/${customerId}`)
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể tải thông tin khách hàng.");
        const data: Customer = json.data;
        setCustomer(data);
        setForm({
          companyName: data.companyName,
          taxCode: data.taxCode,
          address: data.address || "",
          legalRepName: data.legalRepName || "",
          legalRepIdNumber: data.legalRepIdNumber || "",
          phone: data.phone || "",
          email: data.email || "",
          notes: data.notes || "",
          assignedUserId: data.assignedUser?.id || "",
        });
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, [customerId]);

  useEffect(() => {
    if (!canManage) return;
    fetch("/api/users")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setUsers(json.data);
      })
      .catch(() => {});
  }, [canManage]);

  function handleChange(event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setSaveError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Cập nhật thất bại.");
      setCustomer((prev) => (prev ? { ...prev, ...json.data } : prev));
      setSuccessMessage("Cập nhật khách hàng thành công.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Xóa khách hàng này?")) return;
    await fetch(`/api/customers/${customerId}`, { method: "DELETE" });
    router.push("/customers");
  }

  if (isLoading) return <div className="p-8 text-gray-400">Đang tải...</div>;
  if (loadError || !customer) {
    return (
      <div className="p-8">
        <p className="text-red-600">{loadError || "Không tìm thấy khách hàng."}</p>
        <Link href="/customers" className="mt-4 inline-block text-blue-600 hover:underline">
          ← Quay lại danh sách
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/customers" className="text-sm text-blue-600 hover:underline">
          ← Quay lại danh sách
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">{customer.companyName}</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-lg border border-gray-200 bg-white p-6 lg:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Thông tin khách hàng</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Info label="Tên công ty" value={customer.companyName} />
            <Info label="Mã số thuế" value={customer.taxCode} />
            <Info label="Người đại diện pháp luật" value={customer.legalRepName} />
            <Info label="Số CCCD đại diện pháp luật" value={customer.legalRepIdNumber} />
            <Info label="Số điện thoại" value={customer.phone} />
            <Info label="Email" value={customer.email} />
            <Info label="Địa chỉ" value={customer.address} />
            <Info label="Người phụ trách" value={customer.assignedUser?.name} />
            <Info label="Ghi chú" value={customer.notes} />
          </dl>

          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-gray-900">Lô hàng đã làm</h3>
            {customer.shipments.length > 0 ? (
              <div className="overflow-x-auto rounded-md border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Mã lô hàng</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Số tờ khai</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {customer.shipments.map((shipment) => (
                      <tr key={shipment.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <Link
                            href={`/shipments/${shipment.id}`}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            {shipment.shipmentCode}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-gray-600">{shipment.declarationNo || "—"}</td>
                        <td className="px-3 py-2">
                          <Badge label={shipment.status} className={statusBadgeClass(shipment.status)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Chưa có lô hàng nào liên kết với khách hàng này.</p>
            )}
          </div>
        </section>

        {canManage && (
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-base font-semibold text-gray-900">Sửa thông tin</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Tên công ty</span>
                <input name="companyName" value={form.companyName} onChange={handleChange} className="input" />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Mã số thuế</span>
                <input name="taxCode" value={form.taxCode} onChange={handleChange} className="input" />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Người đại diện pháp luật</span>
                <input name="legalRepName" value={form.legalRepName} onChange={handleChange} className="input" />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Số CCCD đại diện pháp luật</span>
                <input
                  name="legalRepIdNumber"
                  value={form.legalRepIdNumber}
                  onChange={handleChange}
                  className="input"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Số điện thoại</span>
                <input name="phone" value={form.phone} onChange={handleChange} className="input" />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
                <input type="email" name="email" value={form.email} onChange={handleChange} className="input" />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Địa chỉ</span>
                <input name="address" value={form.address} onChange={handleChange} className="input" />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Người phụ trách</span>
                <select name="assignedUserId" value={form.assignedUserId} onChange={handleChange} className="input">
                  <option value="">-- Chưa phân công --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</span>
                <textarea name="notes" value={form.notes} onChange={handleChange} rows={3} className="input" />
              </label>

              {saveError && <p className="text-sm text-red-600">{saveError}</p>}
              {successMessage && <p className="text-sm text-green-600">{successMessage}</p>}

              <button
                type="submit"
                disabled={isSaving}
                className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isSaving ? "Đang lưu..." : "Lưu cập nhật"}
              </button>
            </form>

            <button
              type="button"
              onClick={handleDelete}
              className="mt-4 text-sm text-red-600 hover:underline"
            >
              Xóa khách hàng
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value || "—"}</dd>
    </div>
  );
}
