"use client";

import { useEffect, useState } from "react";
import { generateReadablePassword } from "@/lib/password";

type Role = "ADMIN" | "ACCOUNTANT" | "FIELD_STAFF";

type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
};

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Quản trị",
  ACCOUNTANT: "Kế toán",
  FIELD_STAFF: "Nhân viên hiện trường",
};

const ROLE_BADGE: Record<Role, string> = {
  ADMIN: "bg-purple-100 text-purple-700",
  ACCOUNTANT: "bg-blue-100 text-blue-700",
  FIELD_STAFF: "bg-gray-100 text-gray-600",
};

type OneTime = { name: string; email: string; password: string };

const emptyCreate = { name: "", email: "", password: "", role: "FIELD_STAFF" as Role };

export default function UsersClient({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [oneTime, setOneTime] = useState<OneTime | null>(null);

  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; role: Role }>({ name: "", role: "FIELD_STAFF" });
  const [editError, setEditError] = useState<string | null>(null);

  async function refreshUsers() {
    const res = await fetch("/api/users");
    const json = await res.json();
    if (res.ok && json.success) setUsers(json.data);
  }

  useEffect(() => {
    fetch("/api/users")
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể tải danh sách người dùng.");
        setUsers(json.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreateError(null);
    if (createForm.password.length < 8) {
      setCreateError("Mật khẩu cần ít nhất 8 ký tự.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể tạo người dùng.");
      // Show the plaintext (which only ever existed in this browser) exactly once.
      setOneTime({ name: createForm.name, email: createForm.email.toLowerCase().trim(), password: createForm.password });
      setCreateForm(emptyCreate);
      setCreateOpen(false);
      await refreshUsers();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReset(event: React.FormEvent) {
    event.preventDefault();
    if (!resetTarget) return;
    setResetError(null);
    if (resetPassword.length < 8) {
      setResetError("Mật khẩu cần ít nhất 8 ký tự.");
      return;
    }
    try {
      const res = await fetch(`/api/users/${resetTarget.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể đặt lại mật khẩu.");
      setOneTime({ name: resetTarget.name, email: resetTarget.email, password: resetPassword });
      setResetTarget(null);
      setResetPassword("");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    }
  }

  async function handleToggleActive(u: User) {
    const locking = u.isActive;
    if (locking && !confirm(`Khóa tài khoản "${u.name}"? Người này sẽ không đăng nhập được cho tới khi mở khóa.`)) {
      return;
    }
    const res = await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !u.isActive }),
    });
    const json = await res.json();
    if (res.ok && json.success) {
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, isActive: json.data.isActive } : x)));
    } else {
      alert(json.error || "Không thể cập nhật trạng thái.");
    }
  }

  async function handleEditSave(event: React.FormEvent) {
    event.preventDefault();
    if (!editTarget) return;
    setEditError(null);
    try {
      const res = await fetch(`/api/users/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editForm.name, role: editForm.role }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể cập nhật.");
      setUsers((prev) => prev.map((x) => (x.id === editTarget.id ? { ...x, ...json.data } : x)));
      setEditTarget(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Quản lý người dùng</h1>
          <p className="mt-1 text-sm text-gray-500">Cấp tài khoản, đặt lại mật khẩu, khóa/mở tài khoản nhân viên.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreateForm(emptyCreate);
            setCreateError(null);
            setCreateOpen(true);
          }}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Thêm nhân viên
        </button>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Họ tên</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Vai trò</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Trạng thái</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Ngày tạo</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">Đang tải...</td>
              </tr>
            )}
            {!isLoading && error && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-red-600">{error}</td>
              </tr>
            )}
            {!isLoading &&
              !error &&
              users.map((u) => (
                <tr key={u.id} className={u.isActive ? "" : "bg-gray-50/60"}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {u.name}
                    {u.id === currentUserId && <span className="ml-1 text-xs text-gray-400">(bạn)</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[u.role]}`}>
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.isActive ? (
                      <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Đang hoạt động
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        Đã khóa
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(u.createdAt).toLocaleDateString("vi-VN")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setEditTarget(u);
                          setEditForm({ name: u.name, role: u.role });
                          setEditError(null);
                        }}
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResetTarget(u);
                          setResetPassword(generateReadablePassword());
                          setResetError(null);
                        }}
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        Đặt lại mật khẩu
                      </button>
                      {u.id !== currentUserId && (
                        <button
                          type="button"
                          onClick={() => handleToggleActive(u)}
                          className={`text-xs font-medium hover:underline ${u.isActive ? "text-red-600" : "text-green-600"}`}
                        >
                          {u.isActive ? "Khóa" : "Mở khóa"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Create account modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCreateOpen(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-base font-semibold text-gray-900">Thêm nhân viên</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Họ tên</span>
                <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className="input" required />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Email (dùng để đăng nhập)</span>
                <input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} className="input" required />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Vai trò</span>
                <select value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as Role })} className="input">
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Mật khẩu</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                    className="input flex-1"
                    placeholder="Tối thiểu 8 ký tự"
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setCreateForm({ ...createForm, password: generateReadablePassword() })}
                    className="whitespace-nowrap rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Tự sinh
                  </button>
                </div>
              </label>

              {createError && <p className="text-sm text-red-600">{createError}</p>}

              <div className="flex gap-3">
                <button type="submit" disabled={isSubmitting} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {isSubmitting ? "Đang tạo..." : "Tạo tài khoản"}
                </button>
                <button type="button" onClick={() => setCreateOpen(false)} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setResetTarget(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-base font-semibold text-gray-900">Đặt lại mật khẩu</h2>
            <p className="mb-4 text-sm text-gray-500">{resetTarget.name} — {resetTarget.email}</p>
            <form onSubmit={handleReset} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Mật khẩu mới</span>
                <div className="flex gap-2">
                  <input type="text" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} className="input flex-1" minLength={8} required />
                  <button type="button" onClick={() => setResetPassword(generateReadablePassword())} className="whitespace-nowrap rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-600 hover:bg-gray-50">
                    Tự sinh
                  </button>
                </div>
              </label>

              {resetError && <p className="text-sm text-red-600">{resetError}</p>}

              <div className="flex gap-3">
                <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  Đặt lại mật khẩu
                </button>
                <button type="button" onClick={() => setResetTarget(null)} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditTarget(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-base font-semibold text-gray-900">Sửa người dùng</h2>
            <form onSubmit={handleEditSave} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Họ tên</span>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="input" required />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Vai trò</span>
                <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value as Role })} className="input">
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </label>

              {editError && <p className="text-sm text-red-600">{editError}</p>}

              <div className="flex gap-3">
                <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  Lưu
                </button>
                <button type="button" onClick={() => setEditTarget(null)} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* One-time password reveal (create + reset share this) */}
      {oneTime && <OneTimePasswordModal data={oneTime} onClose={() => setOneTime(null)} />}
    </div>
  );
}

function OneTimePasswordModal({ data, onClose }: { data: OneTime; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(data.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-gray-900">Đã tạo tài khoản cho {data.name}</h2>
        <p className="mt-0.5 text-sm text-gray-500">{data.email}</p>

        <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Mật khẩu</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <code className="select-all break-all font-mono text-xl font-bold text-gray-900">{data.password}</code>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              {copied ? "✓ Đã copy" : "Copy"}
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          ⚠ Mật khẩu này chỉ hiển thị MỘT LẦN. Hãy copy và gửi cho nhân viên ngay. Sau khi đóng cửa sổ này sẽ không xem lại được.
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Đã copy, đóng
        </button>
      </div>
    </div>
  );
}
