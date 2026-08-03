import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPrivateStorageConfigurationError,
  PrivateStorageError,
  isPrivateStorageRestrictedError,
  uploadPrivateObject,
} from "@/lib/private-storage";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("private storage quota errors", () => {
  it("recognizes Supabase's restricted-project response", () => {
    const error = new PrivateStorageError(
      402,
      JSON.stringify({
        message:
          "Service for this project is restricted due to the following violations: exceed_egress_quota.",
      })
    );
    expect(isPrivateStorageRestrictedError(error)).toBe(true);
  });

  it("does not classify an ordinary missing object as a quota outage", () => {
    expect(isPrivateStorageRestrictedError(new PrivateStorageError(404, "Not found"))).toBe(false);
  });

  it("never writes a new object to the legacy Supabase bucket", async () => {
    vi.stubEnv("SUPABASE_URL", "https://storage.example.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadPrivateObject("invoice.pdf", Buffer.from("pdf"))).rejects.toSatisfy(
      isPrivateStorageConfigurationError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the exact R2 variables that are missing", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "account123");

    await expect(uploadPrivateObject("invoice.pdf", Buffer.from("pdf"))).rejects.toMatchObject({
      name: "PrivateStorageConfigurationError",
      missingVariables: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"],
    });
  });
});
