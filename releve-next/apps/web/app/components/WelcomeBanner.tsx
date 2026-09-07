"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "releve_guide_seen";

/**
 * Bannière de bienvenue pour un compte vierge : invite au guide. Rendue seulement
 * quand le tableau de bord est vide (côté serveur), refermable, et le choix est
 * mémorisé par navigateur (localStorage) — on ne renag pas une fois écartée.
 */
export default function WelcomeBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* navigation privée : on masque quand même pour cette session */
    }
    setShow(false);
  };

  return (
    <div className="card welcome" style={{ borderColor: "var(--accent)", marginBottom: 18 }}>
      <button className="welcome-x" onClick={dismiss} aria-label="Masquer">✕</button>
      <div className="eyebrow" style={{ color: "var(--accent)" }}>bienvenue dans Relevé</div>
      <div style={{ fontWeight: 600, fontSize: "1.05rem", margin: "4px 0 6px" }}>
        Ton journal est vierge — c&apos;est normal, on démarre ensemble.
      </div>
      <div className="note" style={{ marginBottom: 12, maxWidth: 560 }}>
        Relevé n&apos;est pas un tableur : il confronte l&apos;idée que tu écris <b>avant</b> ton trade à ce
        que le marché a fait. Deux minutes pour comprendre le cycle et écrire ta première idée.
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Link href="/guide" className="primary" style={{ textDecoration: "none" }}>Voir le guide (2 min)</Link>
        <Link href="/settings" className="ghost">Régler mon compte</Link>
        <button className="ghost" onClick={dismiss}>Plus tard</button>
      </div>
    </div>
  );
}
