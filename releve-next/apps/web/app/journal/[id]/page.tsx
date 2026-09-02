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
import { currentUser, openStore } from "../data";
import { abandonIdea, cancelTrade, completeReview, openTrade, reviewMissed, unlinkPosition, updateFloating } from "../actions";
import SubmitButton from "../../components/SubmitButton";

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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="card" style={{ padding: "10px 14px" }}>
      <div className="muted" style={{ fontSize: ".78rem" }}>{label}</div>
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

  const tickets: Position[] = [...idea.positions].sort(
    (a, b) => a.open_time.getTime() - b.open_time.getTime(),
  );

  return (
    <main className="wrap">
      <div style={{ marginBottom: 16 }}>
        <Link href="/journal" className="muted">← retour au journal</Link>
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

      {/* Métriques clés */}
      <section
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 20 }}
      >
        <Stat label="P&L net" value={money(idea.pnl_net)} tone={idea.pnl_net.gt(0) ? "gain" : "loss"} />
        <Stat
          label="R engagé"
          value={r === null ? "incalculable" : (r.gt(0) ? "+" : "") + r.toFixed(2) + " R"}
          tone={r === null ? undefined : r.gt(0) ? "gain" : "loss"}
        />
        <Stat label="Risque engagé" value={risk === null ? "—" : risk.toFixed(2) + " $"} />
        <Stat
          label={`Exposition simultanée${measured ? "" : " (majorant)"}`}
          value={peak === null ? "—" : peak.toFixed(2) + " $"}
        />
      </section>

      {idea.adds.length > 0 && (
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
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
            Le prochain import contenant ce numéro de ticket clôturera le trade automatiquement.
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
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
            <Field label="Objectifs" value={t.targets.length ? t.targets.map((x) => x.toString()).join(" · ") : "—"} />
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
        </section>
      )}

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
              <div key={p.uid} className="card between">
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
                  <form action={unlinkPosition}>
                    <input type="hidden" name="ideaId" value={idea.id} />
                    <input type="hidden" name="positionUid" value={p.uid} />
                    <SubmitButton className="ghost" pendingLabel="…">Détacher</SubmitButton>
                  </form>
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
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Faire la revue</h2>
          <div className="muted" style={{ fontSize: ".85rem", marginTop: -6 }}>
            La discipline mesure le <em>process</em>, indépendamment du gain. Le verdict dit si le
            marché t'a donné raison. Les deux se croisent dans le quadrant.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
            <textarea name="lesson" rows={3} placeholder="Ce que ce trade t'apprend, à répliquer ou à éviter." style={{ width: "100%" }} />
          </div>
          <div>
            <SubmitButton pendingLabel="Enregistrement…">Enregistrer la revue</SubmitButton>
          </div>
        </form>
      )}

      {/* La review */}
      {rev && (
        <section className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Revue</h2>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <span className="chip">discipline {rev.discipline_score}/5</span>
            <span className="chip">{OUTCOME_LABEL[rev.thesis_outcome] ?? rev.thesis_outcome}</span>
            <span className="chip">{QUADRANT_LABEL[idea.quadrant] ?? idea.quadrant}</span>
          </div>
          {rev.lesson && <p style={{ marginBottom: 0 }}>{rev.lesson}</p>}
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
            <textarea name="note" rows={2} placeholder="Pourquoi je ne l'ai pas pris…" style={{ width: "100%" }} />
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
