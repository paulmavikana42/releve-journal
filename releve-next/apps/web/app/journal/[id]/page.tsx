import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Decimal,
  Direction,
  IdeaStatus,
  Quadrant,
  SpecBook,
  ThesisOutcome,
  type Idea,
  type Position,
} from "@releve/core";
import { currentUser, openStore } from "../data";

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
                <div style={{ fontWeight: 600, whiteSpace: "nowrap", color: p.pnl_net.gt(0) ? "var(--gain)" : "var(--loss)" }}>
                  {money(p.pnl_net)}
                </div>
              </div>
            );
          })}
          {tickets.length === 0 && <div className="card muted">Aucun ticket rattaché.</div>}
        </div>
      </section>

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
