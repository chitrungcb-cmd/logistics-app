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
});
