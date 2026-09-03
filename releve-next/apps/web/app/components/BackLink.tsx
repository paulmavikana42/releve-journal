"use client";

import { useRouter } from "next/navigation";

// Bouton « Retour » qui ramène EXACTEMENT d'où l'on vient (page + position de
// défilement), comme le retour de Streamlit qui restaure l'ancre. Repli sur un
// href si l'historique est vide (accès direct par URL).
export default function BackLink({ fallback, children }: { fallback: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="muted"
      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: "var(--muted)" }}
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
    >
      {children}
    </button>
  );
}
