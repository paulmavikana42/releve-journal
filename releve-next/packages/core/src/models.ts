// Modèles du domaine — port fidèle de core/models.py.
//
// Règles non négociables (identiques au Python) :
//   - Decimal partout où il y a de l'argent ou un prix. Jamais de number natif.
//   - Deal / Position / OpenTrade / Attachment sont IMMUABLES (readonly).
//   - Thesis / Review / Idea / Campaign sont annotés par l'utilisateur.
//   - Idea est le conteneur : 1 thèse -> N positions.
//
// Le comportement de chaque getter/méthode reproduit celui de core/models.py ;
// la parité fine (au centième, sur le vrai journal) est verrouillée par le diff
// de la phase 6.
import { Decimal } from "./decimal";

// --------------------------------------------------------------- énumérations

export enum IdeaStatus {
  DRAFT = "brouillon",
  ARMED = "armee",
  RUNNING = "en_cours",
  CLOSED = "cloturee",
  REVIEWED = "revue",
  ABANDONED = "abandonnee",
}

export enum Direction {
  BUY = "buy",
  SELL = "sell",
}

export enum RiskSource {
  COMPUTED = "computed",
  BACKFILLED = "backfilled",
  UNKNOWN = "unknown",
}

export enum StopEvidence {
  CAPTURE = "capture",
  MEMORY = "memoire",
}

export enum StopProvenance {
  PROVEN = "prouve",
  MOVED = "deplace",
  UNVERIFIED = "non_verifie",
  SUSPECT_BE = "suspect_breakeven",
  DECLARED = "declare",
  NONE = "aucun",
}

// Un stop à moins de 0,15 % du prix d'entrée n'est pas un stop de départ : c'est
// un breakeven. Voir le garde-fou SUSPECT_BE.
export const BREAKEVEN_TOLERANCE = new Decimal("0.0015");

export enum RiskBasis {
  SUM = "somme",
  INITIAL_ONLY = "ticket_initial",
  MAX_CONCURRENT = "max_simultane",
}

export enum MissedOutcome {
  NO_SETUP = "setup_absent",
  HESITATED = "hesitation",
}

export enum ThesisOutcome {
  CORRECT = "correcte",
  WRONG = "fausse",
  UNTESTED = "non_testee",
}

export enum ExitReason {
  STOP_LOSS = "sl",
  TAKE_PROFIT = "tp",
  MANUAL = "manual",
  UNKNOWN = "unknown",
}

export enum Quadrant {
  MASTERY = "maitrise",
  LUCK = "chance",
  ERROR = "erreur",
  VARIANCE = "alea_ok",
  PENDING = "en_attente",
}

// Un process est « respecté » à partir de 4 critères sur 5 (cf. models.py).
export const GOOD_PROCESS_MIN = 4;

export enum CaptureKind {
  THESIS = "these",
  ENTRY = "entree",
  MANAGE = "gestion",
  EXIT = "sortie",
  OTHER = "autre",
}

// ------------------------------------------------------------------- utilitaires

const ZERO = new Decimal(0);

function dsum(xs: Decimal[]): Decimal {
  return xs.reduce((a, b) => a.plus(b), new Decimal(0));
}

function genId(): string {
  // `crypto.randomUUID` est un global standard (Node ≥ 18 ET navigateurs). On le
  // référence via globalThis pour rester portable sans tirer les types DOM/Node
  // dans ce paquet volontairement pur.
  const g = globalThis as unknown as { crypto: { randomUUID(): string } };
  return g.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** Ce dont les calculs de risque ont besoin d'un SpecBook (specs.ts, phase 1). */
export interface SpecBookLike {
  point_value(p: Position): Decimal | null;
  point_value_for?(symbol: string): Decimal | null;
}

// ------------------------------------------------------------------ MT5 (brut)

export interface DealInit {
  deal_id: string;
  time: Date;
  symbol: string;
  deal_type: string;
  entry: string;
  volume: Decimal | null;
  price: Decimal | null;
  order_id: string;
  commission: Decimal;
  fee: Decimal;
  swap: Decimal;
  profit: Decimal;
  balance: Decimal;
  comment?: string;
  account_id?: string;
}

export class Deal {
  readonly deal_id: string;
  readonly time: Date;
  readonly symbol: string;
  readonly deal_type: string;
  readonly entry: string;
  readonly volume: Decimal | null;
  readonly price: Decimal | null;
  readonly order_id: string;
  readonly commission: Decimal;
  readonly fee: Decimal;
  readonly swap: Decimal;
  readonly profit: Decimal;
  readonly balance: Decimal;
  readonly comment: string;
  readonly account_id: string;

  constructor(init: DealInit) {
    this.deal_id = init.deal_id;
    this.time = init.time;
    this.symbol = init.symbol;
    this.deal_type = init.deal_type;
    this.entry = init.entry;
    this.volume = init.volume;
    this.price = init.price;
    this.order_id = init.order_id;
    this.commission = init.commission;
    this.fee = init.fee;
    this.swap = init.swap;
    this.profit = init.profit;
    this.balance = init.balance;
    this.comment = init.comment ?? "";
    this.account_id = init.account_id ?? "";
  }

  get is_trading(): boolean {
    return this.deal_type === "buy" || this.deal_type === "sell";
  }
  get is_funding(): boolean {
    return !this.is_trading;
  }
}

export interface PositionInit {
  position_id: string;
  account_id: string;
  symbol: string;
  direction: Direction;
  volume: Decimal;
  open_time: Date;
  open_price: Decimal;
  close_time: Date;
  close_price: Decimal;
  commission: Decimal;
  swap: Decimal;
  profit_gross: Decimal;
  sl_final?: Decimal | null;
  tp_final?: Decimal | null;
  sl_at_placement?: Decimal | null;
  exit_reason?: ExitReason;
}

export class Position {
  readonly position_id: string;
  readonly account_id: string;
  readonly symbol: string;
  readonly direction: Direction;
  readonly volume: Decimal;
  readonly open_time: Date;
  readonly open_price: Decimal;
  readonly close_time: Date;
  readonly close_price: Decimal;
  readonly commission: Decimal;
  readonly swap: Decimal;
  readonly profit_gross: Decimal;
  readonly sl_final: Decimal | null;
  readonly tp_final: Decimal | null;
  readonly sl_at_placement: Decimal | null;
  readonly exit_reason: ExitReason;

  constructor(init: PositionInit) {
    this.position_id = init.position_id;
    this.account_id = init.account_id;
    this.symbol = init.symbol;
    this.direction = init.direction;
    this.volume = init.volume;
    this.open_time = init.open_time;
    this.open_price = init.open_price;
    this.close_time = init.close_time;
    this.close_price = init.close_price;
    this.commission = init.commission;
    this.swap = init.swap;
    this.profit_gross = init.profit_gross;
    this.sl_final = init.sl_final ?? null;
    this.tp_final = init.tp_final ?? null;
    this.sl_at_placement = init.sl_at_placement ?? null;
    this.exit_reason = init.exit_reason ?? ExitReason.UNKNOWN;
  }

  /** Clé globale : un position_id peut se répéter d'un compte à l'autre. */
  get uid(): string {
    return `${this.account_id}:${this.position_id}`;
  }

  /** Profit MT5 est BRUT ; le net inclut commission et swap. */
  get pnl_net(): Decimal {
    return this.profit_gross.plus(this.commission).plus(this.swap);
  }

  get sign(): number {
    return this.direction === Direction.BUY ? 1 : -1;
  }

  /** Déplacement du prix en ta faveur (négatif si contre toi). */
  get price_move(): Decimal {
    return this.close_price.minus(this.open_price).times(this.sign);
  }

  get duration_hours(): number {
    return (this.close_time.getTime() - this.open_time.getTime()) / 3_600_000;
  }

  get stop_provenance(): StopProvenance {
    if (this.sl_final === null) return StopProvenance.NONE;
    if (this.sl_at_placement !== null) {
      return this.sl_at_placement.eq(this.sl_final)
        ? StopProvenance.PROVEN
        : StopProvenance.MOVED;
    }
    // Ordre au marché sans SL : un SL collé à l'entrée est un breakeven, pas un
    // stop — le risque d'origine est irrécupérable, on REFUSE de calculer.
    if (
      !this.open_price.isZero() &&
      this.sl_final.minus(this.open_price).abs().div(this.open_price).lt(BREAKEVEN_TOLERANCE)
    ) {
      return StopProvenance.SUSPECT_BE;
    }
    return StopProvenance.UNVERIFIED;
  }

  get stop_original(): Decimal | null {
    const pr = this.stop_provenance;
    if (pr === StopProvenance.MOVED) return this.sl_at_placement;
    if (pr === StopProvenance.PROVEN || pr === StopProvenance.UNVERIFIED) return this.sl_final;
    return null;
  }

  /** Risque de CE ticket : volume × distance au stop × valeur du point. */
  risk(specBook?: SpecBookLike | null, stopOverride?: Decimal | null): Decimal | null {
    const stop = stopOverride !== undefined && stopOverride !== null ? stopOverride : this.stop_original;
    if (stop === null) return null;
    const pv = specBook ? specBook.point_value(this) : this.point_value;
    if (pv === null) return null;
    const r = this.volume.times(this.open_price.minus(stop).abs()).times(pv);
    return r.gt(0) ? r : null;
  }

  /** Valeur d'un point pour 1 lot, DÉDUITE de la position : pv = brut/(vol×move). */
  get point_value(): Decimal | null {
    const denom = this.volume.times(this.price_move);
    if (denom.isZero() || this.profit_gross.isZero()) return null;
    return this.profit_gross.div(denom);
  }
}

// -------------------------------------------------------- le trade encore ouvert

export interface OpenTradeInit {
  ticket: string;
  symbol: string;
  direction: Direction;
  volume: Decimal;
  open_time: Date;
  open_price: Decimal;
  account_id?: string;
  stop?: Decimal | null;
  take_profit?: Decimal | null;
  last_price?: Decimal | null;
  last_price_at?: Date | null;
  note?: string;
}

export class OpenTrade {
  readonly ticket: string;
  readonly symbol: string;
  readonly direction: Direction;
  readonly volume: Decimal;
  readonly open_time: Date;
  readonly open_price: Decimal;
  readonly account_id: string;
  readonly stop: Decimal | null;
  readonly take_profit: Decimal | null;
  readonly last_price: Decimal | null;
  readonly last_price_at: Date | null;
  readonly note: string;

  constructor(init: OpenTradeInit) {
    this.ticket = init.ticket;
    this.symbol = init.symbol;
    this.direction = init.direction;
    this.volume = init.volume;
    this.open_time = init.open_time;
    this.open_price = init.open_price;
    this.account_id = init.account_id ?? "";
    this.stop = init.stop ?? null;
    this.take_profit = init.take_profit ?? null;
    this.last_price = init.last_price ?? null;
    this.last_price_at = init.last_price_at ?? null;
    this.note = init.note ?? "";
  }

  get uid(): string {
    return `${this.account_id}:${this.ticket}`;
  }

  get sign(): number {
    return this.direction === Direction.BUY ? 1 : -1;
  }

  risk(pointValue?: Decimal | null): Decimal | null {
    if (this.stop === null || pointValue === undefined || pointValue === null) return null;
    const r = this.volume.times(this.open_price.minus(this.stop).abs()).times(pointValue);
    return r.gt(0) ? r : null;
  }

  floating_pnl(pointValue?: Decimal | null): Decimal | null {
    if (this.last_price === null || pointValue === undefined || pointValue === null) return null;
    return this.last_price
      .minus(this.open_price)
      .times(this.sign)
      .times(this.volume)
      .times(pointValue);
  }
}

export interface AttachmentInit {
  id: string;
  owner_type: string;
  owner_id: string;
  path: string;
  original_name?: string;
  kind?: CaptureKind;
  caption?: string;
  added_at?: Date | null;
  removed?: boolean;
}

export class Attachment {
  readonly id: string;
  readonly owner_type: string;
  readonly owner_id: string;
  readonly path: string;
  readonly original_name: string;
  readonly kind: CaptureKind;
  readonly caption: string;
  readonly added_at: Date | null;
  readonly removed: boolean;

  constructor(init: AttachmentInit) {
    this.id = init.id;
    this.owner_type = init.owner_type;
    this.owner_id = init.owner_id;
    this.path = init.path;
    this.original_name = init.original_name ?? "";
    this.kind = init.kind ?? CaptureKind.OTHER;
    this.caption = init.caption ?? "";
    this.added_at = init.added_at ?? null;
    this.removed = init.removed ?? false;
  }
}

// ---------------------------------------------------------------- toi (annoté)

export interface ThesisInit {
  instrument: string;
  direction: Direction;
  macro_theme?: string;
  catalyst?: string;
  macro_note?: string;
  blocks?: unknown[];
  setup?: string;
  timeframe?: string;
  technical_note?: string;
  entry_planned?: Decimal | null;
  stop_initial?: Decimal | null;
  targets?: Decimal[];
  risk_pct?: Decimal | null;
  thesis_kill_switch?: string;
  conviction?: number | null;
  risk_source?: RiskSource;
}

export class Thesis {
  instrument: string;
  direction: Direction;
  macro_theme: string;
  catalyst: string;
  macro_note: string;
  blocks: unknown[];
  setup: string;
  timeframe: string;
  technical_note: string;
  entry_planned: Decimal | null;
  stop_initial: Decimal | null;
  targets: Decimal[];
  risk_pct: Decimal | null;
  thesis_kill_switch: string;
  conviction: number | null;
  risk_source: RiskSource;

  constructor(init: ThesisInit) {
    this.instrument = init.instrument;
    this.direction = init.direction;
    this.macro_theme = init.macro_theme ?? "";
    this.catalyst = init.catalyst ?? "";
    this.macro_note = init.macro_note ?? "";
    this.blocks = init.blocks ?? [];
    this.setup = init.setup ?? "";
    this.timeframe = init.timeframe ?? "";
    this.technical_note = init.technical_note ?? "";
    this.entry_planned = init.entry_planned ?? null;
    this.stop_initial = init.stop_initial ?? null;
    this.targets = init.targets ?? [];
    this.risk_pct = init.risk_pct ?? null;
    this.thesis_kill_switch = init.thesis_kill_switch ?? "";
    this.conviction = init.conviction ?? null;
    this.risk_source = init.risk_source ?? RiskSource.COMPUTED;
  }

  /** Distance entrée -> stop, en points de prix. Toujours positive. */
  risk_per_lot(): Decimal | null {
    if (this.stop_initial === null || this.entry_planned === null) return null;
    return this.entry_planned.minus(this.stop_initial).abs();
  }
}

export interface ReviewInit {
  entry_in_zone?: boolean;
  size_conforme?: boolean;
  stop_at_invalidation?: boolean;
  stop_never_widened?: boolean;
  exit_per_plan?: boolean;
  thesis_outcome?: ThesisOutcome;
  emotional_state?: string;
  lesson?: string;
  tags?: string[];
}

export class Review {
  entry_in_zone: boolean;
  size_conforme: boolean;
  stop_at_invalidation: boolean;
  stop_never_widened: boolean;
  exit_per_plan: boolean;
  thesis_outcome: ThesisOutcome;
  emotional_state: string;
  lesson: string;
  tags: string[];

  constructor(init: ReviewInit = {}) {
    this.entry_in_zone = init.entry_in_zone ?? false;
    this.size_conforme = init.size_conforme ?? false;
    this.stop_at_invalidation = init.stop_at_invalidation ?? false;
    this.stop_never_widened = init.stop_never_widened ?? false;
    this.exit_per_plan = init.exit_per_plan ?? false;
    this.thesis_outcome = init.thesis_outcome ?? ThesisOutcome.UNTESTED;
    this.emotional_state = init.emotional_state ?? "";
    this.lesson = init.lesson ?? "";
    this.tags = init.tags ?? [];
  }

  get discipline_score(): number {
    return (
      Number(this.entry_in_zone) +
      Number(this.size_conforme) +
      Number(this.stop_at_invalidation) +
      Number(this.stop_never_widened) +
      Number(this.exit_per_plan)
    );
  }

  get is_clean(): boolean {
    return this.discipline_score === 5;
  }
}

export interface MissedReviewInit {
  setup_appeared?: MissedOutcome;
  would_have_won?: boolean | null;
  reason?: string;
  note?: string;
}

export class MissedReview {
  setup_appeared: MissedOutcome;
  would_have_won: boolean | null;
  reason: string;
  note: string;

  constructor(init: MissedReviewInit = {}) {
    this.setup_appeared = init.setup_appeared ?? MissedOutcome.NO_SETUP;
    this.would_have_won = init.would_have_won ?? null;
    this.reason = init.reason ?? "";
    this.note = init.note ?? "";
  }
}

// ---------------------------------------------------------------- le conteneur

export interface IdeaInit {
  id?: string;
  created_at?: Date;
  thesis?: Thesis | null;
  review?: Review | null;
  status?: IdeaStatus;
  position_uids?: string[];
  off_plan?: boolean;
  label?: string;
  risk_basis?: RiskBasis;
  campaign_id?: string | null;
  late_thesis?: boolean;
  missed_review?: MissedReview | null;
  account_id?: string;
  manual_stops?: Map<string, Decimal>;
  stop_evidence?: Map<string, StopEvidence>;
  secured_on_add?: Map<string, boolean>;
}

export class Idea {
  id: string;
  created_at: Date;
  thesis: Thesis | null;
  review: Review | null;
  status: IdeaStatus;
  position_uids: string[];
  off_plan: boolean;
  label: string;
  risk_basis: RiskBasis;
  campaign_id: string | null;
  late_thesis: boolean;
  missed_review: MissedReview | null;
  account_id: string;
  manual_stops: Map<string, Decimal>;
  stop_evidence: Map<string, StopEvidence>;
  secured_on_add: Map<string, boolean>;

  // résolus au chargement, pas persistés
  positions: Position[] = [];
  open_trades: OpenTrade[] = [];
  attachments: Attachment[] = [];

  constructor(init: IdeaInit = {}) {
    this.id = init.id ?? genId();
    this.created_at = init.created_at ?? new Date();
    this.thesis = init.thesis ?? null;
    this.review = init.review ?? null;
    this.status = init.status ?? IdeaStatus.DRAFT;
    this.position_uids = init.position_uids ?? [];
    this.off_plan = init.off_plan ?? false;
    this.label = init.label ?? "";
    this.risk_basis = init.risk_basis ?? RiskBasis.SUM;
    this.campaign_id = init.campaign_id ?? null;
    this.late_thesis = init.late_thesis ?? false;
    this.missed_review = init.missed_review ?? null;
    this.account_id = init.account_id ?? "";
    this.manual_stops = init.manual_stops ?? new Map();
    this.stop_evidence = init.stop_evidence ?? new Map();
    this.secured_on_add = init.secured_on_add ?? new Map();
  }

  // ------------------------------------------------------------- agrégats

  get is_executed(): boolean {
    return this.positions.length > 0;
  }
  get is_running(): boolean {
    return this.open_trades.length > 0;
  }
  get captures(): Attachment[] {
    return this.attachments.filter((a) => !a.removed);
  }
  get symbol(): string {
    if (this.positions.length) return this.positions[0]!.symbol;
    if (this.open_trades.length) return this.open_trades[0]!.symbol;
    return this.thesis ? this.thesis.instrument : "?";
  }
  get opened_at(): Date | null {
    const times = [
      ...this.positions.map((p) => p.open_time.getTime()),
      ...this.open_trades.map((o) => o.open_time.getTime()),
    ];
    return times.length ? new Date(Math.min(...times)) : null;
  }
  get closed_at(): Date | null {
    if (!this.positions.length) return null;
    return new Date(Math.max(...this.positions.map((p) => p.close_time.getTime())));
  }
  get pnl_net(): Decimal {
    return dsum(this.positions.map((p) => p.pnl_net));
  }
  get total_volume(): Decimal {
    return dsum(this.positions.map((p) => p.volume));
  }
  get initial_position(): Position | null {
    if (!this.positions.length) return null;
    return this.positions.reduce((a, b) =>
      a.open_time.getTime() <= b.open_time.getTime() ? a : b,
    );
  }

  /** Ce ticket fait-il partie de l'ENTRÉE INITIALE ? (noyau ou fragment) */
  est_du_noyau(p: Position): boolean {
    const init = this.initial_position;
    if (init === null) return false;
    return (
      p === init ||
      (p.open_time.getTime() === init.open_time.getTime() && p.open_price.eq(init.open_price))
    );
  }

  get adds(): Position[] {
    return this.positions.filter((p) => !this.est_du_noyau(p));
  }

  /** Les tickets qui ne chevauchent AUCUN autre ticket de l'idée. */
  get tickets_disjoints(): Position[] {
    if (this.positions.length < 2) return [];
    const seuls: Position[] = [];
    for (const p of this.positions) {
      if (this.est_du_noyau(p)) continue;
      const chevauche = this.positions.some(
        (q) =>
          q !== p &&
          q.open_time.getTime() <= p.open_time.getTime() &&
          p.open_time.getTime() <= q.close_time.getTime(),
      );
      if (!chevauche) seuls.push(p);
    }
    return seuls;
  }

  get pnl_initial(): Decimal {
    const p = this.initial_position;
    return p ? p.pnl_net : ZERO;
  }
  get pnl_adds(): Decimal {
    return dsum(this.adds.map((p) => p.pnl_net));
  }

  // ------------------------------------------------------------------ risque

  /** Le stop d'origine de CE ticket, et d'où il vient. Voir models.py:stop_for. */
  stop_for(p: Position): [Decimal | null, string] {
    const mine = this.manual_stops.get(p.uid);
    if (mine !== undefined) return [mine, "saisi"];

    const deLIdee = this.thesis ? this.thesis.stop_initial : null;

    if (this.est_du_noyau(p)) {
      if (deLIdee !== null) return [deLIdee, "ton idée"];
      const propre = p.stop_original;
      return propre !== null ? [propre, p.stop_provenance] : [null, p.stop_provenance];
    }

    const propre = p.stop_original;
    if (propre !== null) return [propre, p.stop_provenance];
    return [null, p.stop_provenance];
  }

  get has_reconstructed_stop(): boolean {
    for (const e of this.stop_evidence.values()) {
      if (e === StopEvidence.MEMORY) return true;
    }
    return false;
  }

  ticket_risks(specBook?: SpecBookLike | null): Map<string, Decimal | null> {
    const out = new Map<string, Decimal | null>();
    for (const p of this.positions) {
      const [stop] = this.stop_for(p);
      out.set(p.position_id, p.risk(specBook, stop));
    }
    return out;
  }

  tickets_needing_stop(): Position[] {
    return this.positions.filter((p) => this.stop_for(p)[0] === null);
  }

  /** Le pire moment : combien de risque exposé SIMULTANÉMENT ? */
  max_concurrent_risk(specBook?: SpecBookLike | null): Decimal | null {
    const risks = this.ticket_risks(specBook);
    const ordered = [...this.positions].sort(
      (a, b) => a.open_time.getTime() - b.open_time.getTime(),
    );

    type Ev = { t: number; prio: number; action: "open" | "close"; p: Position };
    const events: Ev[] = [];
    for (const p of ordered) {
      events.push({ t: p.open_time.getTime(), prio: 0, action: "open", p });
      events.push({ t: p.close_time.getTime(), prio: 1, action: "close", p });
    }
    events.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.prio - b.prio));

    const live = new Map<string, Decimal>();
    let peak = new Decimal(0);

    for (const ev of events) {
      if (ev.action === "open") {
        // Le noyau était-il sécurisé quand CE ticket s'est ouvert ?
        if (this.secured_on_add.get(ev.p.uid)) {
          for (const uid of live.keys()) live.set(uid, ZERO);
        }
        const r = risks.get(ev.p.position_id);
        if (r === null || r === undefined) return null; // risque inconnu -> tout invalide
        live.set(ev.p.uid, r);
      } else {
        live.delete(ev.p.uid);
      }
      const total = dsum([...live.values()]);
      if (total.gt(peak)) peak = total;
    }

    return peak.gt(0) ? peak : null;
  }

  exposure_is_measured(): boolean {
    return this.adds.every((a) => this.secured_on_add.has(a.uid));
  }

  /** Le risque de l'IDÉE, en devise du compte. Défaut : SUM. */
  risk_realized(specBook?: SpecBookLike | null, basis?: RiskBasis): Decimal | null {
    const b = basis ?? this.risk_basis;

    if (b === RiskBasis.MAX_CONCURRENT) return this.max_concurrent_risk(specBook);

    const risks = this.ticket_risks(specBook);

    if (b === RiskBasis.INITIAL_ONLY) {
      const init = this.initial_position;
      return init ? risks.get(init.position_id) ?? null : null;
    }

    // SUM : somme de tous les risques ; un seul ticket sans stop invalide le total.
    const vals: Decimal[] = [];
    for (const r of risks.values()) if (r !== null) vals.push(r);
    if (!vals.length || vals.length < this.positions.length) return null;
    const total = dsum(vals);
    return total.gt(0) ? total : null;
  }

  risk_planned(equityRef: Decimal): Decimal | null {
    if (this.thesis === null || this.thesis.risk_pct === null) return null;
    return this.thesis.risk_pct.div(100).times(equityRef);
  }

  r_multiple(specBook?: SpecBookLike | null, basis?: RiskBasis): Decimal | null {
    const risk = this.risk_realized(specBook, basis);
    if (risk === null || risk.isZero()) return null;
    return this.pnl_net.div(risk);
  }

  r_normalized(equityRef: Decimal): Decimal | null {
    const risk = this.risk_planned(equityRef);
    if (risk === null || risk.isZero()) return null;
    return this.pnl_net.div(risk);
  }

  size_conformity(equityRef: Decimal, specBook?: SpecBookLike | null): Decimal | null {
    const real = this.risk_realized(specBook);
    const plan = this.risk_planned(equityRef);
    if (real === null || plan === null || plan.isZero()) return null;
    return real.div(plan);
  }

  get risk_source(): RiskSource {
    if (this.thesis === null || this.thesis.stop_initial === null) return RiskSource.UNKNOWN;
    return this.thesis.risk_source;
  }

  get discipline_score(): number | null {
    return this.review ? this.review.discipline_score : null;
  }

  get quadrant(): Quadrant {
    if (!this.is_executed || this.review === null) return Quadrant.PENDING;
    const bon = this.review.discipline_score >= GOOD_PROCESS_MIN;
    const gain = this.pnl_net.gt(0);
    if (gain) return bon ? Quadrant.MASTERY : Quadrant.LUCK;
    return bon ? Quadrant.VARIANCE : Quadrant.ERROR;
  }

  // ------------------------------------------------------- pendant le trade

  floating_pnl(specBook?: SpecBookLike | null): Decimal | null {
    const vals: Decimal[] = [];
    for (const o of this.open_trades) {
      const pv = specBook?.point_value_for ? specBook.point_value_for(o.symbol) : null;
      const v = o.floating_pnl(pv);
      if (v !== null) vals.push(v);
    }
    return vals.length ? dsum(vals) : null;
  }

  risk_open(specBook?: SpecBookLike | null): Decimal | null {
    if (!this.open_trades.length) return null;
    let total = new Decimal(0);
    for (const o of this.open_trades) {
      const pv = specBook?.point_value_for ? specBook.point_value_for(o.symbol) : null;
      const stop = o.stop !== null ? o.stop : this.thesis ? this.thesis.stop_initial : null;
      if (stop === null || pv === null) return null;
      const r = o.volume.times(o.open_price.minus(stop).abs()).times(pv);
      if (r.lte(0)) return null;
      total = total.plus(r);
    }
    return total;
  }

  floating_r(specBook?: SpecBookLike | null): Decimal | null {
    const pnl = this.floating_pnl(specBook);
    const risque = this.risk_open(specBook);
    if (pnl === null || risque === null || risque.isZero()) return null;
    return pnl.div(risque);
  }

  get display_name(): string {
    if (this.label) return this.label;
    if (this.thesis && this.thesis.macro_theme) {
      return `${this.symbol} ${this.thesis.direction} — ${this.thesis.macro_theme}`;
    }
    return this.off_plan ? `${this.symbol} (hors-plan)` : `${this.symbol}`;
  }
}

// ------------------------------------------- le chapeau multi-instruments

export interface CampaignInit {
  id?: string;
  created_at?: Date;
  name?: string;
  macro_theme?: string;
  catalyst?: string;
  note?: string;
  blocks?: unknown[];
  conviction?: number | null;
  kill_switch?: string;
  closed?: boolean;
  abandoned?: boolean;
  abandon_correct?: boolean | null;
  account_id?: string;
}

export class Campaign {
  id: string;
  created_at: Date;
  name: string;
  macro_theme: string;
  catalyst: string;
  note: string;
  blocks: unknown[];
  conviction: number | null;
  kill_switch: string;
  closed: boolean;
  abandoned: boolean;
  abandon_correct: boolean | null;
  account_id: string;

  // résolus au chargement
  ideas: Idea[] = [];
  attachments: Attachment[] = [];

  constructor(init: CampaignInit = {}) {
    this.id = init.id ?? genId();
    this.created_at = init.created_at ?? new Date();
    this.name = init.name ?? "";
    this.macro_theme = init.macro_theme ?? "";
    this.catalyst = init.catalyst ?? "";
    this.note = init.note ?? "";
    this.blocks = init.blocks ?? [];
    this.conviction = init.conviction ?? null;
    this.kill_switch = init.kill_switch ?? "";
    this.closed = init.closed ?? false;
    this.abandoned = init.abandoned ?? false;
    this.abandon_correct = init.abandon_correct ?? null;
    this.account_id = init.account_id ?? "";
  }

  get captures(): Attachment[] {
    return this.attachments.filter((a) => !a.removed);
  }
  get executed_ideas(): Idea[] {
    return this.ideas.filter((i) => i.is_executed);
  }
  get instruments(): string[] {
    return [...new Set(this.executed_ideas.map((i) => i.symbol))].sort();
  }
  get pnl_net(): Decimal {
    return dsum(this.executed_ideas.map((i) => i.pnl_net));
  }

  risk_total(specBook?: SpecBookLike | null): Decimal | null {
    const vals = this.executed_ideas.map((i) => i.risk_realized(specBook));
    if (!vals.length || vals.some((v) => v === null)) return null;
    return dsum(vals as Decimal[]);
  }

  r_total(specBook?: SpecBookLike | null): Decimal | null {
    const rs = this.executed_ideas.map((i) => i.r_multiple(specBook));
    if (!rs.length || rs.some((r) => r === null)) return null;
    return dsum(rs as Decimal[]);
  }

  r_weighted(specBook?: SpecBookLike | null): Decimal | null {
    const risk = this.risk_total(specBook);
    if (risk === null || risk.isZero()) return null;
    return this.pnl_net.div(risk);
  }

  get display_name(): string {
    if (this.name) return this.name;
    if (this.macro_theme) return this.macro_theme;
    return "Thèse macro sans nom";
  }
}
