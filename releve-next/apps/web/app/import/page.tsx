import { redirect } from "next/navigation";
import { candidates as matchCandidates, Direction, mine } from "@releve/core";
import { currentUser, openStore } from "../journal/data";
import { activeScope } from "../settings/data";
import ImportPanel from "../journal/ImportPanel";
import OrphanRow from "../journal/OrphanRow";

// Étapes pour récupérer l'export depuis MetaTrader 5 (inspiré du step-by-step
// Streamlit) — un guide, pas un blocage.
const STEPS: [string, string][] = [
  [
    "Ouvre l'historique",
    "Dans MT5, en bas : « Boîte à outils » → onglet Historique. Choisis la période (au besoin, tout l'historique).",
  ],
  [
    "Clic droit → Rapport",
    "Fais un clic droit dans la zone → Rapport (ou « Report »). MT5 prépare le récapitulatif de tes opérations.",
  ],
  [
    "Enregistre en CSV ou HTML",
    "Sauvegarde le rapport en .html, ou exporte les opérations en .csv (MT4/MT5). Les deux fonctionnent.",
  ],
  [
    "Dépose-le ci-dessous",
    "Glisse le fichier dans le champ. Rapproché PAR NUMÉRO DE TICKET : un trade déjà ouvert est mis à jour, jamais dupliqué.",
  ],
];

export default async function ImportPage() {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const store = await openStore(supabase, user.id);
  store.load();
  const { activeUid, accountUids } = await activeScope(supabase, user.id);
  const list = [...store.load().ideas.values()].filter((i) => mine(i, activeUid, accountUids));

  const orphans = store
    .orphans()
    .filter((p) => mine(p, activeUid, accountUids))
    .sort((a, b) => b.close_time.getTime() - a.close_time.getTime())
    .map((p) => ({
      uid: p.uid,
      symbol: p.symbol,
      dirLabel: p.direction === Direction.SELL ? "Vente" : "Achat",
      ticket: p.position_id,
      opened: p.open_time.toISOString().slice(0, 10),
      closed: p.close_time.toISOString().slice(0, 10),
      pnl: p.pnl_net.toFixed(2),
      pnlPos: p.pnl_net.gt(0),
      candidates: matchCandidates(p, list).map((c) => ({
        ideaId: c.idea.id,
        label: c.idea.label || c.idea.display_name,
        reason: c.reason,
        kind: c.kind,
      })),
    }));

  return (
    <main className="wrap">
      <header style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>Importer un rapport</h1>
        <div className="subtitle">
          Dépose l&apos;export de ton terminal. Rapproché par numéro de ticket : un trade déjà ouvert est
          mis à jour, jamais dupliqué.
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr .9fr", gap: 18, alignItems: "start" }}>
        {/* Assistant pas-à-pas : récupérer l'export MT5 */}
        <div>
          <div className="eyebrow bar">récupérer ton export MT5</div>
          <div className="stepflow">
            {STEPS.map(([titre, texte], i) => (
              <div key={i} className="stepflow-row">
                <div className="stepflow-num">{i + 1}</div>
                <div>
                  <div className="eyebrow" style={{ margin: 0 }}>{titre}</div>
                  <div className="note" style={{ marginTop: 2 }}>{texte}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Dépôt + formats acceptés */}
        <div>
          <div className="eyebrow bar">le fichier</div>
          <ImportPanel />
          <div className="chips" style={{ marginTop: -8 }}>
            <span className="chip ok">✓ MetaTrader 4</span>
            <span className="chip ok">✓ MetaTrader 5</span>
            <span className="chip">CSV générique</span>
            <span className="chip">rapport HTML MT5</span>
          </div>
        </div>
      </div>

      {orphans.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <div className="eyebrow bar">trades importés à rapparier ({orphans.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {orphans.map((p) => (
              <OrphanRow key={p.uid} {...p} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
