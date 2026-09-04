import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Decimal,
  Direction,
  IdeaStatus,
  MissedOutcome,
  Quadrant,
  SpecBook,
  ThesisOutcome,
  type Idea,
  type Position,
} from "@releve/core";
import { currentUser, openStore, signedCaptureUrls, signedUrlsForPaths } from "../data";
import BlockView from "../../components/BlockView";
import { imagePaths } from "@/lib/blocks";
import {
  abandonIdea,
  addCapture,
  cancelTrade,
  completeReview,
  openTrade,
  removeCapture,
  reviewMissed,
  unlinkPosition,
  updateFloating,
} from "../actions";
import SubmitButton from "../../components/SubmitButton";
import ConfirmSubmit from "../../components/ConfirmSubmit";
import BackLink from "../../components/BackLink";
import AutoTextarea from "../../components/AutoTextarea";
import Help from "../../components/Help";

const STATUS_LABEL: Record<string, string> = {
  [IdeaStatus.DRAFT]: "brouillon",
  [IdeaStatus.ARMED]: "armée",
  [IdeaStatus.RUNNING]: "en cours",
  [IdeaStatus.CLOSED]: "clôturée",
  [IdeaStatus.REVIEWED]: "revue",
  [IdeaStatus.ABANDONED]: "abandonnée",
};

const QUADRANT_LABEL: Record<string, string> = {
  [Quadrant.MASTERY]: "Maîtrise (gain · bon process)",
  [Quadrant.LUCK]: "Chance (gain · mauvais process)",
  [Quadrant.ERROR]: "Erreur (perte · mauvais process)",
  [Quadrant.VARIANCE]: "Aléa OK (perte · bon process)",
};

const OUTCOME_LABEL: Record<string, string> = {
  [ThesisOutcome.CORRECT]: "thèse correcte",
  [ThesisOutcome.WRONG]: "thèse fausse",
  [ThesisOutcome.UNTESTED]: "non tranchée",
};

function money(x: Decimal | null): string {
  if (x === null) return "—";
  const v = x.toFixed(2);
  return (x.gt(0) ? "+" : "") + v + " $";
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: "gain" | "loss"; hint?: string }) {
  return (
    <div className="card" style={{ padding: "10px 14px" }}>
      <div className="muted" style={{ fontSize: ".78rem" }}>{label}{hint && <Help tip={hint} />}</div>
      <div
        style={{
          fontSize: "1.1rem",
          fontWeight: 600,
          whiteSpace: "nowrap",
          color: tone === "gain" ? "var(--gain)" : tone === "loss" ? "var(--loss)" : "var(--ink)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default async function IdeaDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const store = await openStore(supabase, user.id);
  const { ideas, positions } = store.load();
  const idea: Idea | undefined = ideas.get(id);
  if (!idea) notFound();

  const book = new SpecBook([...positions.values()]);
  const t = idea.thesis;
  const dir = t?.direction === Direction.SELL ? "Vente" : "Achat";

  const r = idea.r_multiple(book);
  const risk = idea.risk_realized(book);
  const peak = idea.max_concurrent_risk(book);
  const measured = idea.exposure_is_measured();
  const risks = idea.ticket_risks(book);
  const needStop = idea.tickets_needing_stop();
  const disjoints = idea.tickets_disjoints;
  const rev = idea.review;
  const captureUrls = await signedCaptureUrls(supabase, idea.captures);
  const blockUrlMap = await signedUrlsForPaths(supabase, imagePaths(idea.thesis?.blocks as unknown[] | undefined));
  const blockUrls = Object.fromEntries(blockUrlMap);

  const tickets: Position[] = [...idea.positions].sort(
    (a, b) => a.open_time.getTime() - b.open_time.getTime(),
  );

  return (
    <main className="wrap">
      <div style={{ marginBottom: 16 }}>
        <BackLink fallback="/journal">← Retour</BackLink>
      </div>

      <header className="between" style={{ marginBottom: 16 }}>
        <div>
          <div className="row">
            <h1 style={{ margin: 0 }}>{idea.symbol}</h1>
            <span className="muted">{dir}</span>
            <span className="chip">{STATUS_LABEL[idea.status] ?? idea.status}</span>
            {idea.off_plan && <span className="chip" style={{ color: "var(--loss)" }}>hors-plan</span>}
          </div>
          <div className="muted" style={{ fontSize: ".9rem", marginTop: 4 }}>
            {idea.label || idea.display_name} · écrite le {idea.created_at.toISOString().slice(0, 10)}
            {idea.closed_at && ` · clôturée le ${idea.closed_at.toISOString().slice(0, 10)}`}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {!rev && (
            <Link
              href={`/journal/${idea.id}/edit`}
              className="ghost"
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", textDecoration: "none" }}
            >
              Modifier
            </Link>
          )}
          {!idea.is_executed && idea.status !== IdeaStatus.ABANDONED && (
            <form action={abandonIdea}>
              <input type="hidden" name="ideaId" value={idea.id} />
              <SubmitButton className="ghost" pendingLabel="…">Abandonner</SubmitButton>
            </form>
          )}
        </div>
      </header>

      {/* Cycle de vie */}
      {idea.status === IdeaStatus.ABANDONED ? (
        <div className="stepper">
          <span className="step on" style={{ borderRadius: 6 }}>abandonnée</span>
        </div>
      ) : (
        (() => {
          const order = [IdeaStatus.ARMED, IdeaStatus.RUNNING, IdeaStatus.CLOSED, IdeaStatus.REVIEWED];
          const labels = ["armée", "en cours", "clôturée", "revue"];
          const cur = order.indexOf(idea.status);
          return (
            <div className="stepper">
              {order.map((s, i) => (
                <span key={s} className={`step ${idea.status === s ? "on" : cur >= 0 && i < cur ? "done" : ""}`}>
                  {labels[i]}
                </span>
              ))}
            </div>
          );
        })()
      )}

      {/* Métriques clés */}
      <section
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 20 }}
      >
        <Stat label="P&L net" value={money(idea.pnl_net)} tone={idea.pnl_net.gt(0) ? "gain" : "loss"} />
        <Stat
          label="R engagé"
          value={r === null ? "incalculable" : (r.gt(0) ? "+" : "") + r.toFixed(2) + " R"}
          tone={r === null ? undefined : r.gt(0) ? "gain" : "loss"}
          hint="Résultat divisé par le risque réel du trade. Mesure ton edge en neutralisant la taille de position : +1 R = tu as gagné ce que tu risquais."
        />
        <Stat label="Risque engagé" value={risk === null ? "—" : risk.toFixed(2) + " $"} hint="La somme réellement risquée sur ce trade (entrée − stop, par ticket)." />
        <Stat
          label={`Exposition simultanée${measured ? "" : " (majorant)"}`}
          value={peak === null ? "—" : peak.toFixed(2) + " $"}
          hint="Le risque maximum porté en même temps quand plusieurs tickets étaient ouverts. « Majorant » = estimation haute faute d'info sur les breakeven."
        />
      </section>

      {idea.adds.length > 0 && (
        <section className="g2" style={{ marginBottom: 20 }}>
          <Stat label="P&L du noyau" value={money(idea.pnl_initial)} tone={idea.pnl_initial.gt(0) ? "gain" : "loss"} />
          <Stat label={`P&L des renforcements (${idea.adds.length})`} value={money(idea.pnl_adds)} tone={idea.pnl_adds.gt(0) ? "gain" : "loss"} />
        </section>
      )}

      {/* Avertissements du moteur */}
      {r === null && needStop.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--loss)" }}>
          <strong>R incalculable</strong>
          <div className="muted" style={{ fontSize: ".9rem" }}>
            Stop manquant pour le(s) ticket(s) {needStop.map((p) => `#${p.position_id}`).join(", ")}.
            Un renforcement n'hérite jamais du stop du noyau — il faut le saisir.
          </div>
        </div>
      )}
      {disjoints.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--loss)" }}>
          <strong>Tickets peut-être mal rattachés</strong>
          <div className="muted" style={{ fontSize: ".9rem" }}>
            {disjoints.map((p) => `#${p.position_id}`).join(", ")} ne chevauche(nt) pas les autres
            dans le temps — deux trades distincts additionneraient leurs risques à tort.
          </div>
        </div>
      )}

      {/* Trade en cours / déclarer le ticket */}
      {idea.is_running ? (
        <section className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Trade en cours</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {idea.open_trades.map((o) => {
              const pv = book.get(o.symbol)?.point_value ?? null;
              const floating = o.floating_pnl(pv);
              return (
                <div key={o.uid} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <div className="between">
                    <div>
                      <div className="row">
                        <span className="chip">#{o.ticket}</span>
                        <span>{o.open_price.toString()}</span>
                        <span className="muted">stop {o.stop ? o.stop.toString() : "—"}</span>
                        <span className="muted">vol {o.volume.toString()}</span>
                      </div>
                      <div className="muted" style={{ fontSize: ".82rem", marginTop: 2 }}>
                        ouvert le {o.open_time.toISOString().slice(0, 16).replace("T", " ")}
                        {o.last_price && ` · dernier cours ${o.last_price.toString()}`}
                      </div>
                    </div>
                    <form action={cancelTrade}>
                      <input type="hidden" name="ideaId" value={idea.id} />
                      <input type="hidden" name="uid" value={o.uid} />
                      <SubmitButton className="ghost" pendingLabel="…">Annuler</SubmitButton>
                    </form>
                  </div>
                  <form action={updateFloating} className="row" style={{ gap: 8, marginTop: 8 }}>
                    <input type="hidden" name="ideaId" value={idea.id} />
                    <input type="hidden" name="uid" value={o.uid} />
                    <input name="last_price" inputMode="decimal" placeholder="cours actuel" style={{ width: 140 }} />
                    <SubmitButton className="ghost" pendingLabel="…">Mettre à jour le flottant</SubmitButton>
                    {floating && (
                      <span style={{ fontWeight: 600, color: floating.gt(0) ? "var(--gain)" : "var(--loss)" }}>
                        flottant {money(floating)}
                      </span>
                    )}
                  </form>
                </div>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: ".82rem", marginTop: 8 }}>
            Ton prochain import refermera ce trade tout seul, par ce numéro de ticket.
          </div>
        </section>
      ) : (
        !idea.is_executed && t && (
          <form action={openTrade} className="card" style={{ marginBottom: 20, display: "grid", gap: 12 }}>
            <input type="hidden" name="ideaId" value={idea.id} />
            <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Déclarer le ticket (entrée)</h2>
            <div className="muted" style={{ fontSize: ".85rem", marginTop: -6 }}>
              Dès l'entrée : l'idée passe « en cours » et le stop réellement placé est enregistré
              avant que le broker ne l'écrase.
            </div>
            <div className="g4">
              <div>
                <label>N° de ticket</label>
                <input name="ticket" required placeholder="88210912" style={{ width: "100%" }} />
              </div>
              <div>
                <label>Volume</label>
                <input name="volume" inputMode="decimal" placeholder="1.0" style={{ width: "100%" }} />
              </div>
              <div>
                <label>Prix d'entrée</label>
                <input name="open_price" inputMode="decimal" defaultValue={t.entry_planned ? t.entry_planned.toString() : ""} style={{ width: "100%" }} />
              </div>
              <div>
                <label>Stop réel</label>
                <input name="stop" inputMode="decimal" defaultValue={t.stop_initial ? t.stop_initial.toString() : ""} style={{ width: "100%" }} />
              </div>
            </div>
            <div>
              <SubmitButton pendingLabel="Déclaration…">Je viens d'entrer</SubmitButton>
            </div>
          </form>
        )
      )}

      {/* La thèse */}
      {t && (
        <section className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>La thèse (écrite avant)</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
            <Field label="Entrée visée" value={t.entry_planned ? t.entry_planned.toString() : "—"} />
            <Field label="Stop initial" value={t.stop_initial ? t.stop_initial.toString() : "—"} />
            <Field label="TP" value={t.targets.length ? t.targets.map((x) => x.toString()).join(" · ") : "—"} />
            <Field label="Conviction" value={t.conviction ? `${t.conviction}/5` : "—"} />
            <Field label="Risque déclaré" value={t.risk_pct ? `${t.risk_pct.toString()} %` : "—"} />
          </div>
          {(t.macro_theme || t.catalyst || t.thesis_kill_switch) && (
            <div style={{ marginTop: 12, fontSize: ".92rem", lineHeight: 1.6 }}>
              {t.macro_theme && <div><span className="muted">Thème : </span>{t.macro_theme}</div>}
              {t.catalyst && <div><span className="muted">Catalyseur : </span>{t.catalyst}</div>}
              {t.thesis_kill_switch && <div><span className="muted">Invalidation : </span>{t.thesis_kill_switch}</div>}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <BlockView blocks={t.blocks as unknown[] | undefined} note={t.macro_note || t.technical_note} urls={blockUrls} />
          </div>
        </section>
      )}

      {/* Captures (images pré-engagées) */}
      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Captures</h2>
        {idea.captures.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 14, marginBottom: 18, paddingBottom: 16, borderBottom: "1px solid var(--rule-soft)" }}>
            {idea.captures.map((c) => (
              <div key={c.id} className="shot">
                {captureUrls.get(c.id) ? (
                  <a href={captureUrls.get(c.id)} target="_blank" rel="noreferrer" title="Ouvrir en grand">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={captureUrls.get(c.id)}
                      alt={c.caption || c.original_name}
                      style={{ width: "100%", height: "auto", maxHeight: 340, objectFit: "contain", borderRadius: 8, display: "block" }}
                    />
                  </a>
                ) : (
                  <div className="muted" style={{ fontSize: ".8rem", padding: 20, textAlign: "center" }}>image indisponible</div>
                )}
                <div className="between" style={{ marginTop: 6 }}>
                  <span className="muted" style={{ fontSize: ".78rem" }}>{c.caption || c.kind}</span>
                  <ConfirmSubmit
                    action={removeCapture}
                    hidden={{ attachment_id: c.id, owner_id: idea.id, owner_type: "idea" }}
                    className="pop-btn"
                    title="Retirer cette capture ?"
                    message="L'image est retirée de l'idée. Le fichier lui-même n'est pas supprimé."
                    confirmLabel="Oui, retirer"
                  >
                    Retirer
                  </ConfirmSubmit>
                </div>
              </div>
            ))}
          </div>
        )}
        <form action={addCapture} className="capture-form">
          <input type="hidden" name="owner_type" value="idea" />
          <input type="hidden" name="owner_id" value={idea.id} />
          <input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif" required className="cap-file" />
          <select name="kind" defaultValue="entree">
            <option value="these">Thèse</option>
            <option value="entree">Entrée</option>
            <option value="gestion">Gestion</option>
            <option value="sortie">Sortie</option>
            <option value="autre">Autre</option>
          </select>
          <input name="caption" placeholder="légende (facultatif)" className="cap-caption" />
          <SubmitButton pendingLabel="Envoi…">Joindre</SubmitButton>
        </form>
      </section>

      {/* Les tickets */}
      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: "1rem" }}>
          Tickets ({tickets.length}
          {idea.adds.length > 0 ? ` · noyau + ${idea.adds.length} renfort` : ""})
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tickets.map((p, k) => {
            const [stop, src] = idea.stop_for(p);
            const rk = risks.get(p.position_id) ?? null;
            const isCore = idea.initial_position?.uid === p.uid;
            return (
              <div key={p.uid} className="card between ticket-row">
                <div>
                  <div className="row">
                    <span className="chip">#{p.position_id}</span>
                    <span className="muted">{isCore ? "noyau" : "renfort"}</span>
                    <span>{p.open_price.toString()} → {p.close_price.toString()}</span>
                  </div>
                  <div className="muted" style={{ fontSize: ".82rem", marginTop: 2 }}>
                    {p.open_time.toISOString().slice(0, 16).replace("T", " ")} →{" "}
                    {p.close_time.toISOString().slice(0, 16).replace("T", " ")}
                    {" · stop "}{stop ? `${stop.toString()} (${src})` : "manquant"}
                    {" · risque "}{rk ? `${rk.toFixed(2)} $` : "—"}
                  </div>
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <span style={{ fontWeight: 600, whiteSpace: "nowrap", color: p.pnl_net.gt(0) ? "var(--gain)" : "var(--loss)" }}>
                    {money(p.pnl_net)}
                  </span>
                  <ConfirmSubmit
                    action={unlinkPosition}
                    hidden={{ ideaId: idea.id, positionUid: p.uid }}
                    title="Détacher ce ticket ?"
                    message={<>Le ticket <b>#{p.position_id}</b> est retiré de cette idée (le journal est append-only : rien n&apos;est effacé).</>}
                    confirmLabel="Oui, détacher"
                  >
                    Détacher
                  </ConfirmSubmit>
                </div>
              </div>
            );
          })}
          {tickets.length === 0 && <div className="card muted">Aucun ticket rattaché.</div>}
        </div>
      </section>

      {/* Faire la revue (idée exécutée, pas encore revue) */}
      {!rev && idea.is_executed && (
        <form action={completeReview} className="card" style={{ marginBottom: 20, display: "grid", gap: 12 }}>
          <input type="hidden" name="ideaId" value={idea.id} />
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Relire ce trade</h2>
          <div className="muted" style={{ fontSize: ".85rem", marginTop: -6 }}>
            La discipline mesure le <em>process</em>, indépendamment du gain. Le verdict dit si le
            marché t'a donné raison. Les deux se croisent dans le quadrant.
          </div>
          <div className="g2">
            {[
              ["entry_in_zone", "Entrée dans la zone prévue"],
              ["size_conforme", "Taille conforme au risque"],
              ["stop_at_invalidation", "Stop à l'invalidation"],
              ["stop_never_widened", "Stop jamais élargi"],
              ["exit_per_plan", "Sortie selon le plan"],
            ].map(([k, label]) => (
              <label key={k} className="row" style={{ gap: 8 }}>
                <input type="checkbox" name={k} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="g2">
            <div>
              <label>Le marché t'a-t-il donné raison ?</label>
              <select name="thesis_outcome" defaultValue="non_testee" style={{ width: "100%" }}>
                <option value="correcte">Thèse correcte</option>
                <option value="fausse">Thèse fausse</option>
                <option value="non_testee">Non tranchée</option>
              </select>
            </div>
            <div>
              <label>État émotionnel (facultatif)</label>
              <input name="emotional_state" placeholder="Calme, FOMO, agacé…" style={{ width: "100%" }} />
            </div>
          </div>
          <div>
            <label>Leçon</label>
            <AutoTextarea name="lesson" rows={3} placeholder="Ce que ce trade t'apprend, à répliquer ou à éviter." style={{ width: "100%" }} />
          </div>
          <div>
            <SubmitButton pendingLabel="Enregistrement…">Enregistrer la revue</SubmitButton>
          </div>
        </form>
      )}

      {/* La review (qualité d'exécution) — inclut l'état psychologique */}
      {rev && (
        <section className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Revue</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
            <div className="card" style={{ padding: "10px 14px" }}>
              <div className="muted" style={{ fontSize: ".78rem" }}>Respect du plan</div>
              <div style={{ fontWeight: 600, fontFamily: "var(--font-mono)", color: rev.discipline_score >= 4 ? "var(--gain)" : "var(--loss)" }}>{rev.discipline_score}/5</div>
              <div className="note" style={{ marginTop: 2 }}>entrée, taille, stop, sortie</div>
            </div>
            <div className="card" style={{ padding: "10px 14px" }}>
              <div className="muted" style={{ fontSize: ".78rem" }}>Verdict du marché</div>
              <div style={{ fontWeight: 600, color: rev.thesis_outcome === ThesisOutcome.CORRECT ? "var(--gain)" : rev.thesis_outcome === ThesisOutcome.WRONG ? "var(--loss)" : "var(--ink)" }}>{OUTCOME_LABEL[rev.thesis_outcome] ?? rev.thesis_outcome}</div>
              <div className="note" style={{ marginTop: 2 }}>indépendant du P&L</div>
            </div>
            <div className="card" style={{ padding: "10px 14px" }}>
              <div className="muted" style={{ fontSize: ".78rem" }}>État psychologique</div>
              <div style={{ fontWeight: 600 }}>{rev.emotional_state || "—"}</div>
              <div className="note" style={{ marginTop: 2 }}>déclaratif, pendant le trade</div>
            </div>
            <div className="card" style={{ padding: "10px 14px" }}>
              <div className="muted" style={{ fontSize: ".78rem" }}>Décision × résultat</div>
              <div style={{ fontWeight: 600 }}>{QUADRANT_LABEL[idea.quadrant] ?? idea.quadrant}</div>
            </div>
          </div>
          {rev.lesson && (
            <div style={{ marginTop: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>leçon</div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{rev.lesson}</p>
            </div>
          )}
        </section>
      )}

      {/* Bilan d'abandon (idée non prise) */}
      {idea.missed_review && (
        <section className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Bilan d'abandon</h2>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <span className="chip">
              {idea.missed_review.setup_appeared === MissedOutcome.HESITATED
                ? "setup présenté — pas pris"
                : "setup absent"}
            </span>
            {idea.missed_review.setup_appeared === MissedOutcome.HESITATED && (
              <span className="chip">
                {idea.missed_review.would_have_won === true
                  ? "aurait gagné"
                  : idea.missed_review.would_have_won === false
                    ? "aurait perdu"
                    : "indécis"}
              </span>
            )}
          </div>
          {idea.missed_review.note && <p style={{ marginBottom: 0 }}>{idea.missed_review.note}</p>}
        </section>
      )}

      {!idea.missed_review && !idea.is_executed && idea.status === IdeaStatus.ABANDONED && (
        <form action={reviewMissed} className="card" style={{ marginBottom: 20, display: "grid", gap: 12 }}>
          <input type="hidden" name="ideaId" value={idea.id} />
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Bilan d'abandon</h2>
          <div className="muted" style={{ fontSize: ".85rem", marginTop: -6 }}>
            La question n'est pas « avais-je raison » mais « ai-je eu l'occasion ». Un setup absent
            est un non-événement ; une hésitation devant un setup valide est l'information qui compte.
          </div>
          <div className="g2">
            <div>
              <label>Le setup s'est-il présenté ?</label>
              <select name="setup_appeared" defaultValue="setup_absent" style={{ width: "100%" }}>
                <option value="setup_absent">Non — il ne s'est pas présenté</option>
                <option value="hesitation">Oui — je ne l'ai pas pris</option>
              </select>
            </div>
            <div>
              <label>Aurait-elle gagné ? (si présenté)</label>
              <select name="would_have_won" defaultValue="indecis" style={{ width: "100%" }}>
                <option value="oui">Oui</option>
                <option value="non">Non</option>
                <option value="indecis">Indécis</option>
              </select>
            </div>
          </div>
          <div>
            <label>Note</label>
            <AutoTextarea name="note" rows={2} placeholder="Pourquoi je ne l'ai pas pris…" style={{ width: "100%" }} />
          </div>
          <div>
            <SubmitButton pendingLabel="Enregistrement…">Enregistrer le bilan</SubmitButton>
          </div>
        </form>
      )}
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: ".78rem" }}>{label}</div>
      <div style={{ fontWeight: 500 }}>{value}</div>
    </div>
  );
}
