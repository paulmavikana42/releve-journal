import type { MetadataRoute } from "next";

const BASE = "https://releve-journal.vercel.app";

// Robots : on laisse indexer le site marketing (servi en statique par le
// middleware), on interdit l'app privée et les routes techniques.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/journal", "/settings", "/import", "/campaigns", "/guide", "/auth/", "/complet", "/waitlist-ok"],
    },
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
