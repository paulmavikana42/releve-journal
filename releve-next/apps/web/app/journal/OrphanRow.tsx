"use client";

import { useState } from "react";
import { createOffPlan, linkPosition } from "./actions";
import { deleteOrphanAction } from "../import/actions";
import ConfirmSubmit from "../components/ConfirmSubmit";

export type Candidate = { ideaId: string; label: string; reason: string; kind: string };

export default function OrphanRow(props: {
  uid: string;
  symbol: string;
  dirLabel: string;
  ticket: string;
  opened: string;
  closed: string;
  pnl: string;
  pnlPos: boolean;
  defaultStop?: string;
  candidates: Candidate[];
}) {
  const { uid, symbol, dirLabel, ticket, opened, closed, pnl, pnlPos, defaultStop, candidates } = props;
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);

  const kindTag = (k: string) =>
    k === "add" ? " · renfort" : k === "fragment" ? " · fragment" : "";

  // Le candidat courant : s'il s'agit d'un RENFORT, on demande son stop propre et
  // si le noyau était au breakeven quand il s'est ouvert (décisions [H ter]/[H quater]).
  const isAdd = candidates[sel]?.kind === "add";

  return (
    <div className="card">
      <div className="between">
        <div>
          <div className="row">
            <strong>{symbol}</strong>
            <span className="muted">{dirLabel}</span>
            <span className="chip">#{ticket}</span>
          </div>
          <div className="muted" style={{ fontSize: ".85rem", marginTop: 2 }}>
            {opened} → {closed}
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span style={{ fontWeight: 600, whiteSpace: "nowrap", color: pnlPos ? "var(--gain)" : "var(--loss)" }}>
            {pnlPos ? "+" : ""}
            {pnl}
          </span>
          <ConfirmSubmit
            action={deleteOrphanAction}
            hidden={{ positionUid: uid }}
            className="pop-btn"
            title="Supprimer ce trade importé ?"
            message="Il disparaît de la liste. Mauvais fichier ? Réimporte le bon : ce trade réapparaîtra si le fichier le contient."
            confirmLabel="Oui, supprimer"
          >
            Supprimer
          </ConfirmSubmit>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {candidates.length > 0 ? (
          <form
            action={async (fd) => {
              if (busy) return;
              setBusy(true);
              try {
                await linkPosition(fd);
              } finally {
                setBusy(false);
              }
            }}
            style={{ display: "grid", gap: 10 }}
          >
            <input type="hidden" name="positionUid" value={uid} />
            <div className="row">
              <select
                name="ideaId"
                value={candidates[sel]?.ideaId}
                onChange={(e) => setSel(Math.max(0, candidates.findIndex((c) => c.ideaId === e.target.value)))}
                style={{ flex: 1, minWidth: 0 }}
              >
                {candidates.map((c) => (
                  <option key={c.ideaId} value={c.ideaId}>
                    {c.label} — {c.reason}
                    {kindTag(c.kind)}
                  </option>
                ))}
              </select>
              <button type="submit" className="primary" disabled={busy}>
                {busy ? "…" : "Rattacher"}
              </button>
            </div>

            {/* Renfort : son risque propre (jamais celui du noyau). */}
            {isAdd && (
              <div className="add-risk">
                <input type="hidden" name="is_add" value="1" />
                <div className="eyebrow" style={{ margin: 0 }}>ce ticket est un renfort</div>
                <div className="add-risk-fields">
                  <div>
                    <label>Stop réel de ce renfort<span className="help" data-tip="Un renforcement n'hérite jamais du stop du noyau : il peut être plus serré. Sans lui, le R de l'idée reste incalculable.">?</span></label>
                    <input name="add_stop" inputMode="decimal" defaultValue={defaultStop ?? ""} placeholder="ex. 1.0895" style={{ width: "100%" }} />
                  </div>
                  <label className="row add-be" style={{ gap: 8 }}>
                    <input type="checkbox" name="core_secured" />
                    <span>Le noyau était déjà au <b>breakeven</b> quand ce renfort s&apos;est ouvert</span>
                  </label>
                </div>
                <div className="note" style={{ marginTop: 2 }}>
                  Sans réponse, l&apos;exposition simultanée reste un <b>majorant</b> (elle montre pire que la réalité).
                </div>
              </div>
            )}
          </form>
        ) : (
          <form
            action={async (fd) => {
              if (busy) return;
              setBusy(true);
              try {
                await createOffPlan(fd);
              } finally {
                setBusy(false);
              }
            }}
            className="row"
          >
            <input type="hidden" name="positionUid" value={uid} />
            <span className="muted" style={{ flex: 1, fontSize: ".9rem" }}>
              Aucune idée candidate — ce trade n&apos;était pas écrit avant.
            </span>
            <button type="submit" className="ghost" disabled={busy}>
              {busy ? "…" : "Marquer hors-plan"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
