import { describe, expect, it } from "vitest";
import { resolveGoogleRedirectUri } from "@/lib/oauth-redirect";

describe("Google OAuth redirect URI", () => {
  it("uses the configured public application origin", () => {
    expect(
      resolveGoogleRedirectUri({
        configuredAppUrl: "https://nqlogistics.click",
        configuredRedirectUri: "https://nqlogistics.click/api/gmail/callback",
        requestUrl: "https://0.0.0.0/api/gmail/auth",
      })
    ).toBe("https://nqlogistics.click/api/gmail/callback");
  });

  it("replaces an internal listener URL with Hostinger's forwarded public host", () => {
    expect(
      resolveGoogleRedirectUri({
        configuredAppUrl: "https://0.0.0.0",
        configuredRedirectUri: "https://0.0.0.0/api/gmail/callback",
        requestUrl: "https://0.0.0.0/api/gmail/auth",
        forwardedHost: "nqlogistics.click",
        forwardedProto: "https",
      })
    ).toBe("https://nqlogistics.click/api/gmail/callback");
  });

  it("uses localhost over HTTP when the development listener is 0.0.0.0", () => {
    expect(
      resolveGoogleRedirectUri({
        requestUrl: "https://0.0.0.0:3000/api/gmail/auth",
      })
    ).toBe("http://localhost:3000/api/gmail/callback");
  });

  it("accepts an explicitly configured localhost development URL", () => {
    expect(
      resolveGoogleRedirectUri({
        configuredAppUrl: "http://localhost:3000",
        requestUrl: "https://0.0.0.0:3000/api/gmail/auth",
      })
    ).toBe("http://localhost:3000/api/gmail/callback");
  });
});
