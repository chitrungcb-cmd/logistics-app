"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { CurrentUser } from "@/lib/auth";
import NotificationBell from "@/components/NotificationBell";

const NAV_ITEMS = [
  { label: "Tổng quan", href: "/", icon: "🏠" },
  { label: "Khách hàng", href: "/customers", icon: "👥" },
  { label: "Lô hàng", href: "/shipments", icon: "📦" },
  { label: "Nhiệm vụ", href: "/tasks", icon: "✅" },
  { label: "Tin nhắn", href: "/messages", icon: "💬" },
  { label: "Chi phí", href: "/costs", icon: "💰" },
  { label: "Kho chứng từ", href: "/documents", icon: "🗂️" },
  { label: "Báo cáo", href: "/reports", icon: "📊" },
  { label: "Đối tác", href: "/partners", icon: "🤝" },
  { label: "Cài đặt", href: "/settings", icon: "⚙️" },
];

const DEBTS_NAV_ITEM = { label: "Công nợ", href: "/debts", icon: "📒" };
const USERS_NAV_ITEM = { label: "Người dùng", href: "/users", icon: "🛡️" };

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Quản trị viên",
  ACCOUNTANT: "Kế toán",
  FIELD_STAFF: "Nhân viên hiện trường",
};

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export default function Sidebar({ user }: { user: CurrentUser | null }) {
  const pathname = usePathname();
  const router = useRouter();

  const navItems = [...NAV_ITEMS];
  if (user?.role === "ADMIN" || user?.role === "ACCOUNTANT") {
    navItems.splice(6, 0, DEBTS_NAV_ITEM);
  }
  if (user?.role === "ADMIN") {
    navItems.push(USERS_NAV_ITEM);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-16 items-center justify-between border-b border-gray-200 px-5">
        <span className="text-lg font-semibold text-gray-900">Logistics App</span>
        {user && <NotificationBell />}
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {navItems.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      {user && (
        <div className="border-t border-gray-200 p-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
              {getInitials(user.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{user.name}</p>
              <p className="truncate text-xs text-gray-500">{ROLE_LABELS[user.role] ?? user.role}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-2 w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Đăng xuất
          </button>
        </div>
      )}
    </aside>
  );
}
