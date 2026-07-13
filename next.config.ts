import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
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
