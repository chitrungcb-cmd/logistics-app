import { describe, expect, it } from "vitest";
import { isExpiredGmailTokenError } from "@/lib/gmail-errors";

describe("Gmail token error detection", () => {
  it("recognizes Google's invalid_grant response", () => {
    expect(
      isExpiredGmailTokenError({
        response: {
          data: {
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          },
        },
      })
    ).toBe(true);
  });

  it("does not classify temporary Gmail failures as an expired token", () => {
    expect(isExpiredGmailTokenError(new Error("socket timeout"))).toBe(false);
  });
});
