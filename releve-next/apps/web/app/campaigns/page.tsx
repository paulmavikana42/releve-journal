import Link from "next/link";
import { redirect } from "next/navigation";
import { Decimal } from "@releve/core";
import { loadCampaigns } from "./data";
import { abandonCampaign, attachIdea, createCampaign, detachIdea } from "./actions";
import { addCapture, removeCapture } from "../journal/actions";
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
  const { campaigns, unattached, book, captureUrls } = view;

  return (
    <main className="wrap">
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Thèses macro</h1>
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

                {/* Captures de la thèse */}
                <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                  {c.captures.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8, marginBottom: 8 }}>
                      {c.captures.map((cap) => (
                        <div key={cap.id}>
                          {captureUrls.get(cap.id) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={captureUrls.get(cap.id)} alt={cap.caption || cap.original_name} style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)" }} />
                          ) : (
                            <div className="muted" style={{ fontSize: ".8rem" }}>image indisponible</div>
                          )}
                          <div className="between" style={{ marginTop: 4 }}>
                            <span className="muted" style={{ fontSize: ".75rem" }}>{cap.caption || cap.kind}</span>
                            <form action={removeCapture}>
                              <input type="hidden" name="attachment_id" value={cap.id} />
                              <input type="hidden" name="owner_id" value={c.id} />
                              <input type="hidden" name="owner_type" value="campaign" />
                              <SubmitButton className="ghost" pendingLabel="…">Retirer</SubmitButton>
                            </form>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <form action={addCapture} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input type="hidden" name="owner_type" value="campaign" />
                    <input type="hidden" name="owner_id" value={c.id} />
                    <input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif" required />
                    <input name="caption" placeholder="légende (facultatif)" style={{ flex: 1, minWidth: 140 }} />
                    <SubmitButton className="ghost" pendingLabel="Envoi…">Joindre une capture</SubmitButton>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
