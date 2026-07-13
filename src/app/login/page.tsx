"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/setup")
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.success) setNeedsSetup(json.data.needsSetup);
      })
      .catch(() => {
        if (!cancelled) setNeedsSetup(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const url = needsSetup ? "/api/auth/setup" : "/api/auth/login";
      const body = needsSetup ? { name, email, password } : { email, password };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Không thể đăng nhập.");
      }
      router.push("/shipments");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (needsSetup === null) {
    return <div className="flex min-h-screen items-center justify-center text-gray-400">Đang tải...</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">
          {needsSetup ? "Khởi tạo tài khoản quản trị" : "Đăng nhập"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {needsSetup
            ? "Hệ thống chưa có tài khoản nào — tạo tài khoản Admin đầu tiên để bắt đầu."
            : "Logistics App"}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {needsSetup && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Họ tên</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                required
              />
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              required
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Mật khẩu</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              minLength={needsSetup ? 8 : undefined}
              required
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? "Đang xử lý..." : needsSetup ? "Tạo tài khoản Admin" : "Đăng nhập"}
          </button>
        </form>
      </div>
    </div>
  );
}
