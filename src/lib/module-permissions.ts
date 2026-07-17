import type { UserRole } from "@/generated/prisma/enums";

export const APP_MODULES = [
  { key: "CUSTOMERS", label: "Khách hàng", href: "/customers", icon: "👥" },
  { key: "SHIPMENTS", label: "Lô hàng", href: "/shipments", icon: "📦" },
  { key: "TASKS", label: "Nhiệm vụ", href: "/tasks", icon: "✅" },
  { key: "MESSAGES", label: "Tin nhắn", href: "/messages", icon: "💬" },
  { key: "COSTS", label: "Chi phí lô hàng", href: "/costs", icon: "💰" },
  { key: "OTHER_EXPENSES", label: "Chi phí khác", href: "/other-expenses", icon: "🧾" },
  { key: "DEBTS", label: "Công nợ", href: "/debts", icon: "📒" },
  { key: "DOCUMENTS", label: "Kho chứng từ", href: "/documents", icon: "🗂️" },
  { key: "REPORTS", label: "Báo cáo", href: "/reports", icon: "📊" },
  { key: "PARTNERS", label: "Đối tác", href: "/partners", icon: "🤝" },
  { key: "SETTINGS", label: "Cài đặt", href: "/settings", icon: "⚙️" },
  { key: "USERS", label: "Người sử dụng", href: "/users", icon: "🛡️" },
] as const;

export type AppModule = (typeof APP_MODULES)[number]["key"];

export const ALL_APP_MODULES = APP_MODULES.map((module) => module.key) as AppModule[];

const ROLE_MODULES: Record<UserRole, readonly AppModule[]> = {
  ADMIN: ALL_APP_MODULES,
  ACCOUNTANT: [
    "CUSTOMERS",
    "SHIPMENTS",
    "TASKS",
    "MESSAGES",
    "OTHER_EXPENSES",
    "DEBTS",
    "DOCUMENTS",
    "REPORTS",
    "PARTNERS",
  ],
  FIELD_STAFF: ["CUSTOMERS", "SHIPMENTS", "TASKS", "MESSAGES", "DOCUMENTS", "REPORTS"],
};

type ModuleUser = {
  role: UserRole;
  modulePermissions: readonly string[];
};

export function getRoleModules(role: UserRole): AppModule[] {
  return [...ROLE_MODULES[role]];
}

export function normalizeModulePermissions(value: unknown, role: UserRole): AppModule[] {
  if (role === "ADMIN") return [...ALL_APP_MODULES];
  if (!Array.isArray(value)) return [];

  const requested = new Set(value.filter((item): item is string => typeof item === "string"));
  return ALL_APP_MODULES.filter((module) => requested.has(module));
}

export function hasOnlyValidModulePermissions(value: unknown, role: UserRole): value is AppModule[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return false;
  if (role === "ADMIN") return value.length === ALL_APP_MODULES.length &&
    ALL_APP_MODULES.every((module) => value.includes(module));
  const allowed = new Set(ALL_APP_MODULES);
  return value.every((item) => allowed.has(item as AppModule));
}

export function getEffectiveModulePermissions(user: ModuleUser): AppModule[] {
  return normalizeModulePermissions(user.modulePermissions, user.role);
}

export function hasModuleAccess(user: ModuleUser, module: AppModule): boolean {
  if (user.role === "ADMIN") return true;
  return getEffectiveModulePermissions(user).includes(module);
}

export function getPageModule(pathname: string): AppModule | null {
  const item = APP_MODULES.find(
    (module) => pathname === module.href || pathname.startsWith(`${module.href}/`)
  );
  return item?.key ?? null;
}

/**
 * Some APIs are shared by more than one screen. Returning multiple modules means that access to
 * any one of them is sufficient for this supporting endpoint.
 */
export function getApiModules(pathname: string, method: string): AppModule[] | null {
  if (pathname.startsWith("/api/conversations")) return ["MESSAGES"];
  if (pathname.startsWith("/api/costs")) return ["COSTS"];
  if (pathname.startsWith("/api/other-expenses")) return ["OTHER_EXPENSES"];
  if (pathname.startsWith("/api/cost-presets")) return ["COSTS", "SETTINGS"];
  if (pathname.startsWith("/api/customers")) return ["CUSTOMERS", "SHIPMENTS"];
  if (pathname.startsWith("/api/debts")) return ["DEBTS"];
  if (pathname.startsWith("/api/gmail")) return ["SHIPMENTS"];
  if (pathname.startsWith("/api/reports")) return ["REPORTS"];
  if (pathname.startsWith("/api/shipments")) return ["SHIPMENTS", "TASKS", "MESSAGES", "DEBTS"];
  if (pathname.startsWith("/api/tasks")) return ["TASKS"];
  if (pathname.startsWith("/api/vendor-invoices")) return ["DEBTS", "PARTNERS", "REPORTS"];
  if (pathname.startsWith("/api/vendors")) return ["PARTNERS", "SETTINGS", "COSTS"];
  if (pathname.startsWith("/api/attachments") || pathname.startsWith("/api/upload")) {
    return ["SHIPMENTS", "TASKS", "MESSAGES", "DEBTS", "DOCUMENTS", "PARTNERS", "OTHER_EXPENSES"];
  }
  if (pathname.startsWith("/api/users")) {
    return method === "GET" ? ["USERS", "TASKS", "MESSAGES", "CUSTOMERS"] : ["USERS"];
  }
  return null;
}
