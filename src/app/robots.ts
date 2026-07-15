import type { MetadataRoute } from "next";

/** Internal application: ask every standards-compliant crawler to stay out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
