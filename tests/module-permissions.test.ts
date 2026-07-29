import { describe, expect, it } from "vitest";
import {
  ALL_APP_MODULES,
  getApiModules,
  getEffectiveModulePermissions,
  getRoleModules,
  hasModuleAccess,
  normalizeModulePermissions,
} from "@/lib/module-permissions";

describe("module permissions", () => {
  it("always grants administrators every module", () => {
    expect(getEffectiveModulePermissions({ role: "ADMIN", modulePermissions: [] })).toEqual(ALL_APP_MODULES);
    expect(hasModuleAccess({ role: "ADMIN", modulePermissions: [] }, "USERS")).toBe(true);
  });

  it("filters unknown permissions for non-admin users", () => {
    expect(normalizeModulePermissions(["SHIPMENTS", "UNKNOWN", 123], "FIELD_STAFF")).toEqual([
      "SHIPMENTS",
    ]);
  });

  it("allows field staff to use modules explicitly granted to their account", () => {
    expect(
      hasModuleAccess(
        { role: "FIELD_STAFF", modulePermissions: ["SHIPMENTS", "OTHER_EXPENSES"] },
        "OTHER_EXPENSES"
      )
    ).toBe(true);
    expect(
      hasModuleAccess(
        { role: "FIELD_STAFF", modulePermissions: ["SHIPMENTS"] },
        "OTHER_EXPENSES"
      )
    ).toBe(false);
  });

  it("grants accountants cost and report modules by default", () => {
    expect(getRoleModules("ACCOUNTANT")).toEqual(
      expect.arrayContaining(["COSTS", "REPORTS"])
    );
    expect(
      hasModuleAccess(
        { role: "ACCOUNTANT", modulePermissions: ["COSTS", "REPORTS"] },
        "COSTS"
      )
    ).toBe(true);
    expect(
      hasModuleAccess(
        { role: "ACCOUNTANT", modulePermissions: ["COSTS", "REPORTS"] },
        "REPORTS"
      )
    ).toBe(true);
  });

  it("maps sensitive APIs to their modules", () => {
    expect(getApiModules("/api/other-expenses/123", "DELETE")).toEqual(["OTHER_EXPENSES"]);
    expect(getApiModules("/api/users/123", "PATCH")).toEqual(["USERS"]);
    expect(getApiModules("/api/attachments/file/a", "GET")).toContain("SHIPMENTS");
    expect(getApiModules("/api/personal-account/abc", "PATCH")).toEqual(["PERSONAL_ACCOUNT"]);
    expect(getApiModules("/api/shipments/abc/finance-links", "GET")).toContain("COSTS");
    // Trang Tài khoản cá nhân cần danh sách người dùng cho ô "người phụ trách".
    expect(getApiModules("/api/users", "GET")).toContain("PERSONAL_ACCOUNT");
    expect(getApiModules("/api/users", "GET")).toContain("COSTS");
  });

  it("drops retired module permissions from legacy rows", () => {
    expect(normalizeModulePermissions(["SHIPMENTS", "DOCUMENTS"], "FIELD_STAFF")).toEqual([
      "SHIPMENTS",
    ]);
  });
});
