import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";

// Sent on every response. Conservative set that hardens common web attacks without a strict CSP
// (a nonce-based CSP for Next's inline scripts is a separate, carefully-tuned follow-up — an
// over-strict CSP would break the app, which conflicts with the "stable/smooth" goal).
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "manifest-src 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" }, // no MIME sniffing
  { key: "X-Frame-Options", value: "SAMEORIGIN" }, // clickjacking (same-origin preview iframe still allowed)
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // HSTS only in production (over HTTP/localhost it's ignored anyway; avoids pinning dev to HTTPS).
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Force inline rendering for previewable attachment types — without this, some browsers
        // fall back to downloading instead of rendering the PDF/image inline in the preview modal's
        // <iframe>/<img>, since the dev static file server sends no Content-Disposition by default.
        source: "/uploads/:path*",
        headers: [{ key: "Content-Disposition", value: "inline" }],
      },
    ];
  },
};

export default nextConfig;
