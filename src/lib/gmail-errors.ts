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
