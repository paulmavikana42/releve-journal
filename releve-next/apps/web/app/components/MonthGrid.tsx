"use client";

import { useState } from "react";

type MCell = { label: string; klass: string; montant: string | null };

/**
 * Le calendrier « tout l'historique » : une case = un mois (12 par année). Même
 * langage visuel que le calendrier journalier — desktop montre le montant, mobile
 * ÉLARGIT toute la colonne verticale du mois tapé et révèle son montant sur une
 * ligne horizontale (un seul à la fois). En mobile la grille fait 4 colonnes.
 */
export default function MonthGrid({ cells }: { cells: MCell[] }) {
  const [sel, setSel] = useState<number | null>(null);
  // En mobile la grille fait 4 colonnes : la colonne d'une case = son index % 4.
  const selCol = sel === null ? null : sel % 4;

  return (
    <div className={`calm${selCol !== null ? ` sel-col-${selCol}` : ""}`}>
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
