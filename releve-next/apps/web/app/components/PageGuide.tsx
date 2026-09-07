"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Guide contextuel d'une page : un encart clair, refermable et mémorisé par page
 * (localStorage). Une fois fermé, il laisse une pastille « Guide de cette page »
 * pour le rouvrir — jamais perdu, jamais imposé. Contenu passé en props (titre,
 * intro, points), rendu identique partout pour la cohérence.
 */
export default function PageGuide({
  pageKey,
  title,
  intro,
  points,
}: {
  pageKey: string;
  title: string;
  intro: string;
  points: string[];
}) {
  const KEY = `releve_pageguide_${pageKey}`;
  // null = pas encore lu le localStorage (évite le flash) ; true/false ensuite.
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(KEY) !== "1");
    } catch {
      setOpen(true);
    }
  }, [KEY]);

  const setSeen = (v: boolean) => {
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* navigation privée */
    }
    setOpen(!v);
  };

  if (open === null) return null; // avant hydratation du choix mémorisé

  if (!open) {
    return (
      <button type="button" className="pageguide-reopen" onClick={() => setSeen(false)}>
        ❔ Guide de cette page
      </button>
    );
  }

  return (
    <div className="card pageguide">
      <button className="pageguide-x" onClick={() => setSeen(true)} aria-label="Fermer le guide">✕</button>
      <div className="eyebrow" style={{ color: "var(--accent)" }}>guide de cette page</div>
      <div style={{ fontWeight: 600, margin: "3px 0 6px" }}>{title}</div>
      <div className="note" style={{ marginBottom: points.length ? 10 : 0 }}>{intro}</div>
      {points.length > 0 && (
        <ul className="pageguide-list">
          {points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <Link href="/guide" className="ghost" style={{ fontSize: ".82rem", padding: "5px 10px" }}>
          Voir le guide complet
        </Link>
        <button type="button" className="ghost" style={{ fontSize: ".82rem", padding: "5px 10px" }} onClick={() => setSeen(true)}>
          J&apos;ai compris
        </button>
      </div>
    </div>
  );
}
