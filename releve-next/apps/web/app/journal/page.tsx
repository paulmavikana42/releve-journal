import Link from "next/link";
import { redirect } from "next/navigation";
import {
  type Decimal,
  Direction,
  IdeaStatus,
  mine,
  Quadrant,
  SpecBook,
} from "@releve/core";
import { currentUser, openStore } from "./data";
import { activeScope, getWatchlist } from "../settings/data";
import WriteIdeaForm from "./WriteIdeaForm";
import JournalList, { type Row } from "./JournalList";
import PageGuide from "../components/PageGuide";

const QUAD: Record<string, [string, string, string]> = {
  [Quadrant.MASTERY]: ["Maîtrise", "ok", "✓"],
  [Quadrant.LUCK]: ["Chance", "bad", "⚠"],
  [Quadrant.ERROR]: ["Erreur", "bad", "✗"],
  [Quadrant.VARIANCE]: ["Aléa OK", "sig", "↺"],
  [Quadrant.PENDING]: ["en attente", "sig", "⧖"],
};

const VUES = [
  { key: "journal", label: "Le journal" },
  { key: "ecrire", label: "＋ Écrire une idée" },
];

function fmtPrice(x: Decimal | null | undefined): string {
  if (x == null) return "—";
  let s = x.toFixed(5);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s || "0";
}
function fmtR(x: Decimal | null): string {
  if (x === null) return "—";
  const n = x.toNumber();
  return (n < 0 ? "" : "+") + n.toFixed(2) + " R";
}

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const vue = sp.vue === "ecrire" ? "ecrire" : "journal";

  // events + réglages en parallèle (getWatchlist réutilise ensuite le cache réglages).
  const [store, { activeUid, accountUids }] = await Promise.all([
    openStore(supabase, user.id),
    activeScope(supabase, user.id),
  ]);
  const loaded = store.load();
  const { ideas } = loaded;
  const watchlist = await getWatchlist(supabase, user.id);
  const knownSymbols = [
    ...new Set([...watchlist, ...[...loaded.positions.values()].map((p) => p.symbol)]),
  ].sort();
  const book = new SpecBook([...loaded.positions.values()]);

  // Thèses macro vivantes pour le rattachement (facultatif) à l'écriture.
  const campaignsList = [...store.campaigns().values()]
    .filter((c) => !c.abandoned && !c.closed && mine(c, activeUid, accountUids))
    .map((c) => ({ id: c.id, name: c.display_name }));

  const list = [...ideas.values()]
    .filter((i) => mine(i, activeUid, accountUids))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

  const toReview = list.filter((i) => i.is_executed && !i.is_running && i.review === null).length;

  const rows: Row[] = list.map((i) => {
    const t = i.thesis;
    // tags (miroir de ui.chips)
    const tags: { label: string; cls: string }[] = [];
    if (i.off_plan) tags.push({ label: "hors-plan", cls: "warn" });
    if (i.review) {
      const s = i.review.discipline_score;
      tags.push({ label: `plan ${s}/5`, cls: s === 5 ? "ok" : s <= 3 ? "bad" : "" });
    } else if (i.is_executed && !i.is_running) {
      tags.push({ label: "review à faire", cls: "sig" });
    }
    if (i.adds.length) tags.push({ label: `${i.adds.length} add`, cls: "" });

    const sens = t ? (t.direction === Direction.SELL ? "short" : "long") : "?";
    const sensCls = t ? (t.direction === Direction.SELL ? "bad" : "ok") : "";

    // statut (miroir de ui.status_chip)
    let statusLabel = "armée", statusCls = "sig";
    if (i.is_running) { statusLabel = "● en cours"; statusCls = "acc"; }
    else if (i.status === IdeaStatus.ABANDONED) { statusLabel = "abandonnée"; statusCls = ""; }
    else if (i.is_executed) { statusLabel = "clôturé"; statusCls = ""; }

    const entree = i.open_trades[0]
      ? fmtPrice(i.open_trades[0].open_price)
      : i.initial_position
        ? fmtPrice(i.initial_position.open_price)
        : fmtPrice(t?.entry_planned ?? null);

    const [quadLabel, quadCls, quadGlyph] = QUAD[i.quadrant] ?? ["—", "", ""];

    let res = "—", resTone = "";
    if (i.is_running) {
      const fr = i.floating_r(book);
      res = fr !== null ? "flottant " + fmtR(fr) : "en cours";
      resTone = fr !== null ? "warn" : "";
    } else if (i.is_executed) {
      const r = i.r_multiple(book);
      res = fmtR(r);
      resTone = r ? (r.gt(0) ? "gain" : r.lt(0) ? "loss" : "") : "";
    }

    let bucket = "armed";
    if (i.is_running) bucket = "running";
    else if (i.status === IdeaStatus.ABANDONED) bucket = "abandoned";
    else if (i.is_executed && i.review === null) bucket = "review";
    else if (i.is_executed) bucket = "closed";

    const search = [i.symbol, i.label, i.display_name, t?.macro_theme, t?.catalyst, t?.setup, t?.macro_note]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return {
      id: i.id, symbol: i.symbol, tags, sens, sensCls, statusLabel, statusCls, entree,
      quadLabel, quadCls, quadGlyph, res, resTone,
      canModify: !(i.is_executed && !i.is_running && i.review !== null),
      isArmed: i.status === IdeaStatus.ARMED,
      bucket, search,
    };
  });

  return (
    <main className="wrap">
      <header style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>Journal</h1>
        <div className="subtitle">{list.length} idée(s)</div>
      </header>

      <PageGuide
        pageKey="journal"
        title="Écris l'idée AVANT d'entrer"
        intro="C'est le seul geste qui permet à Relevé de te contredire. Puis, dès que tu entres, déclare ton numéro de ticket."
        points={[
          "« ＋ Écrire une idée » : ta prédiction (sens, stop, conviction) et tes motivations.",
          "Statuts : armée → en cours → clôturé → revue.",
          "Une idée « armée » attend son ticket : clique « ↳ déclarer le ticket ».",
          "Filtre et recherche pour retrouver une idée, un tag ou une thèse.",
        ]}
      />

      {/* Onglets en bulles */}
      <div className="row" style={{ gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {VUES.map((v) => (
          <Link key={v.key} href={`/journal?vue=${v.key}`} className={`pill ${vue === v.key ? "on" : ""}`}>
            {v.label}
          </Link>
        ))}
      </div>

      {vue === "journal" && (
        list.length === 0 ? (
          <div className="card muted">Aucune idée pour l&apos;instant. Passe à « Écrire une idée ».</div>
        ) : (
          <JournalList rows={rows} toReview={toReview} />
        )
      )}

      {vue === "ecrire" && <WriteIdeaForm symbols={knownSymbols} campaigns={campaignsList} />}
    </main>
  );
}
