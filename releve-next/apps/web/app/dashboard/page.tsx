import Link from "next/link";
import { redirect } from "next/navigation";
import {
  analysisRows,
  dailyPnlRealise,
  dailyReturns,
  dailyReturnsFromRows,
  dealCurve,
  decisionMatrix,
  equitySeries,
  evaluate,
  expectancyOfRows,
  ideasCorrectRate,
  Quadrant,
  scopeToAccount,
  sharpe,
  sortino,
  SpecBook,
  Unit,
} from "@releve/core";
import { currentUser, openStore } from "../journal/data";
import { activeScope } from "../settings/data";

const QUADRANTS: [Quadrant, string, string][] = [
  [Quadrant.MASTERY, "Maîtrise", "mastery"],
  [Quadrant.LUCK, "Chance", "luck"],
  [Quadrant.VARIANCE, "Aléa OK", "variance"],
  [Quadrant.ERROR, "Erreur", "error"],
];

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "gain" | "loss" }) {
  return (
    <div className="card" style={{ padding: "12px 16px" }}>
      <div className="muted" style={{ fontSize: ".78rem" }}>{label}</div>
      <div
        style={{
          fontSize: "1.35rem",
          fontWeight: 700,
          whiteSpace: "nowrap",
          color: tone === "gain" ? "var(--gain)" : tone === "loss" ? "var(--loss)" : "var(--ink)",
        }}
      >
        {value}
      </div>
      {sub && <div className="muted" style={{ fontSize: ".78rem" }}>{sub}</div>}
    </div>
  );
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>;
}) {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const { unit: unitParam } = await searchParams;
  const unit = unitParam === "idea" ? Unit.IDEA : Unit.THESIS;

  const store = await openStore(supabase, user.id);
  const loaded = store.load();
  const { active, activeUid, accountUids } = await activeScope(supabase, user.id);
  const scoped = scopeToAccount(
    { ideas: loaded.ideas, campaigns: store.campaigns(), deals: loaded.deals },
    activeUid,
    accountUids,
  );
  const all = scoped.ideas;
  const deals = scoped.deals;
  const campaigns = scoped.campaigns;
  const executed = all.filter((i) => i.is_executed);

  const account = active;
  const cur = account?.symbol ?? "$";
  const book = new SpecBook([...loaded.positions.values()]);

  // Unité d'analyse : une thèse macro compte pour UNE décision par défaut ([X]).
  const rows = analysisRows(all, campaigns, unit, book);
  const exp = expectancyOfRows(rows);
  const correct = ideasCorrectRate(all);
  const dm = decisionMatrix(all, campaigns, unit, book, account ? account.start_balance : null);

  // Survie : calculée sur les RÈGLES du compte (jamais 100k supposé).
  const comp = account ? evaluate(account, all, deals) : null;
  const lowest = account ? equitySeries(account, all, deals).lowest : null;

  // Sharpe / Sortino : soldes broker si dispo, sinon reconstitués depuis les
  // clôtures — et on dit laquelle ([Y]).
  const measured = deals.length > 0;
  const rets = measured
    ? dailyReturns(dealCurve(deals))
    : dailyReturnsFromRows(rows, account ? account.start_balance : 100000);
  const sh = sharpe(rets);
  const so = sortino(rets);

  // Calendrier : P&L réalisé par jour (sortie partielle datée à son jour).
  const parJour = [...dailyPnlRealise(all, deals).entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  const pct = (x: number) => (x * 100).toFixed(0) + " %";
  const r2 = (x: number) => (x > 0 ? "+" : "") + x.toFixed(2);

  return (
    <main className="wrap">
      <header className="between" style={{ marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0 }}>Tableau de bord</h1>
          <div className="row muted" style={{ gap: 8, fontSize: ".82rem", marginTop: 2 }}>
            <span>Unité d'analyse :</span>
            <Link href="/dashboard?unit=thesis" style={{ fontWeight: unit === Unit.THESIS ? 700 : 400, color: unit === Unit.THESIS ? "var(--accent)" : "var(--muted)" }}>
              par thèse
            </Link>
            <span>·</span>
            <Link href="/dashboard?unit=idea" style={{ fontWeight: unit === Unit.IDEA ? 700 : 400, color: unit === Unit.IDEA ? "var(--accent)" : "var(--muted)" }}>
              par idée
            </Link>
          </div>
        </div>
        <nav className="row" style={{ gap: 14 }}>
          <Link href="/journal" className="muted">Journal</Link>
          <Link href="/campaigns" className="muted">Thèses</Link>
          <Link href="/compliance" className="muted">Conformité</Link>
          <Link href="/settings" className="muted">Réglages</Link>
          <form action="/auth/signout" method="post">
            <button type="submit" className="ghost">Se déconnecter</button>
          </form>
        </nav>
      </header>

      {/* KPI */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 20 }}>
        <Kpi label="Idées" value={String(all.length)} sub={`${executed.length} exécutées`} />
        {exp ? (
          <>
            <Kpi label="Espérance" value={r2(exp.expectancy_r) + " R"} sub={`sur ${exp.n} décisions`} tone={exp.expectancy_r >= 0 ? "gain" : "loss"} />
            <Kpi label="Taux de réussite" value={pct(exp.win_rate)} sub={`gain moy ${r2(exp.avg_win_r)}R · perte ${r2(exp.avg_loss_r)}R`} />
            <Kpi label="R cumulé" value={r2(exp.total_r) + " R"} tone={exp.total_r >= 0 ? "gain" : "loss"} />
          </>
        ) : (
          <Kpi label="Espérance" value="—" sub="pas encore de R fiable" />
        )}
        {correct && (
          <Kpi label="Idées correctes" value={pct(correct.rate)} sub={`le marché t'a donné raison · n=${correct.n}`} />
        )}
        {sh && (
          <Kpi
            label="Sharpe (annualisé)"
            value={sh.value.toFixed(2)}
            sub={`${measured ? "soldes broker" : "reconstitué"} · n=${sh.n}${sh.is_meaningful ? "" : " (échantillon faible)"}`}
          />
        )}
        {so && (
          <Kpi label="Sortino (annualisé)" value={so.value.toFixed(2)} sub={measured ? "soldes broker" : "reconstitué"} />
        )}
      </section>

      {/* Survie — calculée sur les règles du compte, jamais supposée */}
      {!account ? (
        <section className="card" style={{ marginBottom: 20, borderColor: "var(--accent)" }}>
          <strong>Configure ton compte</strong>
          <div className="muted" style={{ fontSize: ".9rem", marginTop: 2 }}>
            Sans capital ni règles, l'outil ne peut pas calculer ta marge de survie — et une jauge
            fausse serait pire qu'absente.{" "}
            <Link href="/settings">Renseigner mon challenge →</Link>
          </div>
        </section>
      ) : comp ? (
        <section className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>
            Survie du challenge{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              · {account.label} · base {account.start_balance.toFixed(0)} {cur}
              {account.drawdown_static ? " · drawdown fixe" : " · trailing"}
            </span>
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
            <Kpi label="Solde" value={comp.balance.toFixed(2) + " " + cur} />
            <Kpi label="Plancher fatal" value={comp.floor.toFixed(0) + " " + cur} />
            <Kpi
              label="Marge avant échec"
              value={comp.margin_to_floor.toFixed(2) + " " + cur}
              tone={comp.margin_to_floor.gt(0) ? "gain" : "loss"}
            />
            {lowest && <Kpi label="Plus-bas touché" value={lowest.toFixed(2) + " " + cur} />}
            <Kpi
              label={`Drawdown (limite ${comp.drawdown_limit_pct.toFixed(0)} %)`}
              value={comp.drawdown_pct.toFixed(2) + " %"}
              tone={comp.drawdown_pct.lt(comp.drawdown_limit_pct) ? undefined : "loss"}
            />
          </div>
          {comp.breached.length > 0 && (
            <div style={{ marginTop: 10, color: "var(--loss)", fontSize: ".9rem" }}>
              ⚠️ Règle(s) enfreinte(s) : {comp.breached.map((c) => c.label).join(", ")}.
            </div>
          )}
          {lowest && lowest.lt(comp.floor) && (
            <div style={{ marginTop: 6, color: "var(--loss)", fontSize: ".9rem" }}>
              ⚠️ Le plus-bas est passé SOUS le plancher : sur ces données, le challenge aurait été perdu.
            </div>
          )}
        </section>
      ) : null}

      {/* Matrice décision × résultat */}
      <section className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0, fontSize: "1rem" }}>
          Décision × résultat{" "}
          <span className="muted" style={{ fontWeight: 400 }}>
            · {dm.n_reviewed} revue(s), {dm.n_pending} en attente
          </span>
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {QUADRANTS.map(([q, label, klass]) => {
            const c = dm.get(q);
            return (
              <div key={q} className={`quad ${klass}`}>
                <div className="between">
                  <span className="lab">{label}</span>
                  {c.pct !== null && <span className="lab">{c.pct > 0 ? "+" : ""}{c.pct.toFixed(1)} %</span>}
                </div>
                <div className="n">{c.n}</div>
                <div className="note" style={{ marginTop: 4 }}>
                  {c.pnl > 0 ? "+" : ""}{c.pnl.toFixed(2)} {cur}
                </div>
              </div>
            );
          })}
        </div>
        <div className="muted" style={{ fontSize: ".82rem", marginTop: 8 }}>
          Le quadrant qui coûte le plus cher est <em>Chance</em> : un mauvais process qui a payé est celui qu'on répète.
        </div>
      </section>

      {/* Calendrier — P&L réalisé par jour */}
      {parJour.length > 0 && (
        <section className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Calendrier — P&L par jour</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {parJour.slice(0, 30).map(([day, pnl]) => (
              <div key={day} className="between" style={{ fontSize: ".9rem" }}>
                <span className="muted">{day}</span>
                <span style={{ fontWeight: 600, whiteSpace: "nowrap", color: pnl > 0 ? "var(--gain)" : pnl < 0 ? "var(--loss)" : "var(--muted)" }}>
                  {pnl > 0 ? "+" : ""}{pnl.toFixed(2)} {cur}
                </span>
              </div>
            ))}
          </div>
          {parJour.length > 30 && (
            <div className="muted" style={{ fontSize: ".8rem", marginTop: 6 }}>30 jours les plus récents.</div>
          )}
        </section>
      )}

      {all.length === 0 && (
        <div className="card muted">Rien à analyser pour l'instant — écris des idées et importe tes trades.</div>
      )}
    </main>
  );
}
