// Métriques — port de core/metrics.py.
//
// Deux principes : l'unité d'analyse est l'IDÉE (pas le ticket), et on affiche
// toujours l'incertitude (taille d'échantillon, IC). Tout est en `number`
// (comme les float Python) : les R viennent d'Idea.r_multiple() en Decimal, on
// les convertit en number au moment de l'agrégation statistique.
import { Decimal } from "./decimal";
import {
  Campaign,
  Deal,
  GOOD_PROCESS_MIN,
  Idea,
  Quadrant,
  RiskSource,
  ThesisOutcome,
} from "./models";

export const TRADING_DAYS = 252;

// --------------------------------------------------------------- stats de base

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  // Écart-type d'ÉCHANTILLON (n-1), comme statistics.stdev en Python.
  //
  // Une série CONSTANTE doit rendre EXACTEMENT 0 (Python le garantit) : sinon
  // l'accumulation flottante laisse un ~1e-18 résiduel, et un Sharpe/Sortino sur
  // volatilité « nulle » sortirait un chiffre géant au lieu d'être indéfini.
  if (new Set(xs).size <= 1) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function medianF(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function numify(x: Decimal | number | null | undefined): number {
  if (x === null || x === undefined) return 0;
  return typeof x === "number" ? x : x.toNumber();
}

/** Jour calendaire UTC "YYYY-MM-DD" (les champs UTC portent l'heure serveur). */
export function dayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------- distribution

export interface Distribution {
  n: number;
  mean: number;
  median: number;
  std: number;
  best: number;
  worst: number;
}

export function distributionOf(xs: number[]): Distribution | null {
  const clean = xs.filter((x) => x !== null && !Number.isNaN(x));
  if (!clean.length) return null;
  return {
    n: clean.length,
    mean: mean(clean),
    median: medianF(clean),
    std: clean.length > 1 ? stdev(clean) : 0,
    best: Math.max(...clean),
    worst: Math.min(...clean),
  };
}

// ------------------------------------------------------------------ expectancy

export interface Expectancy {
  n: number;
  expectancy_r: number;
  win_rate: number;
  avg_win_r: number;
  avg_loss_r: number;
  payoff: number;
  profit_factor: number;
  total_r: number;
}

export function expectancyOf(rMultiples: number[]): Expectancy | null {
  const rs = rMultiples.filter((r) => r !== null && !Number.isNaN(r));
  if (!rs.length) return null;
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const avgW = wins.length ? mean(wins) : 0;
  const avgL = losses.length ? mean(losses) : 0;
  const grossW = wins.reduce((a, b) => a + b, 0);
  const grossL = Math.abs(losses.reduce((a, b) => a + b, 0));
  return {
    n: rs.length,
    expectancy_r: mean(rs),
    win_rate: wins.length / rs.length,
    avg_win_r: avgW,
    avg_loss_r: avgL,
    payoff: avgL ? avgW / Math.abs(avgL) : Infinity,
    profit_factor: grossL ? grossW / grossL : Infinity,
    total_r: rs.reduce((a, b) => a + b, 0),
  };
}

export function rMultiples(ideas: readonly Idea[], onlyReliable = true): number[] {
  const out: number[] = [];
  for (const i of ideas) {
    if (!i.is_executed) continue;
    if (onlyReliable && i.risk_source !== RiskSource.COMPUTED) continue;
    const r = i.r_multiple();
    if (r !== null) out.push(r.toNumber());
  }
  return out;
}

// ------------------------------------------ justesse (le marché a-t-il tranché)

export interface CorrectnessRate {
  n: number;
  n_correct: number;
  rate: number;
}

export function correctnessRateOf(verdicts: (boolean | null)[]): CorrectnessRate | null {
  const tranches = verdicts.filter((v): v is boolean => v !== null);
  if (!tranches.length) return null;
  const nOk = tranches.filter((v) => v).length;
  return { n: tranches.length, n_correct: nOk, rate: nOk / tranches.length };
}

export function ideasCorrectRate(ideas: readonly Idea[]): CorrectnessRate | null {
  return correctnessRateOf(
    ideas
      .filter(
        (i) =>
          i.is_executed &&
          i.review !== null &&
          i.review.thesis_outcome !== ThesisOutcome.UNTESTED,
      )
      .map((i) => i.review!.thesis_outcome === ThesisOutcome.CORRECT),
  );
}

export class OutcomeBreakdown {
  constructor(
    public correct: number,
    public wrong: number,
    public untested: number,
  ) {}
  get judged(): number {
    return this.correct + this.wrong;
  }
  get correct_rate(): number | null {
    return this.judged ? this.correct / this.judged : null;
  }
}

export function outcomeBreakdown(ideas: readonly Idea[]): OutcomeBreakdown {
  const b = new OutcomeBreakdown(0, 0, 0);
  for (const i of ideas) {
    if (!i.is_executed || i.review === null) continue;
    const o = i.review.thesis_outcome;
    if (o === ThesisOutcome.CORRECT) b.correct += 1;
    else if (o === ThesisOutcome.WRONG) b.wrong += 1;
    else b.untested += 1;
  }
  return b;
}

// ------------------------------------------------------------- courbe d'equity

export interface EquityPoint {
  d: string; // jour "YYYY-MM-DD"
  balance: number;
}

export function equityCurve(deals: readonly Deal[]): EquityPoint[] {
  const byDay = new Map<string, number>();
  const sorted = [...deals].sort((a, b) => a.time.getTime() - b.time.getTime());
  for (const d of sorted) byDay.set(dayKey(d.time), d.balance.toNumber());
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([d, balance]) => ({ d, balance }));
}

export function dealCurve(deals: readonly Deal[]): EquityPoint[] {
  return [...deals]
    .sort((a, b) => a.time.getTime() - b.time.getTime())
    .map((d) => ({ d: dayKey(d.time), balance: d.balance.toNumber() }));
}

export function dailyReturns(curve: readonly EquityPoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]!;
    const cur = curve[i]!;
    if (prev.balance) out.push(cur.balance / prev.balance - 1);
  }
  return out;
}

// --------------------------------------------------------------------- ratios

export interface RatioResult {
  value: number;
  n: number;
  ci_low: number | null;
  ci_high: number | null;
  is_meaningful: boolean;
}

export function sharpe(
  returns: readonly number[],
  rfAnnual = 0,
  periods = TRADING_DAYS,
): RatioResult | null {
  const rs = returns.filter((r) => !Number.isNaN(r));
  const n = rs.length;
  if (n < 2) return null;
  const sd = stdev(rs);
  if (sd === 0) return null;

  const rfDaily = rfAnnual / periods;
  const srDaily = (mean(rs) - rfDaily) / sd;
  const sr = srDaily * Math.sqrt(periods);

  const seDaily = Math.sqrt((1 + 0.5 * srDaily ** 2) / n);
  const se = seDaily * Math.sqrt(periods);
  return {
    value: sr,
    n,
    ci_low: sr - 1.96 * se,
    ci_high: sr + 1.96 * se,
    is_meaningful: n >= 30,
  };
}

export function sortino(
  returns: readonly number[],
  marAnnual = 0,
  periods = TRADING_DAYS,
): RatioResult | null {
  const rs = returns.filter((r) => !Number.isNaN(r));
  const n = rs.length;
  if (n < 2) return null;

  const marDaily = marAnnual / periods;
  // downside deviation divisé par n TOTAL (Sortino/Satchell), pas par les seuls
  // jours négatifs.
  const dd = Math.sqrt(rs.reduce((a, r) => a + Math.min(0, r - marDaily) ** 2, 0) / n);
  if (dd === 0) return null;

  const sr = ((mean(rs) - marDaily) / dd) * Math.sqrt(periods);
  return { value: sr, n, ci_low: null, ci_high: null, is_meaningful: n >= 30 };
}

// ---------------------------------------------------------------- drawdown

export interface DrawdownStats {
  max_dd_pct: number;
  max_dd_abs: number;
  avg_dd_pct: number;
  current_dd_pct: number;
  longest_days: number;
  series: [string, number][];
}

export function drawdown(curve: readonly EquityPoint[]): DrawdownStats | null {
  if (!curve.length) return null;

  let peak = curve[0]!.balance;
  const series: [string, number][] = [];
  let maxDd = 0;
  let maxDdAbs = 0;
  let inDd = 0;
  let longest = 0;

  for (const pt of curve) {
    peak = Math.max(peak, pt.balance);
    const dd = peak ? (pt.balance - peak) / peak : 0;
    series.push([pt.d, dd]);
    maxDd = Math.min(maxDd, dd);
    maxDdAbs = Math.max(maxDdAbs, peak - pt.balance);
    if (dd < 0) {
      inDd += 1;
      longest = Math.max(longest, inDd);
    } else {
      inDd = 0;
    }
  }

  const negatives = series.filter(([, d]) => d < 0).map(([, d]) => d);
  return {
    max_dd_pct: Math.abs(maxDd) * 100,
    max_dd_abs: maxDdAbs,
    avg_dd_pct: negatives.length ? Math.abs(mean(negatives)) * 100 : 0,
    current_dd_pct: Math.abs(series[series.length - 1]![1]) * 100,
    longest_days: longest,
    series,
  };
}

// ------------------------------------------- LA matrice thèse × exécution

export interface Cell {
  label: string;
  n: number;
  expectancy_r: number;
  total_r: number;
  expectancy_money: number;
  total_money: number;
}

export interface Matrix {
  clean_correct: Cell;
  dirty_correct: Cell;
  clean_wrong: Cell;
  dirty_wrong: Cell;
  cost_of_indiscipline: number | null;
}

export function thesisExecutionMatrix(
  ideas: readonly Idea[],
  cleanThreshold = 5,
  dirtyThreshold = 3,
): Matrix | null {
  const buckets = new Map<string, [number, number][]>([
    ["true|true", []],
    ["false|true", []],
    ["true|false", []],
    ["false|false", []],
  ]);

  for (const i of ideas) {
    if (!i.is_executed || i.review === null) continue;
    if (i.review.thesis_outcome === ThesisOutcome.UNTESTED) continue;
    const r = i.r_multiple();
    if (r === null) continue;
    const clean = i.review.discipline_score >= cleanThreshold;
    const dirty = i.review.discipline_score <= dirtyThreshold;
    if (!(clean || dirty)) continue; // score 4 : zone grise
    const correct = i.review.thesis_outcome === ThesisOutcome.CORRECT;
    buckets.get(`${clean}|${correct}`)!.push([r.toNumber(), i.pnl_net.toNumber()]);
  }

  if (![...buckets.values()].some((b) => b.length)) return null;

  const cell = (key: string, label: string): Cell => {
    const xs = buckets.get(key)!;
    const rs = xs.map(([r]) => r);
    const ms = xs.map(([, m]) => m);
    return {
      label,
      n: xs.length,
      expectancy_r: rs.length ? mean(rs) : 0,
      total_r: rs.reduce((a, b) => a + b, 0),
      expectancy_money: ms.length ? mean(ms) : 0,
      total_money: ms.reduce((a, b) => a + b, 0),
    };
  };

  const cc = cell("true|true", "Thèse correcte · exécution propre");
  const dc = cell("false|true", "Thèse correcte · exécution dégradée");
  const cw = cell("true|false", "Thèse fausse · exécution propre");
  const dw = cell("false|false", "Thèse fausse · exécution dégradée");

  const cost = cc.n && dc.n ? cc.expectancy_r - dc.expectancy_r : null;
  return { clean_correct: cc, dirty_correct: dc, clean_wrong: cw, dirty_wrong: dw, cost_of_indiscipline: cost };
}

// ------------------------------------------------------ L'UNITÉ D'ANALYSE

export enum Unit {
  THESIS = "these",
  IDEA = "idee",
}

export interface AnalysisRow {
  label: string;
  is_campaign: boolean;
  r: number | null;
  pnl: number;
  closed_at: string | null;
  n_ideas: number;
  reviewed: boolean;
  good_process: boolean | null;
  campaign_id: string | null;
  idea_id: string | null;
}

const won = (l: AnalysisRow): boolean => l.pnl > 0;

export function analysisRows(
  ideas: readonly Idea[],
  campaigns?: Map<string, Campaign> | null,
  unit: Unit = Unit.THESIS,
  specBook?: unknown,
): AnalysisRow[] {
  const camps = campaigns ?? new Map<string, Campaign>();
  const sb = (specBook ?? null) as null;
  const executees = ideas.filter((i) => i.is_executed);
  const lignes: AnalysisRow[] = [];
  const vues = new Set<Idea>();

  if (unit === Unit.THESIS) {
    for (const [cid, camp] of camps) {
      if (camp.abandoned) continue;
      const membres = executees.filter((i) => i.campaign_id === cid);
      if (!membres.length) continue;
      for (const i of membres) vues.add(i);
      const rs = membres.map((i) => i.r_multiple(sb));
      const relues = membres.filter((i) => i.review !== null);
      const closedDays = membres.map((i) => i.closed_at).filter((d): d is Date => d !== null).map(dayKey);
      lignes.push({
        label: camp.display_name,
        is_campaign: true,
        r: rs.length && rs.every((r) => r !== null) ? rs.reduce((a, r) => a.plus(r as Decimal), new Decimal(0)).toNumber() : null,
        pnl: membres.reduce((a, i) => a + i.pnl_net.toNumber(), 0),
        closed_at: closedDays.length ? closedDays.reduce((a, b) => (a > b ? a : b)) : null,
        n_ideas: membres.length,
        reviewed: relues.length > 0 && relues.length === membres.length,
        good_process:
          relues.length && relues.length === membres.length
            ? relues.every((i) => i.review!.discipline_score >= GOOD_PROCESS_MIN)
            : null,
        campaign_id: cid,
        idea_id: null,
      });
    }
  }

  for (const i of executees) {
    if (vues.has(i)) continue;
    const r = i.r_multiple(sb);
    lignes.push({
      label: i.display_name,
      is_campaign: false,
      r: r !== null ? r.toNumber() : null,
      pnl: i.pnl_net.toNumber(),
      closed_at: i.closed_at ? dayKey(i.closed_at) : null,
      n_ideas: 1,
      reviewed: i.review !== null,
      good_process: i.review ? i.review.discipline_score >= GOOD_PROCESS_MIN : null,
      campaign_id: null,
      idea_id: i.id,
    });
  }

  return lignes.sort((a, b) => {
    const ka = a.closed_at ?? "";
    const kb = b.closed_at ?? "";
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export function expectancyOfRows(rows: readonly AnalysisRow[]): Expectancy | null {
  return expectancyOf(rows.filter((l) => l.r !== null).map((l) => l.r as number));
}

export function pctResults(rows: readonly AnalysisRow[], equityRef: Decimal | number): number[] {
  const base = numify(equityRef) || 1;
  return rows.map((l) => (l.pnl / base) * 100);
}

export function dailyReturnsFromRows(
  rows: readonly AnalysisRow[],
  startBalance: Decimal | number,
): number[] {
  const parJour = new Map<string, number>();
  for (const l of rows) {
    if (l.closed_at === null) continue;
    parJour.set(l.closed_at, (parJour.get(l.closed_at) ?? 0) + l.pnl);
  }
  let solde = numify(startBalance) || 1;
  const out: number[] = [];
  for (const jour of [...parJour.keys()].sort()) {
    const gain = parJour.get(jour)!;
    if (solde) out.push(gain / solde);
    solde += gain;
  }
  return out;
}

export function dailyPnl(rows: readonly AnalysisRow[]): Map<string, number> {
  const parJour = new Map<string, number>();
  for (const l of rows) {
    if (l.closed_at === null) continue;
    parJour.set(l.closed_at, (parJour.get(l.closed_at) ?? 0) + l.pnl);
  }
  return parJour;
}

export function dailyPnlByTicket(ideas: readonly Idea[]): Map<string, number> {
  const parJour = new Map<string, number>();
  for (const i of ideas) {
    for (const p of i.positions) {
      const j = dayKey(p.close_time);
      parJour.set(j, (parJour.get(j) ?? 0) + p.pnl_net.toNumber());
    }
  }
  return parJour;
}

export function dailyPnlRealise(
  ideas: readonly Idea[],
  deals: readonly Deal[] = [],
): Map<string, number> {
  const sorties = deals.filter((d) => d.entry === "out" && d.is_trading);
  if (sorties.length) {
    const parJour = new Map<string, number>();
    for (const d of sorties) {
      const j = dayKey(d.time);
      const net = d.profit.plus(d.commission).plus(d.swap).toNumber();
      parJour.set(j, (parJour.get(j) ?? 0) + net);
    }
    return parJour;
  }
  return dailyPnlByTicket(ideas);
}

// --------------------------------------------- LA matrice décision × résultat

export interface QuadrantCell {
  quadrant: Quadrant;
  label: string;
  n: number;
  total_r: number;
  pnl: number;
  pct: number | null;
}

const QUADRANT_LABELS: Record<string, string> = {
  [Quadrant.MASTERY]: "Gain / bon process",
  [Quadrant.LUCK]: "Gain / mauvais process",
  [Quadrant.ERROR]: "Perte / mauvais process",
  [Quadrant.VARIANCE]: "Perte / bon process",
};

export class DecisionMatrix {
  constructor(
    readonly cells: Map<Quadrant, QuadrantCell>,
    readonly n_reviewed: number,
    readonly n_pending: number,
  ) {}
  get(q: Quadrant): QuadrantCell {
    return this.cells.get(q)!;
  }
  get good_process_share(): number | null {
    if (!this.n_reviewed) return null;
    const bons = this.cells.get(Quadrant.MASTERY)!.n + this.cells.get(Quadrant.VARIANCE)!.n;
    return bons / this.n_reviewed;
  }
}

export function decisionMatrix(
  ideas: readonly Idea[],
  campaigns?: Map<string, Campaign> | null,
  unit: Unit = Unit.IDEA,
  specBook?: unknown,
  equityRef?: Decimal | number | null,
): DecisionMatrix {
  const rows = analysisRows(ideas, campaigns, unit, specBook);
  const order = [Quadrant.MASTERY, Quadrant.LUCK, Quadrant.ERROR, Quadrant.VARIANCE];
  const buckets = new Map<Quadrant, AnalysisRow[]>(order.map((q) => [q, []]));
  let pending = 0;

  for (const l of rows) {
    if (!l.reviewed || l.good_process === null) {
      pending += 1;
      continue;
    }
    let q: Quadrant;
    if (won(l)) q = l.good_process ? Quadrant.MASTERY : Quadrant.LUCK;
    else q = l.good_process ? Quadrant.VARIANCE : Quadrant.ERROR;
    buckets.get(q)!.push(l);
  }

  const base = equityRef ? numify(equityRef) : 0;
  const cells = new Map<Quadrant, QuadrantCell>();
  for (const q of order) {
    const lst = buckets.get(q)!;
    const pnl = lst.reduce((a, l) => a + l.pnl, 0);
    cells.set(q, {
      quadrant: q,
      label: QUADRANT_LABELS[q]!,
      n: lst.length,
      total_r: lst.filter((l) => l.r !== null).reduce((a, l) => a + (l.r as number), 0),
      pnl,
      pct: base ? (pnl / base) * 100 : null,
    });
  }

  const nReviewed = [...cells.values()].reduce((a, c) => a + c.n, 0);
  return new DecisionMatrix(cells, nReviewed, pending);
}

// ---------------------------------------------------------------- calibration

export interface CalibrationPoint {
  conviction: number;
  n: number;
  expectancy_r: number;
}

export function convictionCalibration(ideas: readonly Idea[]): CalibrationPoint[] {
  const byConv = new Map<number, number[]>();
  for (const i of ideas) {
    if (!i.is_executed || i.thesis === null || i.thesis.conviction === null) continue;
    const r = i.r_multiple();
    if (r === null) continue;
    const arr = byConv.get(i.thesis.conviction) ?? [];
    arr.push(r.toNumber());
    byConv.set(i.thesis.conviction, arr);
  }
  return [...byConv.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([c, v]) => ({ conviction: c, n: v.length, expectancy_r: mean(v) }));
}
