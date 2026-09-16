"use client";

import { useEffect } from "react";

// Frontière d'erreur de marque pour les routes de l'app (segment racine).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Trace côté client (visible dans la console + capté par l'observabilité).
    console.error("[releve] erreur de rendu:", error);
  }, [error]);

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
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, letterSpacing: ".18em", color: "#FF8A7C", textTransform: "uppercase" }}>
          Une erreur est survenue
        </div>
        <h1 style={{ fontSize: 28, lineHeight: 1.15, margin: "12px 0 0", letterSpacing: "-.02em" }}>
          Quelque chose a coincé de notre côté.
        </h1>
        <p style={{ color: "#93A4BD", fontSize: 15, lineHeight: 1.6, margin: "14px 0 26px" }}>
          Ton journal est intact — rien n&apos;a été perdu. Réessaie&nbsp;; si ça persiste, recharge la page.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => reset()}
            style={{ background: "#F5A83C", color: "#0B1220", border: 0, borderRadius: 8, padding: "13px 22px", fontWeight: 700, fontSize: 14.5, cursor: "pointer" }}
          >
            Réessayer
          </button>
          <a
            href="/dashboard"
            style={{ border: "1px solid #617289", color: "#E9EFF7", borderRadius: 8, padding: "12px 22px", fontSize: 14, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            Retour au tableau de bord
          </a>
        </div>
      </div>
    </main>
  );
}
