import { redirect } from "next/navigation";
import { candidates as matchCandidates, Direction, mine } from "@releve/core";
import { currentUser, openStore } from "../journal/data";
import { activeScope, getAccounts } from "../settings/data";
import ImportPanel from "../journal/ImportPanel";
import OrphanRow from "../journal/OrphanRow";
import ConfirmSubmit from "../components/ConfirmSubmit";
import PageGuide from "../components/PageGuide";
import { undoImportAction } from "./actions";

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
  const lastImport = store.undoableImports()[0] ?? null;
  const { activeUid, accountUids } = await activeScope(supabase, user.id);
  const list = [...store.load().ideas.values()].filter((i) => mine(i, activeUid, accountUids));

  // Une POSITION importée est taguée du n° de compte BROKER (ex. 81734056), pas de
  // l'uid interne. On mappe donc le n° broker vers l'uid du compte correspondant,
  // sinon un orphelin est attribué au compte par défaut et disparaît quand un AUTRE
  // compte (dont c'est pourtant le broker) est actif.
  const accounts = await getAccounts(supabase, user.id);
  const brokerToUid = new Map<string, string>();
  for (const a of accounts) if (a.account_id) brokerToUid.set(a.account_id, a.uid);
  const orphanVisible = (p: { account_id?: string }) =>
    accountUids.length <= 1 ||
    mine({ account_id: brokerToUid.get(p.account_id || "") ?? p.account_id }, activeUid, accountUids);

  const orphans = store
    .orphans()
    .filter(orphanVisible)
    // Par heure d'OUVERTURE croissante : le noyau (ouvert le premier) est en tête,
    // on le rattache d'abord, puis les tickets qui chevauchent deviennent des renforts.
    .sort((a, b) => a.open_time.getTime() - b.open_time.getTime())
    .map((p) => ({
      uid: p.uid,
      symbol: p.symbol,
      dirLabel: p.direction === Direction.SELL ? "Vente" : "Achat",
      ticket: p.position_id,
      opened: p.open_time.toISOString().slice(0, 10),
      closed: p.close_time.toISOString().slice(0, 10),
      pnl: p.pnl_net.toFixed(2),
      pnlPos: p.pnl_net.gt(0),
      defaultStop: p.stop_original ? p.stop_original.toString() : "",
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

      <PageGuide
        pageKey="import"
        title="Dépose ton export, rapproché par ticket"
        intro="Rapport HTML MT5 ou CSV (MT4/MT5). Un trade déjà déclaré est complété, jamais dupliqué — réimporter le même fichier n'ajoute rien."
        points={[
          "Les trades sans idée écrite avant apparaissent « à rapparier », en bas.",
          "Pour un renfort : saisis son stop propre et coche si le noyau était au breakeven.",
          "Trompé de fichier ? « Annuler le dernier import » — réversible et réimportable.",
        ]}
      />

      <div className="g-split">
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

      {lastImport && (lastImport.positions > 0 || lastImport.deals > 0) && (
        <section style={{ marginTop: 20 }}>
          <div className="card between" style={{ borderColor: "var(--rule)", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 2 }}>dernier import</div>
              <div className="note">
                {lastImport.positions} trade(s) et {lastImport.deals} solde(s) ajoutés.
                Tu t&apos;es trompé de fichier ? Tu peux annuler ce lot — le fichier reste réimportable ensuite.
              </div>
            </div>
            <ConfirmSubmit
              action={undoImportAction}
              hidden={{ importId: lastImport.import_id }}
              title="Annuler le dernier import ?"
              message={<>Les <b>{lastImport.positions} trade(s)</b> et <b>{lastImport.deals} solde(s)</b> de ce lot sont retirés (rien n&apos;est effacé du journal : c&apos;est réversible et réimportable).</>}
              confirmLabel="Oui, annuler l'import"
            >
              Annuler le dernier import
            </ConfirmSubmit>
          </div>
        </section>
      )}

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
