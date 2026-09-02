// Pilotage du challenge : périodes mensuelles + survie globale — port de
// core/challenge.py.
//
// Le mois est une LENTILLE posée à la lecture (un seul journal). Un trade
// appartient au mois de sa CLÔTURE. Mais l'alerte de SURVIE est GLOBALE : le
// plancher ne se remet jamais à zéro.
import { Decimal } from "./decimal";
import type { Deal, Idea } from "./models";

export const START_BALANCE = new Decimal("100000");
export const MAX_DRAWDOWN_PCT = new Decimal("10");
export const FLOOR = START_BALANCE.times(new Decimal(1).minus(MAX_DRAWDOWN_PCT.div(100))); // 90 000

const MOIS = [
  "", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
  "septembre", "octobre", "novembre", "décembre",
];

// ---------------------------------------------------------------- périodes

export class Period {
  constructor(
    readonly year: number | null = null,
    readonly month: number | null = null,
  ) {}

  get is_all(): boolean {
    return this.year === null;
  }
  get label(): string {
    if (this.is_all) return "Tout l'historique";
    return `${MOIS[this.month!]} ${this.year}`;
  }
  contains(dt: Date): boolean {
    if (this.is_all) return true;
    return dt.getUTCFullYear() === this.year && dt.getUTCMonth() + 1 === this.month;
  }
}

export function monthOf(dt: Date): Period {
  return new Period(dt.getUTCFullYear(), dt.getUTCMonth() + 1);
}

export function availablePeriods(ideas: readonly Idea[]): Period[] {
  const months = new Set<string>();
  for (const i of ideas) {
    if (i.is_executed && i.closed_at) {
      months.add(`${i.closed_at.getUTCFullYear()}-${i.closed_at.getUTCMonth() + 1}`);
    }
  }
  const parsed = [...months].map((s) => {
    const [y, m] = s.split("-").map(Number);
    return [y!, m!] as [number, number];
  });
  parsed.sort((a, b) => (a[0] !== b[0] ? b[0] - a[0] : b[1] - a[1])); // plus récent d'abord
  return [...parsed.map(([y, m]) => new Period(y, m)), new Period()];
}

export function ideasIn(ideas: readonly Idea[], period: Period): Idea[] {
  return ideas.filter((i) => i.is_executed && i.closed_at && period.contains(i.closed_at));
}

export function dealsIn(deals: readonly Deal[], period: Period): Deal[] {
  return deals.filter((d) => period.contains(d.time));
}

// ---------------------------------------------------------------- challenge

export interface ChallengeState {
  balance: Decimal;
  balance_date: Date | null;
  floor: Decimal;
  margin_to_floor: Decimal;
  margin_pct: Decimal;
  drawdown_from_start_pct: Decimal;
  lowest_ever: Decimal;
  lowest_ever_date: Date | null;
  period_label: string;
  period_low: Decimal | null;
  period_low_date: Date | null;
  peak_drawdown_pct: Decimal;
  survival_tone: string;
}

function survivalTone(marginPct: Decimal): string {
  const p = marginPct.toNumber();
  if (p <= 2) return "loss";
  if (p <= 4) return "warn";
  return "gain";
}

function balanceSeries(deals: readonly Deal[]): [Date, Decimal][] {
  return [...deals].sort((a, b) => a.time.getTime() - b.time.getTime()).map((d) => [d.time, d.balance]);
}

export function compute(allDeals: readonly Deal[], period: Period): ChallengeState | null {
  if (!allDeals.length) return null;

  const glob = balanceSeries(allDeals);

  const balance = glob[glob.length - 1]![1];
  const balanceDate = glob[glob.length - 1]![0];
  const margin = balance.minus(FLOOR);
  const marginPct = margin.div(START_BALANCE).times(100);
  const ddFromStart = START_BALANCE.minus(balance).div(START_BALANCE).times(100);

  let lowestEver = glob[0]![1];
  for (const [, b] of glob) if (b.lt(lowestEver)) lowestEver = b;
  const lowestEverDate = glob.find(([, b]) => b.eq(lowestEver))![0];

  const periodDeals = dealsIn(allDeals, period);
  const pser = periodDeals.length ? balanceSeries(periodDeals) : [];

  let periodLow: Decimal | null = null;
  let periodLowDate: Date | null = null;
  let peakDd = new Decimal(0);
  if (pser.length) {
    periodLow = pser[0]![1];
    for (const [, b] of pser) if (b.lt(periodLow)) periodLow = b;
    periodLowDate = pser.find(([, b]) => b.eq(periodLow!))![0];
    let peak = pser[0]![1];
    for (const [, b] of pser) {
      if (b.gt(peak)) peak = b;
      const dd = peak.isZero() ? new Decimal(0) : peak.minus(b).div(peak).times(100);
      if (dd.gt(peakDd)) peakDd = dd;
    }
  }

  return {
    balance,
    balance_date: balanceDate,
    floor: FLOOR,
    margin_to_floor: margin,
    margin_pct: marginPct,
    drawdown_from_start_pct: ddFromStart,
    lowest_ever: lowestEver,
    lowest_ever_date: lowestEverDate,
    period_label: period.label,
    period_low: periodLow,
    period_low_date: periodLowDate,
    peak_drawdown_pct: peakDd,
    survival_tone: survivalTone(marginPct),
  };
}

// ------------------------------------------- vue « thèses » du tableau de bord

export interface ThesisLine {
  label: string;
  is_campaign: boolean;
  n_ideas: number;
  instruments: string[];
  pnl_net: Decimal;
  r_total: Decimal | null;
  campaign_id: string | null;
  idea_id: string | null;
}

export function thesisLines(
  ideas: readonly Idea[],
  campaigns: Map<string, import("./models").Campaign>,
  specBook?: unknown,
): ThesisLine[] {
  const sb = (specBook ?? null) as null;
  const out: ThesisLine[] = [];
  const used = new Set<Idea>();

  for (const [cid, camp] of campaigns) {
    if (camp.abandoned) continue;
    const membres = ideas.filter((i) => i.campaign_id === cid);
    if (!membres.length) continue;
    for (const i of membres) used.add(i);
    const rs = membres.map((i) => i.r_multiple(sb));
    out.push({
      label: camp.display_name,
      is_campaign: true,
      n_ideas: membres.length,
      instruments: [...new Set(membres.map((i) => i.symbol))].sort(),
      pnl_net: membres.reduce((a, i) => a.plus(i.pnl_net), new Decimal(0)),
      r_total: rs.length && rs.every((r) => r !== null) ? rs.reduce((a, r) => a.plus(r as Decimal), new Decimal(0)) : null,
      campaign_id: cid,
      idea_id: null,
    });
  }

  for (const i of ideas) {
    if (used.has(i)) continue;
    out.push({
      label: i.display_name,
      is_campaign: false,
      n_ideas: 1,
      instruments: [i.symbol],
      pnl_net: i.pnl_net,
      r_total: i.r_multiple(sb),
      campaign_id: null,
      idea_id: i.id,
    });
  }

  return out.sort((a, b) => b.pnl_net.cmp(a.pnl_net));
}
