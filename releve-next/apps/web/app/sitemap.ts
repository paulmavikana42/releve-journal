import type { MetadataRoute } from "next";

const BASE = "https://releve-journal.vercel.app";

// Sitemap des pages marketing publiques (les routes de l'app sont privées).
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: { path: string; priority: number }[] = [
    { path: "/", priority: 1.0 },
    { path: "/methode", priority: 0.9 },
    { path: "/fonctionnalites", priority: 0.9 },
    { path: "/tarifs", priority: 0.8 },
    { path: "/a-propos", priority: 0.6 },
    { path: "/login", priority: 0.5 },
    { path: "/mentions-legales", priority: 0.2 },
    { path: "/cgu-cgv", priority: 0.2 },
    { path: "/confidentialite", priority: 0.2 },
    { path: "/remboursement", priority: 0.2 },
  ];
  return pages.map((p) => ({
    url: `${BASE}${p.path}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: p.priority,
  }));
}
