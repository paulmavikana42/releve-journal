"use client";

import { useState } from "react";

type MCell = { label: string; klass: string; montant: string | null };

/**
 * Le calendrier « tout l'historique » : une case = un mois (12 par année). Même
 * langage visuel que le calendrier journalier — desktop montre le montant, mobile
 * révèle le montant d'un mois coloré au tap (un seul à la fois). La logique de
 * couleur/format est calculée côté serveur ; ici on ne gère que la sélection.
 */
export default function MonthGrid({ cells }: { cells: MCell[] }) {
  const [sel, setSel] = useState<number | null>(null);

  return (
    <div className="calm">
      {cells.map((cell, i) => {
        const clickable = cell.montant !== null;
        const classes = ["calm-cell", cell.klass, clickable ? "clickable" : "", sel === i ? "sel" : ""]
          .filter(Boolean)
          .join(" ");
        return (
          <div
            key={i}
            className={classes}
            onClick={clickable ? () => setSel((s) => (s === i ? null : i)) : undefined}
          >
            <span className="num">{cell.label}</span>
            {cell.montant !== null && <span className="pnl">{cell.montant}</span>}
          </div>
        );
      })}
    </div>
  );
}
