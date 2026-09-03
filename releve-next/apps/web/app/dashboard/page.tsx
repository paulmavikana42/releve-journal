import Link from "next/link";
import { redirect } from "next/navigation";
import {
  analysisRows,
  availablePeriods,
  compute as challengeCompute,
  convictionCalibration,
  dailyPnlRealise,
  dailyReturns,
  dailyReturnsFromRows,
  dealCurve,
  dealsIn,
  Decimal,
  decisionMatrix,
  Direction,
  drawdown,
  equityCurve,
  expectancyOfRows,
  ideasIn,
  outcomeBreakdown,
  pctResults,
  Period,
  Quadrant,
  scopeToAccount,
  sharpe,
  sortino,
  SpecBook,
  thesisExecutionMatrix,
  thesisLines,
  Unit,
} from "@releve/core";
import { currentUser, openStore } from "../journal/data";
import { activeScope } from "../settings/data";
import { CalibrationChart, CumulativeCurve, RHistogram } from "../components/charts";
import CalendarGrid from "../components/CalendarGrid";

const JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
const MOIS = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_COURT = ["", "janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];

// Verdict décision × résultat, une pastille (miroir de ui.QUADRANTS).
const QUADRANTS: Record<string, [string, string, string]> = {
  [Quadrant.MASTERY]: ["Maîtrise", "ok", "✓"],
  [Quadrant.LUCK]: ["Chance", "bad", "⚠"],
  [Quadrant.ERROR]: ["Erreur", "bad", "✗"],
  [Quadrant.VARIANCE]: ["Aléa OK", "sig", "↺"],
  [Quadrant.PENDING]: ["en attente", "sig", "⧖"],
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow bar" style={{ marginTop: 26 }}>{children}</div>;
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  const color = tone === "gain" ? "var(--gain)" : tone === "loss" ? "var(--loss)" : tone === "warn" ? "var(--warn)" : tone === "none" ? "var(--muted)" : "var(--ink)";
  return (
    <div className="card kpi">
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div className="stat" style={{ color }}>{value}</div>
      {sub && <div className="note">{sub}</div>}
    </div>
  );
}

function Rule() {
  return <hr className="rule" />;
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; mesure?: string; matrice?: string; courbe?: string; periode?: string }>;
}) {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const unit = sp.unit === "idea" ? Unit.IDEA : Unit.THESIS;
  const enPct = sp.mesure === "pct";
  const matrice = sp.matrice === "pct" ? "pct" : sp.matrice === "r" ? "r" : "argent";
  const courbeSel = sp.courbe === "pct" ? "pct" : sp.courbe === "argent" ? "argent" : "r";
  const mot = unit === Unit.THESIS ? "décision(s)" : "idée(s)";
  const motUnite = mot.replace("(s)", "");

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
  const equityRef = active ? Number(active.start_balance) : 100000;
  const startBal = active ? active.start_balance : new Decimal(100000);

  // --- période : mois le plus récent par défaut, ou celle demandée dans l'URL.
  const periods = availablePeriods(all);
  let period: Period = periods[0] ?? new Period();
  if (sp.periode === "all") period = new Period();
  else if (sp.periode && /^\d{4}-\d{1,2}$/.test(sp.periode)) {
    const [py, pm] = sp.periode.split("-").map(Number);
    period = new Period(py!, pm!);
  }
  const periodeKey = period.is_all ? "all" : `${period.year}-${period.month}`;

  const ideasP = ideasIn(all, period);
  const dealsP = dealsIn(deals, period);

  // --- helpers de format (miroir de ui.py) --------------------------------
  const num = (x: number | Decimal): number => (typeof x === "number" ? x : x.toNumber());
  // Séparateur de milliers INSÉCABLE + espace insécable avant la devise :
  // « +1 516.48 $ » ne se coupe jamais en fin de colonne (comme Streamlit).
  const grp = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const fmtMoney = (x: number | Decimal): string => {
    const n = num(x);
    const [ip, dp] = Math.abs(n).toFixed(2).split(".");
    return (n < 0 ? "-" : "+") + grp(ip!) + "." + dp + " " + cur;
  };
  const moneyNP = (x: number | Decimal) => fmtMoney(x).replace(/^\+/, "");
  const floorFmt = (x: number | Decimal) => grp(Math.round(num(x)).toString()) + " " + cur;
  const rFmt = (x: number | Decimal | null): string => {
    if (x === null) return "—";
    const n = num(x);
    // Comme ui.fmt_r (:+.2f) : le signe est TOUJOURS présent, +0.00 compris.
    return (n < 0 ? "" : "+") + n.toFixed(2) + " R";
  };
  const pctFmt = (x: number) => (x > 0 ? "+" : "") + x.toFixed(2) + " %";
  const pct0 = (x: number) => (x * 100).toFixed(0) + " %";
  const tone = (n: number) => (n > 0 ? "gain" : n < 0 ? "loss" : "none");
  const resR = (r: number, p: number) => (enPct ? pctFmt(p) : rFmt(r));
  const fmtDay = (d: Date | null) => (d ? `${d.getUTCDate()} ${MOIS_COURT[d.getUTCMonth() + 1]}` : "—");

  // --- chiffres (sur la période) -----------------------------------------
  const rows = analysisRows(ideasP, campaigns, unit, book);
  const closed = rows.filter((l) => l.closed_at);
  const nGroupes = rows.filter((l) => l.is_campaign).length;
  const exp = expectancyOfRows(rows);
  const pnlNet = closed.reduce((a, l) => a + l.pnl, 0);
  const pcts = pctResults(closed, equityRef);
  const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const gainsPct = pcts.filter((p) => p > 0);
  const pertesPct = pcts.filter((p) => p <= 0);
  const pctMean = meanOf(pcts);

  const breakdown = outcomeBreakdown(ideasP);
  const dm = decisionMatrix(ideasP, campaigns, unit, book, startBal);

  const measured = deals.length > 0;
  // Sharpe/Sortino : returns par JOUR (equityCurve agrège au jour, comme Streamlit),
  // pas par deal — sinon n et valeurs diffèrent.
  const rets = measured ? dailyReturns(equityCurve(deals)) : dailyReturnsFromRows(rows, equityRef);
  const sh = sharpe(rets);
  const so = sortino(rets);

  const state = challengeCompute(deals, period);
  const dd = deals.length ? drawdown(dealCurve(dealsP)) : null;

  const parJour = dailyPnlRealise(ideasP, dealsP);
  const theses = thesisLines(ideasP, campaigns, book);
  const running = all.filter((i) => i.is_running);
  const recents = [...ideasP]
    .filter((i) => i.is_executed)
    .sort((a, b) => (b.closed_at?.getTime() ?? b.opened_at?.getTime() ?? 0) - (a.closed_at?.getTime() ?? a.opened_at?.getTime() ?? 0))
    .slice(0, 5);

  // --- graphiques ---------------------------------------------------------
  const closedSorted = [...closed].sort((a, b) => (a.closed_at ?? "").localeCompare(b.closed_at ?? ""));
  const curveRows = courbeSel === "r" ? closedSorted.filter((l) => l.r !== null) : closedSorted;
  const curveSeries = curveRows.map((l) => ({
    label: l.label,
    value: courbeSel === "r" ? (l.r as number) : courbeSel === "pct" ? (equityRef ? (l.pnl / equityRef) * 100 : 0) : l.pnl,
  }));
  const ddmm = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : "");
  const curveXLabels = curveRows.map((l) => ddmm(l.closed_at));
  const dayNum = (s: string | null) => (s ? Math.floor(Date.parse(s + "T00:00:00Z") / 86400000) : 0);
  const curveXValues = curveRows.map((l) => dayNum(l.closed_at));
  const histoIdeas = [...ideasP]
    .filter((i) => i.is_executed && i.r_multiple(book) !== null)
    .sort((a, b) => (a.opened_at?.getTime() ?? 0) - (b.opened_at?.getTime() ?? 0));
  const histoBars = histoIdeas.map((i) => ({ label: i.display_name, r: (i.r_multiple(book) as Decimal).toNumber(), clean: i.review ? i.discipline_score === 5 : null, href: `/journal/${i.id}` }));
  const histoXLabels = histoIdeas.map((i) => (i.opened_at ? `${String(i.opened_at.getUTCDate()).padStart(2, "0")}/${String(i.opened_at.getUTCMonth() + 1).padStart(2, "0")}` : ""));
  const calib = convictionCalibration(ideasP);
  const tem = thesisExecutionMatrix(ideasP);
  const nReviewed = ideasP.filter((i) => i.review !== null).length;

  // --- calendrier ---------------------------------------------------------
  const calDays = [...parJour.keys()].sort();
  let cal: { y: number; m: number; cells: ({ d: number; pnl: number | null } | null)[]; total: number; verts: number; rouges: number } | null = null;
  if (calDays.length) {
    const target = period.is_all ? calDays[calDays.length - 1]! : `${period.year}-${String(period.month).padStart(2, "0")}`;
    const [y, m] = period.is_all ? (target.split("-").map(Number) as [number, number]) : [period.year!, period.month!];
    const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells: ({ d: number; pnl: number | null } | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    let total = 0, verts = 0, rouges = 0;
    for (let d = 1; d <= nDays; d++) {
      const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const pnl = parJour.has(key) ? parJour.get(key)! : null;
      if (pnl !== null) {
        total += pnl;
        if (pnl > 0) verts++;
        else if (pnl < 0) rouges++;
      }
      cells.push({ d, pnl });
    }
    cal = { y, m, cells, total, verts, rouges };
  }

  // --- construction des liens d'options (préserve tous les paramètres) -----
  const params = { unit: unit === Unit.IDEA ? "idea" : "thesis", mesure: enPct ? "pct" : "r", matrice, courbe: courbeSel, periode: periodeKey };
  const qp = (o: Partial<typeof params>) => {
    const p = { ...params, ...o };
    return `/dashboard?unit=${p.unit}&mesure=${p.mesure}&matrice=${p.matrice}&courbe=${p.courbe}&periode=${p.periode}`;
  };

  const noteUnite =
    unit === Unit.THESIS
      ? nGroupes > 0
        ? <>Les chiffres ci-dessous comptent <b>une thèse macro comme une seule décision</b> : {nGroupes} thèse(s) regroupant plusieurs idées, plus les idées autonomes. Le R d&apos;une thèse est la somme des R de ses jambes.</>
        : <>Les chiffres ci-dessous comptent <b>une thèse macro comme une seule décision</b>. Tu n&apos;en as aucune pour l&apos;instant : chaque idée compte donc pour elle-même, et les deux modes donnent le même résultat.</>
      : <>Les chiffres ci-dessous comptent <b>chaque idée séparément</b>, y compris les jambes d&apos;une même thèse macro. Utile pour juger l&apos;exécution instrument par instrument ; trompeur pour juger ton edge, puisqu&apos;un seul pari joué sur trois instruments compte alors trois fois.</>;

  return (
    <main className="wrap">
      <header>
        <h1 style={{ margin: 0 }}>Tableau de bord</h1>
        <div className="subtitle">{(active ? active.label + " · " : "") + period.label}</div>
      </header>

      {/* Comment on compte : 3 choix annoncés, jamais devinés */}
      <div className="optrow">
        <OptGroup label="Unité d'analyse" help="Une thèse macro jouée sur trois instruments est UNE décision. La compter trois fois triplerait ton échantillon.">
          <Pill href={qp({ unit: "thesis" })} on={unit === Unit.THESIS}>Par thèse (recommandé)</Pill>
          <Pill href={qp({ unit: "idea" })} on={unit === Unit.IDEA}>Par idée</Pill>
        </OptGroup>
        <OptGroup label="Mesure" help="Le R mesure ton edge en neutralisant la taille. Le pourcentage mesure ce que ça a fait au compte.">
          <Pill href={qp({ mesure: "r" })} on={!enPct}>En R</Pill>
          <Pill href={qp({ mesure: "pct" })} on={enPct}>En %</Pill>
        </OptGroup>
        <OptGroup label="Matrice en" help="Sous le nombre de trades de chaque case : ce qu'elle t'a coûté ou rapporté.">
          <Pill href={qp({ matrice: "argent" })} on={matrice === "argent"}>Argent</Pill>
          <Pill href={qp({ matrice: "pct" })} on={matrice === "pct"}>%</Pill>
          <Pill href={qp({ matrice: "r" })} on={matrice === "r"}>R</Pill>
        </OptGroup>
      </div>
      <div className="note" style={{ margin: "2px 0 14px" }}>{noteUnite}</div>

      {/* 1. LES CHIFFRES — 4 × 2, une seule grille pour que TOUTES les tuiles
          aient exactement la même taille (rangées 1fr sur l'ensemble). */}
      <section className="kpigrid">
        <Kpi label="Gain net" value={fmtMoney(pnlNet)} tone={tone(pnlNet)} sub={`${closed.length} clôturée(s) · ${((pnlNet / equityRef) * 100 > 0 ? "+" : "") + ((pnlNet / equityRef) * 100).toFixed(2)} %`} />
        {exp ? (
          <Kpi label="Profit factor" value={exp.profit_factor === Infinity ? "∞" : exp.profit_factor.toFixed(2)} tone={exp.profit_factor > 1.5 ? "gain" : exp.profit_factor < 1 ? "loss" : "warn"} sub={exp.profit_factor > 1.5 ? "sain · > 1.5" : "sous 1.5"} />
        ) : (
          <Kpi label="Profit factor" value="—" sub="aucun R calculable" />
        )}
        {exp ? (
          <Kpi label="Win rate" value={pct0(exp.win_rate)} sub={`n=${exp.n} · payoff ${exp.payoff.toFixed(2)}`} />
        ) : (
          <Kpi label="Win rate" value={`${closed.length ? Math.round((closed.filter((l) => l.pnl > 0).length / closed.length) * 100) : 0} %`} sub={`n=${closed.length} · sur le P&L (pas de R)`} />
        )}
        {exp ? (
          <Kpi label="Espérance" value={resR(exp.expectancy_r, pctMean)} tone={tone(enPct ? pctMean : exp.expectancy_r)} sub={`par ${motUnite}`} />
        ) : (
          <Kpi label="Espérance" value="—" sub="aucun stop pré-engagé" />
        )}
        {exp ? (
          <Kpi label="Gain moyen" value={resR(exp.avg_win_r, meanOf(gainsPct))} tone="gain" sub={`sur ${gainsPct.length} ${mot} gagnante(s)`} />
        ) : (
          <Kpi label="Gain moyen" value="—" sub="—" />
        )}
        {exp ? (
          <Kpi label="Perte moyenne" value={resR(exp.avg_loss_r, meanOf(pertesPct))} tone="loss" sub={`sur ${pertesPct.length} ${mot} perdante(s)`} />
        ) : (
          <Kpi label="Perte moyenne" value="—" sub="—" />
        )}
        {sh ? (
          <Kpi label="Sharpe" value={sh.value.toFixed(2)} tone={tone(sh.value)} sub={sh.is_meaningful ? `n=${sh.n} j · ${measured ? "soldes broker" : "reconstitué"}` : `n=${sh.n} j · pas fiable · ${measured ? "soldes broker" : "reconstitué"}`} />
        ) : (
          <Kpi label="Sharpe" value="—" sub="moins de 2 jours de résultats" />
        )}
        {so ? (
          <Kpi label="Sortino" value={so.value.toFixed(2)} tone={tone(so.value)} sub={`n=${so.n} j · ${measured ? "soldes broker" : "reconstitué"}`} />
        ) : (
          <Kpi label="Sortino" value="—" sub="moins de 2 jours de résultats" />
        )}
      </section>

      {/* 2. COURBE DE R CUMULÉ + MATRICE DÉCISION × RÉSULTAT */}
      <div className="split">
        <div>
          <div className="between" style={{ marginBottom: 6 }}>
            <div className="eyebrow bar" style={{ margin: 0 }}>courbe d&apos;équité · cumul</div>
            <div className="row" style={{ gap: 6 }}>
              <Pill href={qp({ courbe: "r" })} on={courbeSel === "r"}>R</Pill>
              <Pill href={qp({ courbe: "pct" })} on={courbeSel === "pct"}>%</Pill>
              <Pill href={qp({ courbe: "argent" })} on={courbeSel === "argent"}>Argent</Pill>
            </div>
          </div>
          {curveSeries.length > 0 ? (
            <>
              <CumulativeCurve series={curveSeries} unit={courbeSel === "r" ? "R" : ""} xLabels={curveXLabels} xValues={curveXValues} />
              <div className="note" style={{ marginTop: 2 }}>
                <b>R</b> et <b>%</b> ne montent pas pareil, et c&apos;est voulu : le <b>R</b> enlève ta taille de position (il mesure ton edge), le <b>%</b> la garde (l&apos;impact réel sur le compte). Ils ne coïncident que si tu risques autant à chaque trade — un gros pari perdant creuse le % bien plus que le R. La hauteur d&apos;un point est un <b>cumul</b>, pas le résultat du seul trade du jour.
              </div>
            </>
          ) : (
            <div className="note">La courbe apparaîtra dès ta première idée clôturée dont le R est calculable. Le R cumulé neutralise ta taille de position : c&apos;est la courbe de ta compétence, pas de ton levier.</div>
          )}
        </div>
        <div>
          <div className="eyebrow bar" style={{ margin: "0 0 6px" }}>décision × résultat</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {([[Quadrant.LUCK, "Gain / mauvais process", "luck"], [Quadrant.MASTERY, "Gain / bon process", "mastery"], [Quadrant.ERROR, "Perte / mauvais process", "error"], [Quadrant.VARIANCE, "Perte / bon process", "variance"]] as [Quadrant, string, string][]).map(([q, label, klass]) => {
              const c = dm.get(q);
              const val = c.n === 0 ? "—" : matrice === "pct" ? (c.pct !== null ? pctFmt(c.pct) : "—") : matrice === "r" ? rFmt(c.total_r) : fmtMoney(c.pnl);
              return (
                <div key={q} className={`quad ${klass}`}>
                  <div className="lab">{label}</div>
                  <div className="n">{c.n}</div>
                  <div className="mono" style={{ fontSize: ".82rem", opacity: 0.85 }}>{val}</div>
                </div>
              );
            })}
          </div>
          <div className="note" style={{ marginTop: 8 }}>
            {dm.good_process_share !== null
              ? <>← process discipliné sur <b>{pct0(dm.good_process_share)}</b> de tes {mot} relues{dm.n_pending ? ` · ${dm.n_pending} en attente de review` : ""}.</>
              : <>Aucune review : les quatre cases restent vides tant que le process n&apos;est pas jugé. {dm.n_pending} {mot} en attente.</>}
          </div>
        </div>
      </div>

      <Rule />

      {/* 2 bis. LE CALENDRIER */}
      <div className="eyebrow bar">le mois, jour par jour</div>
      {cal ? (
        <>
          <div style={{ marginBottom: 10 }}>
            <PeriodSelect periods={periods} current={periodeKey} qp={qp} />
          </div>
          <CalendarGrid
            cells={cal.cells.map((cell) =>
              cell === null
                ? null
                : {
                    d: cell.d,
                    klass: cell.pnl === null ? "" : cell.pnl > 0 ? "gain" : cell.pnl < 0 ? "loss" : "flat",
                    montant: cell.pnl === null ? null : enPct ? pctFmt((cell.pnl / equityRef) * 100) : fmtMoney(cell.pnl),
                  },
            )}
          />
          <div className="note" style={{ marginTop: 8 }}>
            <b className={cal.total > 0 ? "txt-gain" : cal.total < 0 ? "txt-loss" : "txt-sig"}>{fmtMoney(cal.total)}</b> sur le mois · <span className="txt-gain">{cal.verts} jour(s) vert(s)</span> · <span className="txt-loss">{cal.rouges} rouge(s)</span>. Seuls les jours où de l&apos;argent est réellement tombé sont colorés : un jour sans sortie n&apos;est pas un jour à zéro, c&apos;est un jour où rien n&apos;a été tranché. Une sortie partielle compte le jour où elle a lieu ; la clôture finale porte le <b>reste</b>.
          </div>
        </>
      ) : (
        <div className="note">Aucune clôture sur la période.</div>
      )}

      <Rule />

      {/* 3. LES TRADES EN COURS */}
      {running.length > 0 && (
        <>
          <div className="eyebrow bar">{running.length} trade(s) en cours</div>
          <div className="tablewrap">
          <table className="t">
            <thead><tr><th>symbole</th><th>sens</th><th>ticket</th><th className="num">entrée</th><th className="num">stop</th><th>ouvert</th><th className="num">flottant</th></tr></thead>
            <tbody>
              {running.flatMap((i) => i.open_trades.map((o) => {
                const fr = i.floating_r(book);
                return (
                  <tr key={o.uid}>
                    <td><b>{o.symbol}</b></td>
                    <td><span className={`chip ${o.direction === Direction.BUY ? "ok" : "bad"}`}>{o.direction === Direction.BUY ? "long" : "short"}</span></td>
                    <td className="note">#{o.ticket}</td>
                    <td className="num">{o.open_price.toString()}</td>
                    <td className="num">{o.stop ? o.stop.toString() : "—"}</td>
                    <td>{`${String(o.open_time.getUTCDate()).padStart(2, "0")}/${String(o.open_time.getUTCMonth() + 1).padStart(2, "0")} ${String(o.open_time.getUTCHours()).padStart(2, "0")}:${String(o.open_time.getUTCMinutes()).padStart(2, "0")}`}</td>
                    <td className="num warn">{fr !== null ? rFmt(fr) : "—"}</td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
          </div>
          <div className="note" style={{ marginTop: 6 }}>Le flottant vient des cours que <b>tu</b> as saisis, pas d&apos;un flux de prix. Il n&apos;entre dans aucune statistique.</div>
          <Rule />
        </>
      )}

      {/* 4. ÉTAT DU CHALLENGE — survie globale (seulement si des deals broker) */}
      {state && (
        <>
          <div className="eyebrow bar">état du challenge</div>
          <section className="kpigrid">
            <Kpi label="Solde" value={moneyNP(state.balance)} sub={`${state.balance_date ? "au " + String(state.balance_date.getUTCDate()).padStart(2, "0") + "/" + String(state.balance_date.getUTCMonth() + 1).padStart(2, "0") + " · " : ""}dernier trade clos`} />
            <Kpi label="Marge avant échec" value={moneyNP(state.margin_to_floor)} tone={state.survival_tone} sub={`plancher ${floorFmt(state.floor)} · ${state.margin_pct.toFixed(1)} % du compte`} />
            <Kpi label="Drawdown total" value={`-${state.drawdown_from_start_pct.toFixed(2)} %`} tone={state.drawdown_from_start_pct.gt(0) ? "loss" : "none"} sub="depuis 100 000 $ · limite 10 %" />
            {state.period_low !== null && (
              <Kpi label={`Plus bas — ${period.label.split(" ")[0]}`} value={moneyNP(state.period_low)} sub={`pic de repli -${state.peak_drawdown_pct.toFixed(2)} %`} />
            )}
          </section>
          {state.balance_date && (
            <div className="note" style={{ marginTop: 4 }}>Ce solde date de ta dernière clôture — pas de ton solde live. En swing, une position ouverte peut l&apos;avoir fait bouger depuis.</div>
          )}
          {state.survival_tone === "loss" && (
            <div className="card" style={{ borderLeft: "3px solid var(--loss)", marginTop: 10 }}>
              <div className="eyebrow">alerte</div>
              <div className="note">Il te reste <b>{moneyNP(state.margin_to_floor)}</b> avant le plancher de {floorFmt(state.floor)}. Un seul trade mal dimensionné peut suffire.</div>
            </div>
          )}
          <Rule />
        </>
      )}

      {/* 5. TRADES RÉCENTS */}
      <div className="eyebrow bar">trades récents</div>
      {recents.length > 0 ? (
        <div className="tablewrap">
        <table className="t">
          <thead><tr><th>symbole</th><th>décision</th><th>statut</th><th className="num">R engagé</th><th className="num">R compte</th><th className="num">P&L net</th></tr></thead>
          <tbody>
            {recents.map((i) => {
              const r = i.r_multiple(book);
              const rn = active ? i.r_normalized(startBal) : null;
              const [qlabel, qcls, qglyph] = QUADRANTS[i.quadrant] ?? ["—", "", ""];
              return (
                <tr key={i.id}>
                  <td><b>{i.symbol}</b></td>
                  <td><span className={`chip ${qcls}`}>{qglyph} {qlabel}</span></td>
                  <td>Clôturé · {fmtDay(i.closed_at)}</td>
                  <td className={`num ${tone(r ? r.toNumber() : 0)}`}>{rFmt(r)}</td>
                  <td className={`num ${rn ? tone(rn.toNumber()) : ""}`}>{rFmt(rn)}</td>
                  <td className={`num ${tone(i.pnl_net.toNumber())}`}>{fmtMoney(i.pnl_net)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      ) : (
        <div className="note">Aucune idée sur la période.</div>
      )}
      <div className="note" style={{ marginTop: 6 }}><b>R engagé</b> : résultat / risque réel du trade — mesure ton edge. <b>R compte</b> : résultat / risque déclaré en % — mesure l&apos;impact sur le compte.</div>

      {/* 5 bis. JUSTESSE */}
      {breakdown.correct + breakdown.wrong + breakdown.untested > 0 && (
        <>
          <Rule />
          <div className="eyebrow bar">justesse — le marché t&apos;a-t-il donné raison ?</div>
          <section className="grid3">
            <Kpi label="Idées correctes" value={breakdown.correct_rate !== null ? pct0(breakdown.correct_rate) : "—"} tone={breakdown.correct_rate !== null ? (breakdown.correct_rate >= 0.5 ? "gain" : "loss") : "none"} sub={breakdown.judged ? `${breakdown.correct}/${breakdown.judged} idée(s) tranchée(s) par le marché` : "aucune idée encore tranchée"} />
            <Kpi label="Idées fausses" value={String(breakdown.wrong)} tone={breakdown.wrong ? "loss" : "none"} sub="le marché est parti contre ta lecture" />
            <Kpi label="Idées non testées" value={String(breakdown.untested)} sub="sorti avant que le marché tranche — ni raison, ni tort" />
          </section>
          <div className="note" style={{ marginTop: 6 }}>On juge ta <b>lecture</b>, pas ton P&L : une idée juste mal exécutée reste juste. « <b>Non testée</b> » (sortie au breakeven, stop de bruit, gains pris tôt) ne compte pas dans le taux — le marché n&apos;a pas eu l&apos;occasion de te répondre.</div>
        </>
      )}

      {/* 6. TES THÈSES */}
      <Rule />
      <div className="eyebrow bar">tes thèses</div>
      {theses.length > 0 ? (
        <div className="tablewrap">
        <table className="t">
          <thead><tr><th>thèse</th><th></th><th>instruments</th><th className="num">idées</th><th className="num">R</th><th className="num">P&L net</th></tr></thead>
          <tbody>
            {theses.map((l, k) => (
              <tr key={k}>
                <td>{l.label}</td>
                <td><span className={`chip ${l.is_campaign ? "sig" : ""}`}>{l.is_campaign ? "thèse" : "idée seule"}</span></td>
                <td className="note">{l.instruments.join(" · ")}</td>
                <td className="num">{l.n_ideas}</td>
                <td className={`num ${l.r_total ? tone(l.r_total.toNumber()) : ""}`}>{rFmt(l.r_total)}</td>
                <td className={`num ${tone(l.pnl_net.toNumber())}`}>{fmtMoney(l.pnl_net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : (
        <div className="note">Aucune thèse sur la période.</div>
      )}
      {theses.length > 0 && (
        <div className="note" style={{ marginTop: 6 }}>Total : <b>{fmtMoney(theses.reduce((a, l) => a + l.pnl_net.toNumber(), 0))}</b>. Le R d&apos;une thèse est la <b>somme</b> des R de ses idées. Une idée sans thèse compte pour elle-même.</div>
      )}

      {/* 7. QUALITÉ DU DRAWDOWN — seulement si des deals broker */}
      {dd && (
        <>
          <Rule />
          <div className="eyebrow bar">qualité du drawdown</div>
          <section className="grid2">
            <Kpi label="Drawdown max" value={`-${dd.max_dd_pct.toFixed(2)} %`} tone={dd.max_dd_pct ? "loss" : "none"} sub={`${floorFmt(dd.max_dd_abs)} · mesuré après chaque transaction`} />
            <Kpi label="Drawdown moyen" value={`-${dd.avg_dd_pct.toFixed(2)} %`} sub="profondeur habituelle de tes creux" />
          </section>
        </>
      )}

      <Rule />

      {/* histogramme : une idée par barre */}
      <div className="eyebrow bar">tes idées, une par barre</div>
      <div className="note" style={{ marginBottom: 6 }}>Une barre = une idée. <b>Pleine</b> = plan respecté · <b>hachurée</b> = plan dégradé · <b>contour</b> = review à faire. Clique une barre pour l&apos;ouvrir.</div>
      {histoBars.length > 0 ? <RHistogram bars={histoBars} xLabels={histoXLabels} /> : <div className="note">Aucune idée au R calculable.</div>}

      <Rule />

      {/* métriques d'analyse */}
      <div className="eyebrow bar">analyse{period.label ? ` — ${period.label.toLowerCase()}` : ""}</div>
      {nReviewed === 0 ? (
        <div className="note">Aucune idée revue sur cette portée. Relis tes trades (ou passe la portée sur « Tout l&apos;historique ») pour faire apparaître la matrice.</div>
      ) : (
        <>
          {nReviewed < 30 && (
            <div className="note" style={{ marginBottom: 8 }}>Échantillon encore mince — <b>{nReviewed}</b> idée(s) revue(s) sur cette portée. Les cases sont affichées, mais lis-les avec prudence : il faut du recul pour qu&apos;une matrice dise quelque chose de fiable.</div>
          )}
          <div className="split-a">
            <div>
              <h3 style={{ margin: "0 0 8px" }}>Ton analyse, ou toi ?</h3>
              {tem && (() => {
                const cells = [
                  { bg: "var(--gain-soft)", col: "var(--gain)", tag: "ton vrai edge", verdict: "analyse juste, exécution nette — c'est ça qu'il faut scaler", cell: tem.clean_correct },
                  { bg: "var(--warn-soft)", col: "var(--warn)", tag: "ce que tu laisses sur la table", verdict: "l'analyse était bonne, l'indiscipline a mangé le gain", cell: tem.dirty_correct },
                  { bg: "transparent", col: "var(--muted)", tag: "coût normal du métier", verdict: "process propre, marché contraire — rien à corriger ici", cell: tem.clean_wrong },
                  { bg: "var(--loss-soft)", col: "var(--loss)", tag: "zone rouge", verdict: "mauvaise lecture ET mauvaise exécution — le vrai signal d'alarme", cell: tem.dirty_wrong },
                ];
                const colhead = (t: string) => <div className="eyebrow bar mmeta" style={{ margin: 0, alignSelf: "end", justifyContent: "center", textAlign: "center" }}>{t}</div>;
                const rowlabel = (t: React.ReactNode) => <div className="eyebrow mmeta" style={{ margin: 0, color: "var(--ink)", alignSelf: "center", textAlign: "right" }}>{t}</div>;
                const Cell = ({ c }: { c: typeof cells[number] }) => (
                  <div className="card" style={{ background: c.bg, minHeight: 150, display: "flex", flexDirection: "column", margin: 0 }}>
                    <div className="eyebrow" style={{ margin: 0, color: c.col }}>{c.tag}</div>
                    {c.cell.n === 0 ? <div className="stat none big" style={{ marginTop: 6 }}>—</div> : <div className="stat big" style={{ marginTop: 6, color: c.col }}>{fmtMoney(c.cell.expectancy_money)}</div>}
                    <div className="note" style={{ marginTop: 6 }}>{c.cell.n === 0 ? "aucune donnée sur cette portée" : `moy./idée · n = ${c.cell.n} · total ${fmtMoney(c.cell.total_money)} · ${c.verdict}`}</div>
                  </div>
                );
                return (
                  <>
                    <div className="matrix">
                      <div className="mmeta" />
                      {colhead("exécution propre · 5/5")}
                      {colhead("exécution dégradée · ≤3/5")}
                      {rowlabel(<>idée<br />correcte</>)}
                      <Cell c={cells[0]!} />
                      <Cell c={cells[1]!} />
                      {rowlabel(<>idée<br />fausse</>)}
                      <Cell c={cells[2]!} />
                      <Cell c={cells[3]!} />
                    </div>
                    {tem.cost_of_indiscipline !== null && (
                      <div className="note" style={{ marginTop: 4 }}><b>Le coût d&apos;indiscipline</b> — sur tes idées <b>correctes</b>, passer d&apos;une exécution propre à dégradée te coûte <b className="txt-loss">{tem.cost_of_indiscipline.toFixed(2)} R par idée</b>. Ce n&apos;est pas ton analyse qui te ruine, c&apos;est ta discipline.</div>
                    )}
                    <div className="note" style={{ marginTop: 6 }}><b>La question que ça règle</b> : si la colonne « dégradée » est toujours pire que « propre », ton problème est ta <b>discipline</b>. Si c&apos;est la ligne « fausse » qui domine, révise ta <b>lecture</b> du marché — ton exécution, elle, est déjà bonne.</div>
                  </>
                );
              })()}
            </div>
            <div>
              <h3 style={{ margin: "0 0 8px" }}>Calibration</h3>
              {calib.length >= 2 ? (
                <>
                  <CalibrationChart points={calib} />
                  {calib[calib.length - 1]!.expectancy_r <= calib[0]!.expectancy_r && (
                    <div className="note" style={{ marginTop: 2 }}>Tes idées à conviction {calib[calib.length - 1]!.conviction} ne surperforment pas tes idées à conviction {calib[0]!.conviction}. Si tu sizes sur ta conviction, tu sizes sur du bruit.</div>
                  )}
                </>
              ) : (
                <div className="note">Pas encore assez de convictions déclarées pour comparer.</div>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

// Un groupe d'options (label + aide + pilules).
function OptGroup({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        {label}
        {help && <span title={help} style={{ cursor: "help", marginLeft: 5, opacity: 0.7 }}>ⓘ</span>}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function Pill({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return <Link href={href} className={`pill ${on ? "on" : ""}`}>{children}</Link>;
}

// (helpers de période ci-dessous)

// Le sélecteur de mois du calendrier (liste des périodes disponibles).
function PeriodSelect({ periods, current, qp }: { periods: Period[]; current: string; qp: (o: { periode: string }) => string }) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {periods.map((p) => {
        const key = p.is_all ? "all" : `${p.year}-${p.month}`;
        return <Pill key={key} href={qp({ periode: key })} on={key === current}>{p.label}</Pill>;
      })}
    </div>
  );
}
