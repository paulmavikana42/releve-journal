"use client";

// Erreur de dernier recours (échec dans le layout racine lui-même) : doit fournir
// son propre <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, background: "#0B1220", color: "#E9EFF7", fontFamily: "system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 440, textAlign: "center" }}>
            <h1 style={{ fontSize: 26, margin: 0 }}>Relevé est momentanément indisponible.</h1>
            <p style={{ color: "#93A4BD", fontSize: 15, lineHeight: 1.6, margin: "14px 0 24px" }}>
              Recharge la page. Ton journal n&apos;est pas affecté.
            </p>
            <button
              onClick={() => reset()}
              style={{ background: "#F5A83C", color: "#0B1220", border: 0, borderRadius: 8, padding: "13px 22px", fontWeight: 700, fontSize: 14.5, cursor: "pointer" }}
            >
              Recharger
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
