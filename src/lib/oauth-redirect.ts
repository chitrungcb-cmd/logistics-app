const LOCAL_HOSTS = new Set(["0.0.0.0", "127.0.0.1", "localhost", "::", "[::]"]);

function usableConfiguredOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const isLocal = LOCAL_HOSTS.has(url.hostname.toLowerCase());
    if (isLocal) {
      if (url.protocol !== "http:") return null;
      if (url.hostname !== "localhost") url.hostname = "localhost";
      return url.origin;
    }
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function usablePublicOrigin(value: string | null | undefined) {
  const origin = usableConfiguredOrigin(value);
  if (!origin) return null;
  const url = new URL(origin);
  return url.protocol === "https:" && !LOCAL_HOSTS.has(url.hostname.toLowerCase())
    ? origin
    : null;
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
  const configuredRedirect = usableConfiguredOrigin(input.configuredRedirectUri);
  if (configuredRedirect) {
    return new URL("/api/gmail/callback", configuredRedirect).toString();
  }

  const configuredApp = usableConfiguredOrigin(input.configuredAppUrl);
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

  const requestUrl = new URL(input.requestUrl);
  if (LOCAL_HOSTS.has(requestUrl.hostname.toLowerCase())) {
    requestUrl.protocol = "http:";
    requestUrl.hostname = "localhost";
  }
  return new URL("/api/gmail/callback", requestUrl).toString();
}
