import { describe, expect, it } from "vitest";
import { validateProductionEnvironment } from "../scripts/lib/production-env.mjs";

const valid = {
  DATABASE_URL: "postgresql://user:pass@db.example/postgres?sslmode=require",
  DIRECT_URL: "postgresql://user:pass@db.example/postgres?sslmode=require",
  AUTH_SECRET: "a".repeat(48),
  TOKEN_ENCRYPTION_KEY: "b".repeat(48),
  INITIAL_SETUP_SECRET: "c".repeat(48),
  APP_URL: "https://logistics.example",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REDIRECT_URI: "https://logistics.example/api/gmail/callback",
  NQ_TAX_CODE: "0123456789",
  R2_ACCOUNT_ID: "a".repeat(32),
  R2_ACCESS_KEY_ID: "r2-access-key",
  R2_SECRET_ACCESS_KEY: "r2-secret-key",
  R2_BUCKET_NAME: "nq-logistics-documents",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "d".repeat(48),
  SUPABASE_STORAGE_BUCKET: "logistics-attachments",
  CRON_SECRET: "e".repeat(48),
};

describe("production environment", () => {
  it("accepts a complete safe configuration", () => {
    expect(validateProductionEnvironment(valid)).toEqual([]);
  });

  it("rejects reused secrets and non-HTTPS origins", () => {
    const issues = validateProductionEnvironment({
      ...valid,
      TOKEN_ENCRYPTION_KEY: valid.AUTH_SECRET,
      APP_URL: "http://logistics.example",
    });
    expect(issues.some((issue) => issue.includes("phải khác AUTH_SECRET"))).toBe(true);
    expect(issues.some((issue) => issue.includes("APP_URL"))).toBe(true);
  });

  it("allows Supabase Storage fallback to be removed after the R2 migration", () => {
    const r2Only = { ...valid };
    delete r2Only.SUPABASE_URL;
    delete r2Only.SUPABASE_SERVICE_ROLE_KEY;
    delete r2Only.SUPABASE_STORAGE_BUCKET;
    expect(validateProductionEnvironment(r2Only)).toEqual([]);
  });

  it("reports every missing required production value without printing secret contents", () => {
    const issues = validateProductionEnvironment({});
    expect(issues.length).toBeGreaterThan(10);
    expect(issues.join(" ")).not.toContain(valid.AUTH_SECRET);
  });
});
