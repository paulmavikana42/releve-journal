import Link from "next/link";
import { redirect } from "next/navigation";
import { Decimal } from "@releve/core";
import { loadCampaigns } from "./data";
import { abandonCampaign, attachIdea, createCampaign, detachIdea } from "./actions";
import SubmitButton from "../components/SubmitButton";

function rFmt(x: Decimal | null): string {
  if (x === null) return "—";
  return (x.gt(0) ? "+" : "") + x.toFixed(2) + " R";
}
function money(x: Decimal): string {
  return (x.gt(0) ? "+" : "") + x.toFixed(2) + " $";
}

export default async function CampaignsPage() {
  const view = await loadCampaigns();
  if (!view) redirect("/login");
  const { campaigns, unattached, book } = view;

  return (
    <main className="wrap">
      <header className="between" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Thèses macro</h1>
        <nav className="row" style={{ gap: 14 }}>
          <Link href="/journal" className="muted">Journal</Link>
          <Link href="/dashboard" className="muted">Tableau de bord</Link>
          <Link href="/settings" className="muted">Réglages</Link>
        </nav>
      </header>

      <p className="muted" style={{ marginTop: 0 }}>
        Une thèse macro regroupe plusieurs idées sur des instruments <em>différents</em> en UN seul
        pari (« dollar fort » joué en short EURUSD <em>et</em> long USDJPY). Son R = somme des R de
        ses jambes.
      </p>

      {/* Créer une thèse */}
      <form action={createCampaign} className="card" style={{ marginBottom: 20, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <div>
            <label>Nom de la thèse</label>
            <input name="name" placeholder="Dollar fort — Fed hawkish" required style={{ width: "100%" }} />
          </div>
          <div>
            <label>Conviction (1-5)</label>
            <input name="conviction" inputMode="numeric" placeholder="4" style={{ width: "100%" }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label>Thème macro</label>
            <input name="macro_theme" placeholder="Fed / taux US" style={{ width: "100%" }} />
          </div>
          <div>
            <label>Catalyseur</label>
            <input name="catalyst" placeholder="CPI plus chaud que prévu" style={{ width: "100%" }} />
          </div>
        </div>
        <div>
          <SubmitButton pendingLabel="Création…">Créer la thèse</SubmitButton>
        </div>
      </form>

      {campaigns.length === 0 ? (
        <div className="card muted">Aucune thèse macro. Crée-en une ci-dessus, puis rattache-lui des idées.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {campaigns.map((c) => {
            const legs = c.ideas;
            return (
              <div key={c.id} className="card">
                <div className="between">
                  <div>
                    <div className="row">
                      <strong style={{ fontSize: "1.05rem" }}>{c.name}</strong>
                      {c.conviction != null && <span className="chip">{c.conviction}/5</span>}
                    </div>
                    <div className="muted" style={{ fontSize: ".85rem", marginTop: 2 }}>
                      {[c.macro_theme, c.catalyst].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <form action={abandonCampaign}>
                    <input type="hidden" name="campaignId" value={c.id} />
                    <SubmitButton className="ghost" pendingLabel="…">Abandonner</SubmitButton>
                  </form>
                </div>

                {/* Agrégat */}
                <div className="row" style={{ gap: 16, marginTop: 10, flexWrap: "wrap" }}>
                  <span className="muted">Jambes exécutées : <strong style={{ color: "var(--ink)" }}>{c.executed_ideas.length}</strong></span>
                  <span className="muted">Instruments : <strong style={{ color: "var(--ink)" }}>{c.instruments.join(", ") || "—"}</strong></span>
                  <span className="muted">
                    P&L :{" "}
                    <strong style={{ color: c.pnl_net.gt(0) ? "var(--gain)" : "var(--loss)" }}>{money(c.pnl_net)}</strong>
                  </span>
                  <span className="muted">R total : <strong style={{ color: "var(--ink)" }}>{rFmt(c.r_total(book))}</strong></span>
                  <span className="muted">R pondéré : <strong style={{ color: "var(--ink)" }}>{rFmt(c.r_weighted(book))}</strong></span>
                </div>

                {/* Jambes rattachées */}
                {legs.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
                    {legs.map((i) => (
                      <div key={i.id} className="between" style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                        <div className="row">
                          <Link href={`/journal/${i.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                            <strong>{i.symbol}</strong>
                          </Link>
                          <span className="muted" style={{ fontSize: ".85rem" }}>{i.label || i.display_name}</span>
                        </div>
                        <div className="row" style={{ gap: 10 }}>
                          {i.is_executed && (
                            <span style={{ color: i.pnl_net.gt(0) ? "var(--gain)" : "var(--loss)", whiteSpace: "nowrap" }}>
                              {money(i.pnl_net)}
                            </span>
                          )}
                          <form action={detachIdea}>
                            <input type="hidden" name="ideaId" value={i.id} />
                            <SubmitButton className="ghost" pendingLabel="…">Détacher</SubmitButton>
                          </form>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Rattacher une idée */}
                {unattached.length > 0 && (
                  <form action={attachIdea} className="row" style={{ marginTop: 12, gap: 8 }}>
                    <input type="hidden" name="campaignId" value={c.id} />
                    <select name="ideaId" style={{ flex: 1 }}>
                      {unattached.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.symbol} — {i.label || i.display_name}
                        </option>
                      ))}
                    </select>
                    <SubmitButton className="ghost" pendingLabel="…">Rattacher une idée</SubmitButton>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
