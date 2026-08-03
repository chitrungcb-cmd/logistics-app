import { describe, expect, it } from "vitest";
import {
  gmailRetryAfterSeconds,
  isExpiredGmailTokenError,
  isGmailRateLimitError,
} from "@/lib/gmail-errors";

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

  it("recognizes Gmail's temporary user rate limit", () => {
    const error = new Error(
      "User-rate limit exceeded. Retry after 2026-08-03T01:29:45.819Z"
    );
    expect(isGmailRateLimitError(error)).toBe(true);
    expect(
      gmailRetryAfterSeconds(error, Date.parse("2026-08-03T01:14:45.819Z"))
    ).toBe(900);
  });

  it("recognizes the structured userRateLimitExceeded response", () => {
    expect(
      isGmailRateLimitError({
        response: {
          status: 403,
          data: { error: { errors: [{ reason: "userRateLimitExceeded" }] } },
        },
      })
    ).toBe(true);
  });
});
