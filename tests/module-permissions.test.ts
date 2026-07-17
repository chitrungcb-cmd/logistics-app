import { describe, expect, it } from "vitest";
import {
  ALL_APP_MODULES,
  getApiModules,
  getEffectiveModulePermissions,
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

  it("maps sensitive APIs to their modules", () => {
    expect(getApiModules("/api/other-expenses/123", "DELETE")).toEqual(["OTHER_EXPENSES"]);
    expect(getApiModules("/api/users/123", "PATCH")).toEqual(["USERS"]);
    expect(getApiModules("/api/attachments/file/a", "GET")).toContain("DOCUMENTS");
  });
});
