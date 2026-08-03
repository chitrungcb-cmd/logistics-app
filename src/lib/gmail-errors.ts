/** Google returns invalid_grant when the stored refresh token expired or was revoked. */
export function isExpiredGmailTokenError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    message?: unknown;
    response?: { data?: { error?: unknown; error_description?: unknown } };
  };
  const code = candidate.response?.data?.error;
  const description = candidate.response?.data?.error_description;
  return (
    code === "invalid_grant" ||
    (typeof description === "string" && /expired|revoked/i.test(description)) ||
    (typeof candidate.message === "string" && /invalid_grant/i.test(candidate.message))
  );
}

type GmailApiError = {
  code?: unknown;
  message?: unknown;
  response?: {
    status?: unknown;
    data?: {
      error?: unknown;
    };
  };
};

function gmailErrorText(error: GmailApiError) {
  const responseError = error.response?.data?.error;
  const responseMessage =
    responseError && typeof responseError === "object" && "message" in responseError
      ? (responseError as { message?: unknown }).message
      : null;
  const responseReasons =
    responseError && typeof responseError === "object" && "errors" in responseError
      ? (responseError as { errors?: Array<{ reason?: unknown; message?: unknown }> }).errors
      : null;

  return [
    error.message,
    responseMessage,
    ...(responseReasons ?? []).flatMap((item) => [item.reason, item.message]),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

/** Gmail reports both HTTP 429 and HTTP 403/userRateLimitExceeded for temporary quota pressure. */
export function isGmailRateLimitError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as GmailApiError;
  const status = candidate.response?.status ?? candidate.code;
  const text = gmailErrorText(candidate);
  return (
    Number(status) === 429 ||
    /user[-_ ]?rate\s*limit|userRateLimitExceeded|rateLimitExceeded|quota exceeded/i.test(text)
  );
}

/** Parses Google's human-readable retry timestamp, falling back to a conservative 15 minutes. */
export function gmailRetryAfterSeconds(error: unknown, now = Date.now()) {
  if (!isGmailRateLimitError(error)) return null;
  const text = gmailErrorText(error as GmailApiError);
  const match = text.match(/retry after\s+([^\s]+Z)/i);
  if (match) {
    const retryAt = Date.parse(match[1]);
    if (Number.isFinite(retryAt)) {
      return Math.max(60, Math.ceil((retryAt - now) / 1_000));
    }
  }
  return 15 * 60;
}
