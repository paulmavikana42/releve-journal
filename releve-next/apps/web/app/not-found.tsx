import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page introuvable — Relevé" };

// 404 de marque : sobre, sombre, une seule sortie claire.
export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#0B1220",
        color: "#E9EFF7",
        fontFamily: "'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif",
      }}
    >
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 11,
            background: "#F5A83C",
            color: "#0B1220",
            fontWeight: 700,
            fontSize: 24,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 22,
          }}
        >
          R
        </div>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, letterSpacing: ".18em", color: "#93A4BD", textTransform: "uppercase" }}>
          Erreur 404
        </div>
        <h1 style={{ fontSize: 30, lineHeight: 1.15, margin: "12px 0 0", letterSpacing: "-.02em" }}>
          Cette page n&apos;existe pas.
        </h1>
        <p style={{ color: "#93A4BD", fontSize: 15, lineHeight: 1.6, margin: "14px 0 26px" }}>
          Le lien est peut-être obsolète, ou la page a été déplacée. Reviens en terrain connu.
        </p>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            background: "#F5A83C",
            color: "#0B1220",
            borderRadius: 8,
            padding: "13px 22px",
            fontWeight: 700,
            fontSize: 14.5,
            textDecoration: "none",
          }}
        >
          Retour à l&apos;accueil <span>→</span>
        </Link>
      </div>
    </main>
  );
}
