import Link from "next/link";
import { redirect } from "next/navigation";
import {
  analysisRows,
  dailyPnlRealise,
  dailyReturns,
  dailyReturnsFromRows,
  dealCurve,
  Decimal,
  decisionMatrix,
  Direction,
  drawdown,
  equitySeries,
  evaluate,
  expectancyOfRows,
  ideasCorrectRate,
  outcomeBreakdown,
  Quadrant,
  scopeToAccount,
  sharpe,
  sortino,
  SpecBook,
  thesisLines,
  Unit,
} from "@releve/core";
import { convictionCalibration } from "@releve/core";
import { currentUser, openStore } from "../journal/data";
import { activeScope } from "../settings/data";
import { CalibrationChart, CumulativeCurve, EquityCurve, RHistogram } from "../components/charts";

const JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
const MOIS = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow bar" style={{ marginTop: 26 }}>{children}</div>;
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  const color = tone === "gain" ? "var(--gain)" : tone === "loss" ? "var(--loss)" : tone === "warn" ? "var(--warn)" : "var(--ink)";
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 116 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div className="stat" style={{ color }}>{value}</div>
      {sub && <div className="note" style={{ marginTop: "auto", paddingTop: 6 }}>{sub}</div>}
    </div>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ unit?: string }> }) {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const { unit: unitParam } = await searchParams;
  const unit = unitParam === "idea" ? Unit.IDEA : Unit.THESIS;
  const mot = unit === Unit.THESIS ? "décision(s)" : "idée(s)";

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
  const cur = active?.symbol ?? "$";
  const book = new SpecBook([...loaded.positions.values()]);

  const rows = analysisRows(all, campaigns, unit, book);
  const closed = rows.filter((l) => l.closed_at);
  const exp = expectancyOfRows(rows);
  const pnlNet = closed.reduce((a, l) => a + l.pnl, 0);
  const equityRef = active ? Number(active.start_balance) : 100000;

  const correct = ideasCorrectRate(all);
  const breakdown = outcomeBreakdown(all);
  const dm = decisionMatrix(all, campaigns, unit, book, active ? active.start_balance : null);

  const comp = active ? evaluate(active, all, deals) : null;
  const eq = active ? equitySeries(active, all, deals) : null;
  const lowest = eq?.lowest ?? null;

  const measured = deals.length > 0;
  const rets = measured ? dailyReturns(dealCurve(deals)) : dailyReturnsFromRows(rows, equityRef);
  const sh = sharpe(rets);
  const so = sortino(rets);
  const dd = deals.length ? drawdown(dealCurve(deals)) : null;

  const parJour = dailyPnlRealise(all, deals);
  const theses = thesisLines(all, campaigns, book);
  const running = all.filter((i) => i.is_running);
  const recents = [...all]
    .filter((i) => i.is_executed)
    .sort((a, b) => (b.closed_at?.getTime() ?? 0) - (a.closed_at?.getTime() ?? 0))
    .slice(0, 5);

  // Données des graphiques (SVG)
  const curveSeries = closed.filter((l) => l.r !== null).map((l) => ({ label: l.label, value: l.r as number }));
  const histoBars = [...all]
    .filter((i) => i.is_executed && i.r_multiple(book) !== null)
    .sort((a, b) => (a.closed_at?.getTime() ?? 0) - (b.closed_at?.getTime() ?? 0))
    .map((i) => ({ label: i.display_name, r: (i.r_multiple(book) as Decimal).toNumber(), clean: i.review ? i.discipline_score === 5 : null }));
  const calib = convictionCalibration(all);
  const equityPts = eq ? eq.points.map((p) => ({ balance: p.balance.toNumber() })) : [];

  const money = (x: number | Decimal) => {
    const n = typeof x === "number" ? x : x.toNumber();
    return (n > 0 ? "+" : "") + n.toFixed(2) + " " + cur;
  };
  const rFmt = (x: number | Decimal | null) => {
    if (x === null) return "—";
    const n = typeof x === "number" ? x : x.toNumber();
    return (n > 0 ? "+" : "") + n.toFixed(2) + " R";
  };
  const tone = (n: number) => (n > 0 ? "gain" : n < 0 ? "loss" : "");
  const pct0 = (x: number) => (x * 100).toFixed(0) + " %";

  // Calendrier : grille du mois le plus récent contenant une clôture.
  const calDays = [...parJour.keys()].sort();
  let cal: { y: number; m: number; cells: ({ d: number; pnl: number | null } | null)[]; total: number } | null = null;
  if (calDays.length) {
    const last = calDays[calDays.length - 1]!;
    const [y, m] = last.split("-").map(Number) as [number, number];
    const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells: ({ d: number; pnl: number | null } | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    let total = 0;
    for (let d = 1; d <= nDays; d++) {
      const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const pnl = parJour.has(key) ? parJour.get(key)! : null;
      if (pnl !== null) total += pnl;
      cells.push({ d, pnl });
    }
    cal = { y, m, cells, total };
  }

  return (
    <main className="wrap">
      <header className="between" style={{ marginBottom: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>Tableau de bord</h1>
          <div className="subtitle">{active ? active.label : "aucun compte"} · analyse {unit === Unit.THESIS ? "par thèse" : "par idée"}</div>
        </div>
        <nav className="row" style={{ gap: 14, flexWrap: "wrap" }}>
          <Link href="/journal" className="muted">Journal</Link>
          <Link href="/campaigns" className="muted">Thèses</Link>
          <Link href="/compliance" className="muted">Conformité</Link>
          <Link href="/settings" className="muted">Réglages</Link>
          <form action="/auth/signout" method="post"><button type="submit" className="ghost">Se déconnecter</button></form>
        </nav>
      </header>

      {/* Unité d'analyse */}
      <div className="row muted" style={{ gap: 8, fontSize: ".82rem", marginBottom: 16 }}>
        <span>Unité :</span>
        <Link href="/dashboard?unit=thesis" style={{ fontWeight: unit === Unit.THESIS ? 700 : 400, color: unit === Unit.THESIS ? "var(--accent)" : "var(--muted)" }}>par thèse</Link>
        <span>·</span>
        <Link href="/dashboard?unit=idea" style={{ fontWeight: unit === Unit.IDEA ? 700 : 400, color: unit === Unit.IDEA ? "var(--accent)" : "var(--muted)" }}>par idée</Link>
      </div>

      {all.length === 0 && (
        <div className="card muted">Rien à analyser — écris des idées et importe tes trades.</div>
      )}

      {/* KPI — ce qu'on regarde d'abord */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
        <Kpi label="Gain net" value={money(pnlNet)} tone={tone(pnlNet)} sub={`${closed.length} clôturée(s) · ${((pnlNet / equityRef) * 100).toFixed(2)} %`} />
        {exp ? (
          <>
            <Kpi label="Profit factor" value={exp.profit_factor === Infinity ? "∞" : exp.profit_factor.toFixed(2)} tone={exp.profit_factor > 1.5 ? "gain" : exp.profit_factor < 1 ? "loss" : "warn"} sub={exp.profit_factor > 1.5 ? "sain · > 1.5" : "sous 1.5"} />
            <Kpi label="Win rate" value={pct0(exp.win_rate)} sub={`n=${exp.n} · payoff ${exp.payoff.toFixed(2)}`} />
            <Kpi label="Espérance" value={rFmt(exp.expectancy_r)} tone={tone(exp.expectancy_r)} sub={`par ${mot.replace("(s)", "")}`} />
          </>
        ) : (
          <Kpi label="Espérance" value="—" sub="aucun R calculable" />
        )}
      </section>
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginTop: 10 }}>
        {exp && <Kpi label="Gain moyen" value={rFmt(exp.avg_win_r)} tone="gain" />}
        {exp && <Kpi label="Perte moyenne" value={rFmt(exp.avg_loss_r)} tone="loss" />}
        {sh && <Kpi label="Sharpe" value={sh.value.toFixed(2)} tone={tone(sh.value)} sub={`n=${sh.n} j · ${measured ? "soldes broker" : "reconstitué"}${sh.is_meaningful ? "" : " · peu fiable"}`} />}
        {so && <Kpi label="Sortino" value={so.value.toFixed(2)} tone={tone(so.value)} sub={`n=${so.n} j · ${measured ? "soldes broker" : "reconstitué"}`} />}
        {correct && <Kpi label="Idées correctes" value={correct.rate !== null ? pct0(correct.rate) : "—"} sub={`le marché t'a donné raison · n=${correct.n}`} />}
      </section>

      {/* Courbe de R cumulé (bicolore) */}
      {curveSeries.length > 0 && (
        <>
          <Eyebrow>courbe d'équité · cumul de R</Eyebrow>
          <div className="card">
            <CumulativeCurve series={curveSeries} unit="R" />
            <div className="note" style={{ marginTop: 6 }}>
              Le R cumulé neutralise la taille de position : c'est la courbe de ta <b>compétence</b>,
              pas de ton levier. Vert au-dessus de zéro, rouge en dessous.
            </div>
          </div>
        </>
      )}

      {/* Décision × résultat */}
      <Eyebrow>décision × résultat</Eyebrow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {([[Quadrant.LUCK, "Gain / mauvais process", "luck"], [Quadrant.MASTERY, "Gain / bon process", "mastery"], [Quadrant.ERROR, "Perte / mauvais process", "error"], [Quadrant.VARIANCE, "Perte / bon process", "variance"]] as [Quadrant, string, string][]).map(([q, label, klass]) => {
          const c = dm.get(q);
          return (
            <div key={q} className={`quad ${klass}`}>
              <div className="between"><span className="lab">{label}</span>{c.pct !== null && <span className="lab">{c.pct > 0 ? "+" : ""}{c.pct.toFixed(1)} %</span>}</div>
              <div className="n">{c.n}</div>
              <div className="mono" style={{ fontSize: ".82rem", opacity: 0.85 }}>{money(c.pnl)}</div>
            </div>
          );
        })}
      </div>
      <div className="note" style={{ marginTop: 8 }}>
        {dm.n_reviewed > 0
          ? <>Process discipliné sur <b>{dm.good_process_share !== null ? pct0(dm.good_process_share) : "—"}</b> de tes {mot} relues{dm.n_pending ? ` · ${dm.n_pending} en attente de review` : ""}.</>
          : <>Aucune review : les cases restent vides tant que le process n'est pas jugé. {dm.n_pending} {mot} en attente.</>}
      </div>

      {/* Survie du challenge */}
      {!active ? (
        <div className="banner acc" style={{ marginTop: 26 }}>
          <div><div className="title" style={{ color: "var(--accent)" }}>Configure ton compte</div><div className="note">Sans capital ni règles, pas de marge de survie. <Link href="/settings">Renseigner mon challenge →</Link></div></div>
        </div>
      ) : comp ? (
        <>
          <Eyebrow>état du challenge · {active.label}</Eyebrow>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            <Kpi label="Solde" value={comp.balance.toFixed(2) + " " + cur} />
            <Kpi label="Marge avant échec" value={comp.margin_to_floor.toFixed(2) + " " + cur} tone={comp.margin_to_floor.gt(0) ? "gain" : "loss"} sub={`plancher ${comp.floor.toFixed(0)} ${cur}`} />
            <Kpi label={`Drawdown (limite ${comp.drawdown_limit_pct.toFixed(0)} %)`} value={comp.drawdown_pct.toFixed(2) + " %"} tone={comp.drawdown_pct.lt(comp.drawdown_limit_pct) ? "" : "loss"} />
            {lowest && <Kpi label="Plus-bas touché" value={lowest.toFixed(2) + " " + cur} />}
            {dd && <Kpi label="Drawdown max" value={"-" + dd.max_dd_pct.toFixed(2) + " %"} tone="loss" sub={`${dd.max_dd_abs.toFixed(0)} ${cur} · après chaque transaction`} />}
          </section>
          {measured && equityPts.length >= 2 && (
            <div className="card" style={{ marginTop: 10 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>courbe de solde</div>
              <EquityCurve points={equityPts} />
            </div>
          )}
          {(comp.breached.length > 0 || (lowest && lowest.lt(comp.floor))) && (
            <div className="banner loss" style={{ marginTop: 10 }}>
              <div>
                <div className="title">Alerte</div>
                <div className="note">
                  {comp.breached.length > 0 && <>Règle(s) enfreinte(s) : {comp.breached.map((c) => c.label).join(", ")}. </>}
                  {lowest && lowest.lt(comp.floor) && <>Le plus-bas est passé sous le plancher : sur ces données, le challenge aurait été perdu.</>}
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* Calendrier */}
      {cal && (
        <>
          <Eyebrow>le mois, jour par jour · {MOIS[cal.m]} {cal.y}</Eyebrow>
          <div className="cal" style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 }}>
            {JOURS.map((j) => <div key={j} className="cal-head" style={{ fontFamily: "var(--font-mono)", fontSize: ".64rem", letterSpacing: ".09em", textTransform: "uppercase", color: "var(--muted)", textAlign: "center" }}>{j}</div>)}
            {cal.cells.map((cell, i) => {
              if (!cell) return <div key={i} />;
              const klass = cell.pnl === null ? "" : cell.pnl > 0 ? "gain" : cell.pnl < 0 ? "loss" : "flat";
              const bg = klass === "gain" ? "var(--gain-soft)" : klass === "loss" ? "var(--loss-soft)" : klass === "flat" ? "var(--signal-soft)" : "rgba(233,239,247,.02)";
              const col = klass === "gain" ? "var(--gain)" : klass === "loss" ? "var(--loss)" : klass === "flat" ? "var(--signal)" : "var(--muted)";
              return (
                <div key={i} style={{ border: "1px solid var(--rule-soft)", borderRadius: 8, minHeight: 58, padding: "6px 8px", display: "flex", flexDirection: "column", justifyContent: "space-between", background: bg }}>
                  <span className="num" style={{ fontSize: ".70rem", color: klass ? col : "var(--muted)" }}>{cell.d}</span>
                  {cell.pnl !== null && <span className="num" style={{ fontSize: ".76rem", fontWeight: 600, textAlign: "right", color: col }}>{(cell.pnl > 0 ? "+" : "") + cell.pnl.toFixed(0)}</span>}
                </div>
              );
            })}
          </div>
          <div className="note" style={{ marginTop: 8 }}>
            Total du mois : <b className={tone(cal.total) === "gain" ? "txt-gain" : tone(cal.total) === "loss" ? "txt-loss" : "txt-sig"}>{money(cal.total)}</b>. Seuls les jours de clôture sont colorés — un jour sans sortie n'est pas un jour à zéro.
          </div>
        </>
      )}

      {/* Trades en cours */}
      {running.length > 0 && (
        <>
          <Eyebrow>{running.length} trade(s) en cours</Eyebrow>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="t" style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: ".85rem" }}>
              <thead><tr>{["symbole", "sens", "ticket", "entrée", "stop", "ouvert"].map((h) => <th key={h} style={{ textAlign: "left", color: "var(--muted)", fontSize: ".66rem", letterSpacing: ".09em", textTransform: "uppercase", padding: "10px 14px", borderBottom: "1px solid var(--rule-soft)" }}>{h}</th>)}</tr></thead>
              <tbody>
                {running.flatMap((i) => i.open_trades.map((o) => (
                  <tr key={o.uid}>
                    <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)" }}><Link href={`/journal/${i.id}`} style={{ color: "var(--ink)" }}><b>{o.symbol}</b></Link></td>
                    <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)" }}><span className={`chip ${o.direction === Direction.BUY ? "ok" : "bad"}`}>{o.direction === Direction.BUY ? "long" : "short"}</span></td>
                    <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)", color: "var(--muted)" }}>#{o.ticket}</td>
                    <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)" }}>{o.open_price.toString()}</td>
                    <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)" }}>{o.stop ? o.stop.toString() : "—"}</td>
                    <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)", color: "var(--muted)" }}>{o.open_time.toISOString().slice(0, 10)}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Trades récents */}
      {recents.length > 0 && (
        <>
          <Eyebrow>trades récents</Eyebrow>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="t" style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: ".85rem" }}>
              <thead><tr>{["symbole", "statut", "R engagé", "P&L net"].map((h) => <th key={h} style={{ textAlign: h === "symbole" || h === "statut" ? "left" : "right", color: "var(--muted)", fontSize: ".66rem", letterSpacing: ".09em", textTransform: "uppercase", padding: "10px 14px", borderBottom: "1px solid var(--rule-soft)" }}>{h}</th>)}</tr></thead>
              <tbody>
                {recents.map((i) => {
                  const r = i.r_multiple(book);
                  return (
                    <tr key={i.id}>
                      <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)" }}><Link href={`/journal/${i.id}`} style={{ color: "var(--ink)" }}><b>{i.symbol}</b></Link></td>
                      <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)", color: "var(--muted)" }}>{i.closed_at ? "clôturé · " + i.closed_at.toISOString().slice(0, 10) : "en cours"}</td>
                      <td className={tone(r ? r.toNumber() : 0)} style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)", textAlign: "right", color: r ? (r.gt(0) ? "var(--gain)" : "var(--loss)") : "var(--muted)" }}>{rFmt(r)}</td>
                      <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)", textAlign: "right", color: i.pnl_net.gt(0) ? "var(--gain)" : "var(--loss)" }}>{money(i.pnl_net)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Justesse */}
      {breakdown.correct + breakdown.wrong + breakdown.untested > 0 && (
        <>
          <Eyebrow>justesse — le marché t'a-t-il donné raison ?</Eyebrow>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            <Kpi label="Idées correctes" value={breakdown.correct_rate !== null ? pct0(breakdown.correct_rate) : "—"} tone={breakdown.correct_rate !== null && breakdown.correct_rate >= 0.5 ? "gain" : "loss"} sub={`${breakdown.correct}/${breakdown.judged} tranchée(s)`} />
            <Kpi label="Idées fausses" value={String(breakdown.wrong)} tone={breakdown.wrong ? "loss" : ""} sub="le marché est parti contre" />
            <Kpi label="Non testées" value={String(breakdown.untested)} sub="ni raison, ni tort" />
          </section>
        </>
      )}

      {/* Thèses */}
      {theses.length > 0 && (
        <>
          <Eyebrow>tes thèses</Eyebrow>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="t" style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: ".85rem" }}>
              <thead><tr>{["thèse", "", "instruments", "idées", "R", "P&L net"].map((h, k) => <th key={k} style={{ textAlign: k >= 3 ? "right" : "left", color: "var(--muted)", fontSize: ".66rem", letterSpacing: ".09em", textTransform: "uppercase", padding: "10px 14px", borderBottom: "1px solid var(--rule-soft)" }}>{h}</th>)}</tr></thead>
              <tbody>
                {theses.map((l, k) => (
                  <tr key={k}>
                    <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)" }}>{l.label}</td>
                    <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)" }}><span className={`chip ${l.is_campaign ? "sig" : ""}`}>{l.is_campaign ? "thèse" : "idée seule"}</span></td>
                    <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)", color: "var(--muted)" }}>{l.instruments.join(" · ")}</td>
                    <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)", textAlign: "right" }}>{l.n_ideas}</td>
                    <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)", textAlign: "right", color: l.r_total && l.r_total.gt(0) ? "var(--gain)" : l.r_total && l.r_total.lt(0) ? "var(--loss)" : "var(--muted)" }}>{rFmt(l.r_total)}</td>
                    <td style={{ padding: "10px 14px", borderTop: "1px solid var(--rule-soft)", textAlign: "right", color: l.pnl_net.gt(0) ? "var(--gain)" : "var(--loss)" }}>{money(l.pnl_net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {/* Histogramme : une idée par barre */}
      {histoBars.length > 0 && (
        <>
          <Eyebrow>tes idées, une par barre</Eyebrow>
          <div className="card">
            <RHistogram bars={histoBars} />
            <div className="note" style={{ marginTop: 6 }}>
              Une barre = une idée. <b>Pleine</b> = plan respecté (5/5) · <b>estompée</b> = plan
              dégradé · <b>contour</b> = review à faire.
            </div>
          </div>
        </>
      )}

      {/* Calibration de conviction */}
      {calib.length >= 2 && (
        <>
          <Eyebrow>calibration de conviction</Eyebrow>
          <div className="card">
            <CalibrationChart points={calib} />
            <div className="note" style={{ marginTop: 6 }}>
              Tes convictions élevées surperforment-elles les basses ? Sinon, sizer sur ta conviction,
              c'est sizer sur du bruit.
            </div>
          </div>
        </>
      )}
    </main>
  );
}
