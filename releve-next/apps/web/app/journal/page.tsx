import Link from "next/link";
import { redirect } from "next/navigation";
import { candidates as matchCandidates, Direction, IdeaStatus, mine } from "@releve/core";
import { currentUser, openStore } from "./data";
import { activeScope, getWatchlist } from "../settings/data";
import AddIdeaForm from "./AddIdeaForm";
import ImportPanel from "./ImportPanel";
import OrphanRow from "./OrphanRow";

const STATUS_LABEL: Record<string, string> = {
  [IdeaStatus.DRAFT]: "brouillon",
  [IdeaStatus.ARMED]: "armée",
  [IdeaStatus.RUNNING]: "en cours",
  [IdeaStatus.CLOSED]: "clôturée",
  [IdeaStatus.REVIEWED]: "revue",
  [IdeaStatus.ABANDONED]: "abandonnée",
};

export default async function JournalPage() {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const store = await openStore(supabase, user.id);
  const loaded = store.load();
  const { ideas } = loaded;
  const { activeUid, accountUids } = await activeScope(supabase, user.id);
  // Symboles proposés : watchlist ∪ tout ce qui a été tradé (le broker fait foi).
  const watchlist = await getWatchlist(supabase, user.id);
  const knownSymbols = [
    ...new Set([...watchlist, ...[...loaded.positions.values()].map((p) => p.symbol)]),
  ].sort();
  // Cloisonnement par compte actif (0/1 compte ⇒ tout visible).
  const list = [...ideas.values()]
    .filter((i) => mine(i, activeUid, accountUids))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  const allIdeas = list;
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
      candidates: matchCandidates(p, allIdeas).map((c) => ({
        ideaId: c.idea.id,
        label: c.idea.label || c.idea.display_name,
        reason: c.reason,
        kind: c.kind,
      })),
    }));

  return (
    <main className="wrap">
      <header className="between" style={{ marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0 }}>
            Relev<span style={{ color: "var(--accent)" }}>é</span>{" "}
            <span className="muted" style={{ fontSize: ".9rem", fontWeight: 400 }}>
              · journal
            </span>
          </h1>
          <div className="muted" style={{ fontSize: ".85rem" }}>{user.email}</div>
        </div>
        <nav className="row" style={{ gap: 14 }}>
          <Link href="/dashboard" className="muted">Tableau de bord</Link>
          <Link href="/campaigns" className="muted">Thèses</Link>
          <Link href="/settings" className="muted">Réglages</Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="ghost">Se déconnecter</button>
          </form>
        </nav>
      </header>

      <ImportPanel />

      <AddIdeaForm symbols={knownSymbols} />

      {orphans.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: "1rem" }} className="muted">
            Trades importés à rapparier ({orphans.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {orphans.map((p) => (
              <OrphanRow key={p.uid} {...p} />
            ))}
          </div>
        </section>
      )}

      {list.length === 0 ? (
        <div className="card muted">Aucune idée pour l'instant. Écris la première ci-dessus.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map((i) => {
            const dir = i.thesis?.direction === Direction.SELL ? "Vente" : "Achat";
            const executed = i.is_executed;
            const pnl = executed ? i.pnl_net : null;
            const pnlPos = pnl ? pnl.gt(0) : false;
            return (
              <Link
                key={i.id}
                href={`/journal/${i.id}`}
                className="card between"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div>
                  <div className="row">
                    <strong>{i.symbol}</strong>
                    <span className="muted">{dir}</span>
                    <span className="chip">{STATUS_LABEL[i.status] ?? i.status}</span>
                    {i.off_plan && <span className="chip" style={{ color: "var(--loss)" }}>hors-plan</span>}
                  </div>
                  <div className="muted" style={{ fontSize: ".85rem", marginTop: 2 }}>
                    {i.label || i.display_name} ·{" "}
                    {i.created_at.toISOString().slice(0, 10)}
                  </div>
                </div>
                {pnl && (
                  <div
                    style={{
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      color: pnlPos ? "var(--gain)" : "var(--loss)",
                    }}
                  >
                    {pnlPos ? "+" : ""}
                    {pnl.toFixed(2)}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
