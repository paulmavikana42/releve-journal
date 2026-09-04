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
  candidates: Candidate[];
}) {
  const { uid, symbol, dirLabel, ticket, opened, closed, pnl, pnlPos, candidates } = props;
  const [busy, setBusy] = useState(false);

  const kindTag = (k: string) =>
    k === "add" ? " · renfort" : k === "fragment" ? " · fragment" : "";

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
            className="row"
          >
            <input type="hidden" name="positionUid" value={uid} />
            <select name="ideaId" style={{ flex: 1 }}>
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
              Aucune idée candidate — ce trade n'était pas écrit avant.
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
