"use client";

import { useRef, useState } from "react";
import { addIdea } from "./actions";
import BlockEditor from "../components/BlockEditor";
import { initBlocks } from "@/lib/blocks";

// Auto-grow local (textarea qui descend au lieu de s'étendre).
function grow(e: React.FormEvent<HTMLTextAreaElement>) {
  const el = e.currentTarget;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

// Écriture d'une idée en DEUX bulles (comme les bulles du tableau de bord) :
//  · « Infos du trade » : tout le structuré (instrument, sens, entrée, stop,
//    n° ticket, TP, R voulu, conviction, thème, invalidation, thèse liée)
//  · « Écriture » : ce qui fait entrer en position, en Notion (mêmes blocs que la thèse)
// Un SEUL <form> : les deux bulles restent montées (masquées via hidden) pour
// que tous les champs soient soumis ensemble.
export default function WriteIdeaForm({
  symbols,
  campaigns,
}: {
  symbols: string[];
  campaigns: { id: string; name: string }[];
}) {
  const [tab, setTab] = useState<"infos" | "ecriture">("infos");
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        if (pending) return;
        setPending(true);
        try {
          await addIdea(fd);
        } finally {
          setPending(false);
        }
      }}
      className="card"
    >
      {/* les deux bulles */}
      <div className="row" style={{ gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        <button type="button" className={`pill ${tab === "infos" ? "on" : ""}`} onClick={() => setTab("infos")}>
          Infos du trade
        </button>
        <button type="button" className={`pill ${tab === "ecriture" ? "on" : ""}`} onClick={() => setTab("ecriture")}>
          Écriture
        </button>
      </div>

      {/* Bulle 1 — infos du trade (compacte) */}
      <div hidden={tab !== "infos"} style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr .8fr .8fr", gap: 12 }}>
          <div>
            <label>Instrument</label>
            <select name="instrument" required defaultValue="" style={{ width: "100%" }}>
              <option value="" disabled>Choisir…</option>
              {symbols.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Sens</label>
            <select name="direction" defaultValue="buy" style={{ width: "100%" }}>
              <option value="buy">Achat</option>
              <option value="sell">Vente</option>
            </select>
          </div>
          <div>
            <label>Conviction (1-5)</label>
            <input name="conviction" inputMode="numeric" defaultValue="3" style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
          <div>
            <label>Entrée visée</label>
            <input name="entry" inputMode="decimal" placeholder="20100" style={{ width: "100%" }} />
          </div>
          <div>
            <label>Stop initial</label>
            <input name="stop" inputMode="decimal" placeholder="20250" style={{ width: "100%" }} />
          </div>
          <div>
            <label>R voulu (%)</label>
            <input name="risk_pct" inputMode="decimal" placeholder="0.5" style={{ width: "100%" }} />
          </div>
          <div>
            <label>TP (séparés par espace)</label>
            <input name="targets" placeholder="19800 19500" style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label>Thème macro</label>
            <input name="macro_theme" placeholder="Fed / taux US, risk-off…" style={{ width: "100%" }} />
          </div>
          <div>
            <label>Catalyseur attendu</label>
            <input name="catalyst" placeholder="CPI US du 15/07" style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label>Setup</label>
            <input name="setup" placeholder="Cassure de structure" style={{ width: "100%" }} />
          </div>
          <div>
            <label>Unité de temps</label>
            <input name="timeframe" placeholder="H4" style={{ width: "100%" }} />
          </div>
        </div>

        <div>
          <label>Invalidation (ce qui tue l&apos;idée, même sans toucher le stop)</label>
          <textarea name="thesis_kill_switch" rows={1} onInput={grow} placeholder="Un CPI au-dessus du consensus, un pivot BoJ…" style={{ width: "100%", minHeight: 40, resize: "none", overflow: "hidden", lineHeight: 1.5 }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label>N° de ticket (dès que tu es entré)</label>
            <input name="ticket" placeholder="celui de ton terminal" style={{ width: "100%" }} />
          </div>
          <div>
            <label>Rattacher à une thèse macro</label>
            <select name="campaign" defaultValue="none" style={{ width: "100%" }}>
              <option value="none">— aucune —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label>Libellé (facultatif — sinon généré)</label>
          <textarea name="label" rows={1} onInput={grow} placeholder="Libellé (ex. Short NDX100 — CPI)" style={{ width: "100%", minHeight: 40, resize: "none", overflow: "hidden", lineHeight: 1.5 }} />
        </div>
      </div>

      {/* Bulle 2 — écriture Notion */}
      <div hidden={tab !== "ecriture"} style={{ display: "grid", gap: 8 }}>
        <label>Ce qui te fait entrer en position — écris, ajoute des visuels au fil</label>
        <BlockEditor initial={initBlocks([], "", [])} />
      </div>

      <div className="row" style={{ gap: 10, marginTop: 18 }}>
        <button type="submit" className="primary" disabled={pending}>
          {pending ? "Écriture…" : "Armer l'idée"}
        </button>
        <span className="note">Le stop initial est le seul champ indispensable au calcul du R.</span>
      </div>
    </form>
  );
}
