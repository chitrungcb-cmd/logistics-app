import { afterEach, describe, expect, it, vi } from "vitest";
import {
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

  it("does not spend another egress request after Supabase returns 402", async () => {
    vi.stubEnv("SUPABASE_URL", "https://storage.example.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"message":"exceed_egress_quota"}', { status: 402 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadPrivateObject("invoice.pdf", Buffer.from("pdf"))).rejects.toSatisfy(
      isPrivateStorageRestrictedError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
