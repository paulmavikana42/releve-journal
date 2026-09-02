// Compliance prop firm — port de core/prop.py.
//
// Règles CONTRACTUELLES, donc PARAMÉTRABLES par compte (à l'inverse du plancher
// de survie de challenge.ts, global et absolu). L'`uid` interne est la vraie clé
// de cloisonnement : le numéro broker peut être vide ou partagé.
//
// Note de port : accounts()/save_accounts() (adossés au fichier settings.json)
// arrivent avec settings.ts. Ici : la LOGIQUE pure (règles, compliance,
// cloisonnement), entièrement testable sans I/O.
import { Decimal } from "./decimal";
import type { Deal, Idea } from "./models";
import { dayKey } from "./metrics";

const ZERO = new Decimal(0);

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

const MIN_DATE = new Date(Date.UTC(1, 0, 1));

function genId(): string {
  const g = globalThis as unknown as { crypto: { randomUUID(): string } };
  return g.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function decEq(a: Decimal | null, b: Decimal | null): boolean {
  if (a === null || b === null) return a === b;
  return a.eq(b);
}

// ------------------------------------------------------------------ les règles

export interface PropRulesInit {
  uid?: string;
  account_id?: string;
  label?: string;
  broker?: string;
  currency?: string;
  start_balance?: Decimal;
  is_prop?: boolean;
  challenge_type?: string;
  phase?: string;
  daily_loss_pct?: Decimal;
  max_drawdown_pct?: Decimal;
  drawdown_static?: boolean;
  profit_target_pct?: Decimal | null;
  profit_target_p2_pct?: Decimal | null;
  profit_split_pct?: Decimal;
  min_trading_days?: number | null;
  trading_day_rule?: string;
  trading_day_threshold_pct?: Decimal;
  min_days_scope?: string;
  consistency_pct?: Decimal | null;
  warn_at?: Decimal;
}

export class PropRules {
  uid: string;
  account_id: string;
  label: string;
  broker: string;
  currency: string;
  start_balance: Decimal;
  is_prop: boolean;
  challenge_type: string;
  phase: string;
  daily_loss_pct: Decimal;
  max_drawdown_pct: Decimal;
  drawdown_static: boolean;
  profit_target_pct: Decimal | null;
  profit_target_p2_pct: Decimal | null;
  profit_split_pct: Decimal;
  min_trading_days: number | null;
  trading_day_rule: string;
  trading_day_threshold_pct: Decimal;
  min_days_scope: string;
  consistency_pct: Decimal | null;
  warn_at: Decimal;

  constructor(init: PropRulesInit = {}) {
    this.uid = init.uid ?? genId();
    this.account_id = init.account_id ?? "";
    this.label = init.label ?? "FundedNext";
    this.broker = init.broker ?? "";
    this.currency = init.currency ?? "USD";
    this.start_balance = init.start_balance ?? new Decimal("100000");
    this.is_prop = init.is_prop ?? true;
    this.challenge_type = init.challenge_type ?? "two_phase";
    this.phase = init.phase ?? "p1";
    this.daily_loss_pct = init.daily_loss_pct ?? new Decimal("5");
    this.max_drawdown_pct = init.max_drawdown_pct ?? new Decimal("10");
    this.drawdown_static = init.drawdown_static ?? true;
    this.profit_target_pct = init.profit_target_pct === undefined ? new Decimal("8") : init.profit_target_pct;
    this.profit_target_p2_pct = init.profit_target_p2_pct === undefined ? new Decimal("5") : init.profit_target_p2_pct;
    this.profit_split_pct = init.profit_split_pct ?? new Decimal("80");
    this.min_trading_days = init.min_trading_days === undefined ? 3 : init.min_trading_days;
    this.trading_day_rule = init.trading_day_rule ?? "position";
    this.trading_day_threshold_pct = init.trading_day_threshold_pct ?? ZERO;
    this.min_days_scope = init.min_days_scope ?? "challenge";
    this.consistency_pct = init.consistency_pct === undefined ? new Decimal("30") : init.consistency_pct;
    this.warn_at = init.warn_at ?? new Decimal("75");
  }

  get symbol(): string {
    return CURRENCY_SYMBOLS[this.currency] ?? "$";
  }

  get is_funded(): boolean {
    return this.challenge_type === "instant" || this.phase === "funded";
  }

  active_profit_target(): Decimal | null {
    if (this.is_funded) return null;
    if (this.challenge_type === "two_phase" && this.phase === "p2") return this.profit_target_p2_pct;
    return this.profit_target_pct;
  }

  get floor(): Decimal {
    return this.start_balance.times(new Decimal(1).minus(this.max_drawdown_pct.div(100)));
  }

  static from_dict(d: Record<string, unknown>): PropRules {
    const decFields = new Set([
      "start_balance", "daily_loss_pct", "max_drawdown_pct", "profit_target_pct",
      "profit_target_p2_pct", "profit_split_pct", "trading_day_threshold_pct",
      "consistency_pct", "warn_at",
    ]);
    const known = new Set([
      "uid", "account_id", "label", "broker", "currency", "start_balance", "is_prop",
      "challenge_type", "phase", "daily_loss_pct", "max_drawdown_pct", "drawdown_static",
      "profit_target_pct", "profit_target_p2_pct", "profit_split_pct", "min_trading_days",
      "trading_day_rule", "trading_day_threshold_pct", "min_days_scope", "consistency_pct", "warn_at",
    ]);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d ?? {})) {
      if (!known.has(k)) continue; // ex. l'ancien weekend_flat
      if (decFields.has(k)) out[k] = v !== null && v !== undefined ? new Decimal(String(v)) : null;
      else if (k === "min_trading_days") out[k] = v !== null && v !== undefined ? Math.trunc(Number(v)) : null;
      else if (k === "drawdown_static" || k === "is_prop") out[k] = Boolean(v);
      else out[k] = v;
    }
    return new PropRules(out as PropRulesInit);
  }

  to_dict(): Record<string, unknown> {
    const s = (x: Decimal | null): string | null => (x !== null ? x.toString() : null);
    return {
      uid: this.uid,
      account_id: this.account_id,
      label: this.label,
      broker: this.broker,
      currency: this.currency,
      start_balance: this.start_balance.toString(),
      is_prop: this.is_prop,
      challenge_type: this.challenge_type,
      phase: this.phase,
      daily_loss_pct: this.daily_loss_pct.toString(),
      max_drawdown_pct: this.max_drawdown_pct.toString(),
      drawdown_static: this.drawdown_static,
      profit_target_pct: s(this.profit_target_pct),
      profit_target_p2_pct: s(this.profit_target_p2_pct),
      profit_split_pct: this.profit_split_pct.toString(),
      min_trading_days: this.min_trading_days,
      trading_day_rule: this.trading_day_rule,
      trading_day_threshold_pct: this.trading_day_threshold_pct.toString(),
      min_days_scope: this.min_days_scope,
      consistency_pct: s(this.consistency_pct),
      warn_at: this.warn_at.toString(),
    };
  }

  equals(o: PropRules): boolean {
    return (
      this.uid === o.uid &&
      this.account_id === o.account_id &&
      this.label === o.label &&
      this.broker === o.broker &&
      this.currency === o.currency &&
      this.start_balance.eq(o.start_balance) &&
      this.is_prop === o.is_prop &&
      this.challenge_type === o.challenge_type &&
      this.phase === o.phase &&
      this.daily_loss_pct.eq(o.daily_loss_pct) &&
      this.max_drawdown_pct.eq(o.max_drawdown_pct) &&
      this.drawdown_static === o.drawdown_static &&
      decEq(this.profit_target_pct, o.profit_target_pct) &&
      decEq(this.profit_target_p2_pct, o.profit_target_p2_pct) &&
      this.profit_split_pct.eq(o.profit_split_pct) &&
      this.min_trading_days === o.min_trading_days &&
      this.trading_day_rule === o.trading_day_rule &&
      this.trading_day_threshold_pct.eq(o.trading_day_threshold_pct) &&
      this.min_days_scope === o.min_days_scope &&
      decEq(this.consistency_pct, o.consistency_pct) &&
      this.warn_at.eq(o.warn_at)
    );
  }
}

/** rules_for, version pure (les comptes sont passés — settings.ts fournira accounts()). */
export function rulesFor(accountId: string, accts: readonly PropRules[]): PropRules {
  for (const a of accts) if (a.account_id === (accountId || "")) return a;
  return accts[0]!;
}

export function owner_uid(
  obj: { account_id?: string },
  knownUids: Set<string>,
  defaultUid: string,
): string {
  const aid = obj.account_id || "";
  return knownUids.has(aid) ? aid : defaultUid;
}

export function belongs_to(
  idea: { account_id?: string },
  accountId: string,
  defaultAccountId = "",
): boolean {
  return (idea.account_id || defaultAccountId) === accountId;
}

// ------------------------------------------------------------------- la courbe

export interface BalancePoint {
  when: Date;
  balance: Decimal;
}

export class Equity {
  constructor(
    readonly points: BalancePoint[] = [],
    readonly measured = false,
  ) {}

  get last(): Decimal | null {
    return this.points.length ? this.points[this.points.length - 1]!.balance : null;
  }
  get lowest(): Decimal | null {
    if (!this.points.length) return null;
    return this.points.reduce((m, p) => (p.balance.lt(m) ? p.balance : m), this.points[0]!.balance);
  }
  get highest(): Decimal | null {
    if (!this.points.length) return null;
    return this.points.reduce((m, p) => (p.balance.gt(m) ? p.balance : m), this.points[0]!.balance);
  }
  /** Le dernier solde connu AVANT ce jour (clé "YYYY-MM-DD"). */
  before(dayStr: string): Decimal | null {
    let prev: Decimal | null = null;
    for (const p of this.points) {
      if (dayKey(p.when) >= dayStr) break;
      prev = p.balance;
    }
    return prev;
  }
}

export function equitySeries(rules: PropRules, ideas: readonly Idea[], deals: readonly Deal[] = []): Equity {
  const tradings = [...deals]
    .filter((d) => d.balance !== null && d.balance !== undefined)
    .sort((a, b) => a.time.getTime() - b.time.getTime());
  if (tradings.length) {
    return new Equity(
      tradings.map((d) => ({ when: d.time, balance: d.balance })),
      true,
    );
  }
  let solde = rules.start_balance;
  const pts: BalancePoint[] = [{ when: MIN_DATE, balance: solde }];
  const closed = ideas
    .filter((i) => i.is_executed && i.closed_at)
    .sort((a, b) => (a.closed_at as Date).getTime() - (b.closed_at as Date).getTime());
  for (const i of closed) {
    solde = solde.plus(i.pnl_net);
    pts.push({ when: i.closed_at as Date, balance: solde });
  }
  return new Equity(pts, false);
}

// ------------------------------------------------------------------ le verdict

export class Check {
  constructor(
    readonly key: string,
    readonly label: string,
    readonly ok: boolean,
    readonly breached: boolean,
    readonly value: string,
    readonly detail = "",
    readonly pct: number | null = null,
  ) {}

  get tone(): string {
    if (this.breached) return "loss";
    return this.ok ? "gain" : "warn";
  }
}

export class Compliance {
  checks: Check[] = [];
  constructor(
    readonly rules: PropRules,
    readonly equity: Equity,
    readonly balance: Decimal,
    readonly day: string,
    readonly daily_pnl: Decimal,
    readonly daily_pct: Decimal,
    readonly daily_limit_pct: Decimal,
    readonly drawdown_pct: Decimal,
    readonly drawdown_limit_pct: Decimal,
    readonly floor: Decimal,
    readonly margin_to_floor: Decimal,
    readonly profit_pct: Decimal,
    readonly trading_days: number,
    readonly best_day_share: Decimal | null,
    readonly open_symbols: string[],
    readonly daily_allow_amount: Decimal,
    readonly daily_allow_pct: Decimal,
    readonly payout_amount: Decimal | null,
  ) {}

  get breached(): Check[] {
    return this.checks.filter((c) => c.breached);
  }
  get warnings(): Check[] {
    return this.checks.filter((c) => !c.ok && !c.breached);
  }
  get clean(): boolean {
    return !this.breached.length && !this.warnings.length;
  }
  get tone(): string {
    if (this.breached.length) return "loss";
    return this.warnings.length ? "warn" : "gain";
  }
}

function pct(part: Decimal, whole: Decimal): Decimal {
  return whole.isZero() ? ZERO : part.div(whole).times(100);
}

const signed2 = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(2)} %`;
const groupThousands = (x: number): string =>
  Math.round(x).toLocaleString("en-US").replace(/,/g, " ");

export function evaluate(
  rules: PropRules,
  ideas: readonly Idea[],
  deals: readonly Deal[] = [],
  today?: Date,
  now?: Date,
): Compliance {
  const nowD = now ?? new Date();
  const todayKey = dayKey(today ?? nowD);

  const eq = equitySeries(rules, ideas, deals);
  const balance = eq.last ?? rules.start_balance;

  const closed = ideas.filter((i) => i.is_executed && i.closed_at);
  const opens = ideas.flatMap((i) => i.open_trades);

  // --- perte journalière : base du JOUR
  const duJour = closed.filter((i) => dayKey(i.closed_at as Date) === todayKey);
  const dailyPnl = duJour.reduce((a, i) => a.plus(i.pnl_net), ZERO);
  const baseJour = eq.before(todayKey) ?? rules.start_balance;
  const dailyPct = pct(dailyPnl, baseJour);

  // --- drawdown
  let baseDd: Decimal;
  let floor: Decimal;
  if (rules.drawdown_static) {
    baseDd = rules.start_balance;
    floor = rules.floor;
  } else {
    baseDd = eq.highest ?? rules.start_balance;
    floor = baseDd.times(new Decimal(1).minus(rules.max_drawdown_pct.div(100)));
  }
  const plusBas = eq.lowest ?? balance;
  const creux = baseDd.minus(Decimal.min(plusBas, balance));
  const ddPct = creux.gt(0) ? pct(creux, baseDd) : ZERO;
  let marge = balance.minus(floor);
  if (marge.lt(0)) marge = ZERO;

  const dailyCap = rules.daily_loss_pct.isZero() ? marge : baseJour.times(rules.daily_loss_pct).div(100);
  const dailyAllowAmount = Decimal.min(dailyCap, marge);
  const dailyAllowPct = pct(dailyAllowAmount, baseJour);

  const profitPct = pct(balance.minus(rules.start_balance), rules.start_balance);

  let payoutAmount: Decimal | null = null;
  if (rules.is_funded) {
    const gainNet = balance.minus(rules.start_balance);
    payoutAmount = gainNet.gt(0) ? gainNet.times(rules.profit_split_pct).div(100) : gainNet;
  }

  const parJour = new Map<string, Decimal>();
  for (const i of closed) {
    const k = dayKey(i.closed_at as Date);
    parJour.set(k, (parJour.get(k) ?? ZERO).plus(i.pnl_net));
  }

  const jourValide = (pnlJ: Decimal, baseJ: Decimal): boolean => {
    const seuil = baseJ.times(rules.trading_day_threshold_pct).div(100);
    if (rules.trading_day_rule === "gain") return pnlJ.gte(seuil);
    if (rules.trading_day_rule === "loss") return pnlJ.lte(seuil.negated());
    return true;
  };
  const jours = [...parJour.entries()]
    .filter(([dj, pnlJ]) => jourValide(pnlJ, eq.before(dj) ?? rules.start_balance))
    .map(([dj]) => dj)
    .sort();

  const gains = [...parJour.values()].filter((v) => v.gt(0));
  const totalGain = gains.reduce((a, b) => a.plus(b), ZERO);
  const bestShare =
    gains.length && !totalGain.isZero()
      ? gains.reduce((m, g) => (g.gt(m) ? g : m), gains[0]!).div(totalGain).times(100)
      : null;

  const checks: Check[] = [];

  // 1. perte journalière
  const limiteJ = rules.daily_loss_pct;
  const perteJ = dailyPct.lt(0) ? dailyPct.negated() : ZERO;
  const sansJ = limiteJ.isZero();
  checks.push(
    new Check(
      "daily",
      "Perte journalière",
      sansJ || perteJ.lt(limiteJ.times(rules.warn_at).div(100)),
      !sansJ && perteJ.gte(limiteJ),
      sansJ ? "aucune limite" : signed2(dailyPct.toNumber()),
      sansJ
        ? "pas de limite journalière sur ce compte (fréquent en futures intraday)"
        : `limite ${limiteJ.toNumber().toFixed(0)} % · base du jour ${groupThousands(baseJour.toNumber())}`,
      sansJ ? null : perteJ.div(limiteJ).toNumber(),
    ),
  );

  // 2. drawdown max
  checks.push(
    new Check(
      "drawdown",
      "Drawdown max",
      ddPct.lt(rules.max_drawdown_pct.times(rules.warn_at).div(100)),
      ddPct.gte(rules.max_drawdown_pct),
      ddPct.gt(0) ? `-${ddPct.toNumber().toFixed(2)} %` : "0.00 %",
      `limite ${rules.max_drawdown_pct.toNumber().toFixed(0)} % · ${rules.drawdown_static ? "statique" : "trailing"} · plancher ${groupThousands(floor.toNumber())}`,
      rules.max_drawdown_pct.isZero() ? null : ddPct.div(rules.max_drawdown_pct).toNumber(),
    ),
  );

  // 3. objectif de profit de la phase courante
  const target = rules.active_profit_target();
  if (target && !target.isZero()) {
    const p2 = rules.challenge_type === "two_phase" && rules.phase === "p2";
    checks.push(
      new Check(
        "target",
        "Objectif de profit",
        profitPct.gte(target),
        false,
        signed2(profitPct.toNumber()),
        `objectif +${target.toNumber().toFixed(0)} %` + (p2 ? " · phase 2" : ""),
        target.isZero() ? null : Decimal.max(profitPct, ZERO).div(target).toNumber(),
      ),
    );
  }

  // 4. jours de trading minimum (plafonnés)
  const daysActifs =
    rules.min_trading_days && !(rules.is_funded && rules.min_days_scope === "challenge");
  if (daysActifs) {
    const min = rules.min_trading_days!;
    const atteints = Math.min(jours.length, min);
    const defs: Record<string, string> = {
      position: "une position ouverte",
      gain: `un gain ≥ ${rules.trading_day_threshold_pct.toNumber().toFixed(2)} %`,
      loss: `une perte ≥ ${rules.trading_day_threshold_pct.toNumber().toFixed(2)} %`,
    };
    checks.push(
      new Check(
        "days",
        "Jours de trading min.",
        jours.length >= min,
        false,
        `${atteints} / ${min} requis`,
        `un jour compte avec ${defs[rules.trading_day_rule] ?? "une clôture"}`,
        Math.min(1, jours.length / min),
      ),
    );
  }

  // 6. cohérence (alerte, jamais breach)
  if (rules.consistency_pct && !rules.consistency_pct.isZero() && bestShare !== null) {
    checks.push(
      new Check(
        "consistency",
        "Cohérence (consistency)",
        bestShare.lte(rules.consistency_pct),
        false,
        `${bestShare.toNumber().toFixed(0)} %`,
        `ton meilleur jour pèse ${bestShare.toNumber().toFixed(0)} % du profit total · reste sous ${rules.consistency_pct.toNumber().toFixed(0)} %`,
        bestShare.div(rules.consistency_pct).toNumber(),
      ),
    );
  }

  const c = new Compliance(
    rules,
    eq,
    balance,
    todayKey,
    dailyPnl,
    dailyPct,
    limiteJ,
    ddPct,
    rules.max_drawdown_pct,
    floor,
    marge,
    profitPct,
    jours.length,
    bestShare,
    [...new Set(opens.map((o) => o.symbol))].sort(),
    dailyAllowAmount,
    dailyAllowPct,
    payoutAmount,
  );
  c.checks = checks;
  return c;
}
