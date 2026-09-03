"use client";

import { useState } from "react";

type Cell = { d: number; klass: string; montant: string | null } | null;

const JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

/**
 * Le calendrier du mois. En desktop, chaque jour de clôture montre son montant
 * (fidèle à Streamlit). En mobile, les cases sont UNIFORMES (jour + couleur, sans
 * montant) : taper une case coloriée la déploie et révèle le montant — une seule
 * à la fois. La logique de couleur/format est calculée côté serveur ; ici on ne
 * gère que la sélection.
 */
export default function CalendarGrid({ cells }: { cells: Cell[] }) {
  const [sel, setSel] = useState<number | null>(null);

  return (
    <div className="cal">
      {JOURS.map((j) => (
        <div key={j} className="cal-head">{j}</div>
      ))}
      {cells.map((cell, i) => {
        if (!cell) return <div key={i} className="cal-day vide" />;
        const clickable = cell.montant !== null;
        const classes = ["cal-day", cell.klass, clickable ? "clickable" : "", sel === i ? "sel" : ""]
          .filter(Boolean)
          .join(" ");
        return (
          <div
            key={i}
            className={classes}
            onClick={clickable ? () => setSel((s) => (s === i ? null : i)) : undefined}
          >
            <span className="num">{cell.d}</span>
            {cell.montant !== null && <span className="pnl">{cell.montant}</span>}
          </div>
        );
      })}
    </div>
  );
}
