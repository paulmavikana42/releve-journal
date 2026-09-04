"use client";

import { useMemo, useState } from "react";
import IdeaMenu from "../components/IdeaMenu";

export type Row = {
  id: string;
  symbol: string;
  tags: { label: string; cls: string }[];
  sens: string; // "long" | "short" | "?"
  sensCls: string;
  statusLabel: string;
  statusCls: string;
  entree: string;
  quadLabel: string;
  quadCls: string;
  quadGlyph: string;
  res: string;
  resTone: string; // "gain" | "loss" | ""
  canModify: boolean;
  isArmed: boolean;
  bucket: string; // "running" | "armed" | "closed" | "review" | "abandoned"
  search: string;
};

const COLS = "1.7fr .8fr .95fr .95fr 1fr .85fr .5fr";
const FILTRES = ["Tous", "En cours", "Armées", "Clôturés", "À relire"];

export default function JournalList({ rows, toReview }: { rows: Row[]; toReview: number }) {
  const [q, setQ] = useState("");
  const [filtre, setFiltre] = useState("Tous");

  const vus = useMemo(() => {
    let out = rows;
    if (filtre === "En cours") out = out.filter((r) => r.bucket === "running");
    else if (filtre === "Armées") out = out.filter((r) => r.bucket === "armed");
    else if (filtre === "Clôturés") out = out.filter((r) => r.bucket === "closed" || r.bucket === "review");
    else if (filtre === "À relire") out = out.filter((r) => r.bucket === "review");
    const mot = q.trim().toLowerCase();
    if (mot) out = out.filter((r) => r.search.includes(mot));
    return out;
  }, [rows, q, filtre]);

  return (
    <div>
      <div className="row" style={{ gap: 10, marginBottom: 10 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher — un symbole, un tag, une thèse…"
          style={{ flex: 1 }}
        />
        <select value={filtre} onChange={(e) => setFiltre(e.target.value)} style={{ minWidth: 140 }}>
          {FILTRES.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {toReview > 0 && (
        <div className="note" style={{ margin: "8px 0" }}>
          <span className="chip sig" style={{ marginRight: 8 }}>{toReview} review(s) à faire</span>
          Pas de blocage. Juste un compteur qui ne descend que si tu le fais.
        </div>
      )}

      {/* en-tête de colonnes (aligné sur les tuiles, masqué en mobile) */}
      <div className="journal-head" style={{ padding: "0 16px 6px" }}>
        {["symbole", "sens", "statut", "entrée", "décision", "résultat", ""].map((h, k) => (
          <div key={k} className="eyebrow" style={{ margin: 0, textAlign: k === 3 || k === 5 ? "right" : "left" }}>{h}</div>
        ))}
      </div>

      {vus.length === 0 ? (
        <div className="note" style={{ padding: "14px 4px" }}>Aucune idée ne correspond.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {vus.map((r) => (
            <div key={r.id} className="card journal-row" style={{ padding: "12px 16px" }}>
              <div className="jr-sym">
                <b>{r.symbol}</b>
                {r.tags.length > 0 && (
                  <span className="chips" style={{ display: "inline-flex", marginLeft: 8, verticalAlign: "middle" }}>
                    {r.tags.map((t, i) => (
                      <span key={i} className={`chip ${t.cls}`}>{t.label}</span>
                    ))}
                  </span>
                )}
              </div>
              <div className="jr-sens"><span className={`chip ${r.sensCls}`}>{r.sens}</span></div>
              <div className="jr-statut"><span className={`chip ${r.statusCls}`}>{r.statusLabel}</span></div>
              <div className="jr-entree num" style={{ textAlign: "right" }}>{r.entree}</div>
              <div className="jr-dec"><span className={`chip ${r.quadCls}`}>{r.quadGlyph} {r.quadLabel}</span></div>
              <div className={`jr-res num ${r.resTone ? "txt-" + r.resTone : "muted"}`} style={{ textAlign: "right", whiteSpace: "nowrap" }}>{r.res}</div>
              <div className="jr-menu" style={{ textAlign: "right" }}>
                <IdeaMenu id={r.id} canModify={r.canModify} isArmed={r.isArmed} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
