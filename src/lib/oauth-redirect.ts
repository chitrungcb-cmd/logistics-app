const LOCAL_HOSTS = new Set(["0.0.0.0", "127.0.0.1", "localhost", "::", "[::]"]);

function usablePublicOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || LOCAL_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Hostinger can expose the Node listener as https://0.0.0.0 while forwarding the real public host.
 * OAuth must use the externally reachable origin for both authorization and token exchange.
 */
export function resolveGoogleRedirectUri(input: {
  configuredAppUrl?: string;
  configuredRedirectUri?: string;
  requestUrl: string;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
  host?: string | null;
}) {
  const configuredRedirect = usablePublicOrigin(input.configuredRedirectUri);
  if (configuredRedirect) {
    return new URL("/api/gmail/callback", configuredRedirect).toString();
  }

  const configuredApp = usablePublicOrigin(input.configuredAppUrl);
  if (configuredApp) {
    return new URL("/api/gmail/callback", configuredApp).toString();
  }

  const forwardedHost = input.forwardedHost?.split(",", 1)[0]?.trim() || input.host?.trim();
  const forwardedProto = input.forwardedProto?.split(",", 1)[0]?.trim() || "https";
  const forwardedOrigin = usablePublicOrigin(
    forwardedHost ? `${forwardedProto}://${forwardedHost}` : null
  );
  if (forwardedOrigin) {
    return new URL("/api/gmail/callback", forwardedOrigin).toString();
  }

  return new URL("/api/gmail/callback", input.requestUrl).toString();
}
