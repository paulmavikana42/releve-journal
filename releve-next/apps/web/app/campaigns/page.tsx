import Link from "next/link";
import { redirect } from "next/navigation";
import { Decimal, Direction } from "@releve/core";
import { loadCampaigns } from "./data";
import { attachIdea, createCampaign, detachIdea } from "./actions";
import SubmitButton from "../components/SubmitButton";
import BlockEditor from "../components/BlockEditor";
import ConfirmSubmit from "../components/ConfirmSubmit";
import CampaignMenu from "../components/CampaignMenu";
import { initBlocks } from "@/lib/blocks";

function rFmt(x: Decimal | null): string {
  if (x === null) return "—";
  return (x.gt(0) ? "+" : "") + x.toFixed(2) + " R";
}
function money(x: Decimal): string {
  return (x.gt(0) ? "+" : "") + x.toFixed(2) + " $";
}

const VUES = [
  { key: "list", label: "Toutes les thèses macro" },
  { key: "ecrire", label: "＋ Écrire une thèse macro" },
];

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const view = await loadCampaigns();
  if (!view) redirect("/login");
  const { campaigns, unattached, book } = view;
  const sp = await searchParams;
  const vue = sp.vue === "ecrire" ? "ecrire" : "list";

  return (
    <main className="wrap">
      <header style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>Thèses macro</h1>
        <div className="subtitle">Une conviction jouée sur plusieurs instruments. Facultatif.</div>
      </header>

      {/* Deux sections en bulles */}
      <div className="row" style={{ gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {VUES.map((v) => (
          <Link key={v.key} href={`/campaigns?vue=${v.key}`} className={`pill ${vue === v.key ? "on" : ""}`}>
            {v.label}
          </Link>
        ))}
      </div>

      {vue === "ecrire" && (
        <form action={createCampaign} className="card" style={{ display: "grid", gap: 14 }}>
          <div className="note">
            Le niveau au-dessus de l&apos;idée. À utiliser seulement quand une même conviction se joue
            sur <b>plusieurs instruments</b>. Pour un trade sur un seul symbole, l&apos;idée suffit.
          </div>
          <div className="g2">
            <div>
              <label>Nom de la thèse</label>
              <input name="name" placeholder="Dollar fort — Fed hawkish" required style={{ width: "100%" }} />
            </div>
            <div>
              <label>Conviction (1-5)</label>
              <input name="conviction" inputMode="numeric" defaultValue="3" style={{ width: "100%" }} />
            </div>
          </div>
          <div className="g2">
            <div>
              <label>Thème macro</label>
              <input name="macro_theme" placeholder="Fed / taux US" style={{ width: "100%" }} />
            </div>
            <div>
              <label>Catalyseur attendu</label>
              <input name="catalyst" placeholder="FOMC du 30/07" style={{ width: "100%" }} />
            </div>
          </div>
          <div>
            <label>La thèse — écris, ajoute des visuels au fil</label>
            <BlockEditor initial={initBlocks([], "", [])} />
          </div>
          <div>
            <label>Ce qui tue la thèse</label>
            <input name="kill_switch" placeholder="Un pivot dovish, un NFP qui s'effondre…" style={{ width: "100%" }} />
          </div>
          <div>
            <SubmitButton pendingLabel="Création…">Créer la thèse macro</SubmitButton>
          </div>
        </form>
      )}

      {vue === "list" && (
        campaigns.length === 0 ? (
          <div className="card muted">
            Aucune thèse macro. Elles sont facultatives — à créer quand une même conviction se joue sur
            plusieurs instruments. Passe à « Écrire une thèse macro ».
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {campaigns.map((c) => {
              const executed = c.executed_ideas;
              const rTot = executed.length ? c.r_total(book) : null;
              const rW = executed.length ? c.r_weighted(book) : null;
              const legs = [...c.ideas].sort((a, b) => (a.opened_at?.getTime() ?? 0) - (b.opened_at?.getTime() ?? 0));
              const canModify = !c.closed;
              return (
                <div key={c.id} className="card">
                  {/* en-tête : résumé à gauche · conviction + 3-points + abandon à droite */}
                  <div className="between" style={{ alignItems: "flex-start", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="eyebrow" style={{ marginBottom: 2 }}>{c.macro_theme || "thèse macro"}</div>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <strong style={{ fontSize: "1.05rem" }}>{c.display_name}</strong>
                        {c.conviction != null && <span className="chip">conv {c.conviction}/5</span>}
                      </div>
                      <div className="note mono" style={{ marginTop: 4 }}>
                        {c.ideas.length} idée(s) · {c.instruments.length ? c.instruments.join(" · ") : "aucune idée exécutée"}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <CampaignMenu id={c.id} canModify={canModify} />
                    </div>
                  </div>

                  {/* aperçu tronqué de la thèse (quelques lignes) */}
                  {c.note && (
                    <Link href={`/campaigns/${c.id}`} className="note clamp3" style={{ display: "-webkit-box", marginTop: 12, whiteSpace: "pre-wrap", textDecoration: "none" }}>
                      {c.note}
                    </Link>
                  )}

                  {executed.length > 0 && (
                    <>
                      <div className="g3" style={{ marginTop: 14 }}>
                        <div className="card kpi" style={{ minHeight: 96 }}>
                          <div className="eyebrow">R de la thèse</div>
                          <div className={`stat ${rTot ? (rTot.gt(0) ? "gain" : rTot.lt(0) ? "loss" : "") : ""}`}>{rFmt(rTot)}</div>
                          <div className="note">somme des R de chaque idée</div>
                        </div>
                        <div className="card kpi" style={{ minHeight: 96 }}>
                          <div className="eyebrow">Par unité de risque</div>
                          <div className={`stat ${rW ? (rW.gt(0) ? "gain" : rW.lt(0) ? "loss" : "") : ""}`}>{rFmt(rW)}</div>
                          <div className="note">P&amp;L total / risque total</div>
                        </div>
                        <div className="card kpi" style={{ minHeight: 96 }}>
                          <div className="eyebrow">P&amp;L net</div>
                          <div className={`stat ${c.pnl_net.gt(0) ? "gain" : c.pnl_net.lt(0) ? "loss" : ""}`}>{money(c.pnl_net)}</div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* jambes rattachées + détacher (confirmé) */}
                  {legs.length > 0 && (
                    <div className="tablewrap" style={{ marginTop: 12 }}>
                      <table className="t">
                        <thead><tr><th>instrument</th><th>sens</th><th className="num">R</th><th className="num">P&L net</th><th>tickets</th><th></th></tr></thead>
                        <tbody>
                          {legs.map((i) => {
                            const r = i.r_multiple(book);
                            return (
                              <tr key={i.id}>
                                <td><Link href={`/journal/${i.id}`} style={{ color: "var(--ink)" }}><b>{i.symbol}</b></Link></td>
                                <td><span className={`chip ${i.thesis?.direction === Direction.SELL ? "bad" : "ok"}`}>{i.thesis ? (i.thesis.direction === Direction.SELL ? "short" : "long") : "—"}</span></td>
                                <td className={`num ${r ? (r.gt(0) ? "gain" : r.lt(0) ? "loss" : "") : ""}`}>{rFmt(r)}</td>
                                <td className={`num ${i.pnl_net.gt(0) ? "gain" : "loss"}`}>{money(i.pnl_net)}</td>
                                <td className="note">{i.positions.length} ticket(s)</td>
                                <td style={{ textAlign: "right" }}>
                                  <ConfirmSubmit
                                    action={detachIdea}
                                    hidden={{ ideaId: i.id }}
                                    className="pop-btn"
                                    title="Détacher cette idée ?"
                                    message={<>L&apos;idée <b>{i.symbol}</b> redevient autonome. Rien n&apos;est effacé.</>}
                                    confirmLabel="Oui, détacher"
                                  >
                                    Détacher
                                  </ConfirmSubmit>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* rattacher une idée */}
                  {unattached.length > 0 && (
                    <form action={attachIdea} className="row" style={{ marginTop: 12, gap: 8 }}>
                      <input type="hidden" name="campaignId" value={c.id} />
                      <select name="ideaId" style={{ flex: 1 }}>
                        {unattached.map((i) => (
                          <option key={i.id} value={i.id}>{i.symbol} — {i.label || i.display_name}</option>
                        ))}
                      </select>
                      <SubmitButton className="ghost" pendingLabel="…">Rattacher une idée</SubmitButton>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </main>
  );
}
