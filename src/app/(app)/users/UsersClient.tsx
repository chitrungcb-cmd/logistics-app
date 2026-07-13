"use client";

import { useEffect, useState } from "react";

type User = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "ACCOUNTANT" | "FIELD_STAFF";
  createdAt: string;
};

const ROLE_LABELS: Record<User["role"], string> = {
  ADMIN: "Quản trị",
  ACCOUNTANT: "Kế toán",
  FIELD_STAFF: "Nhân viên hiện trường",
};

export default function UsersClient() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ name: "", email: "", password: "", role: "FIELD_STAFF" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function refreshUsers() {
    const res = await fetch("/api/users");
    const json = await res.json();
    if (res.ok && json.success) setUsers(json.data);
  }

  useEffect(() => {
    async function loadInitialUsers() {
      try {
        const res = await fetch("/api/users");
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Không thể tải danh sách người dùng.");
        setUsers(json.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialUsers();
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể tạo người dùng.");
      setForm({ name: "", email: "", password: "", role: "FIELD_STAFF" });
      await refreshUsers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRoleChange(id: string, role: string) {
    await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    await refreshUsers();
  }

  async function handleDelete(id: string) {
    if (!confirm("Xóa người dùng này?")) return;
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    await refreshUsers();
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-gray-900">Quản lý người dùng</h1>
      <p className="mt-1 text-sm text-gray-500">Chỉ Admin mới truy cập được trang này.</p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white lg:col-span-2">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Họ tên</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Vai trò</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-400">Đang tải...</td>
                </tr>
              )}
              {!isLoading && error && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-red-600">{error}</td>
                </tr>
              )}
              {!isLoading &&
                !error &&
                users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        className="input w-auto"
                      >
                        {Object.entries(ROLE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleDelete(u.id)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <section className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-base font-semibold text-gray-900">Tạo người dùng mới</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Họ tên</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="input"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Mật khẩu</span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="input"
                minLength={8}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Vai trò</span>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="input"
              >
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? "Đang tạo..." : "Tạo người dùng"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
