// Stockage : journal d'événements append-only — port de core/store.py.
//
// On n'écrase JAMAIS un événement. L'état courant se reconstruit en rejouant le
// journal (load). Ici : un journal EN MÉMOIRE (suffisant pour le port et les
// tests, et pour le diff de non-régression en chargeant un events.jsonl réel via
// fromEvents). Le backend fichier/Supabase se branchera derrière la même API.
import { Decimal } from "./decimal";
import { serverUtcOffset } from "./clock";
import {
  Attachment,
  Campaign,
  CaptureKind,
  Deal,
  Direction,
  ExitReason,
  Idea,
  IdeaStatus,
  MissedOutcome,
  MissedReview,
  OpenTrade,
  Position,
  Review,
  RiskSource,
  StopEvidence,
  Thesis,
  ThesisOutcome,
} from "./models";

export const SCHEMA_VERSION = 1;

export interface EventRecord {
  v: number;
  ts: string;
  type: string;
  payload: unknown;
  demo?: boolean;
}

// ------------------------------------------------------- (dé)sérialisation

function dtIso(d: Date): string {
  // isoformat naïf : les champs UTC portent l'heure-mur serveur (sans fuseau).
  return d.toISOString().replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
}

function parseDt(s: string): Date {
  // Migration intégrée (comme to_server_naive) : un $dt AVEC fuseau (ancien
  // journal) est ramené en heure serveur ; un $dt sans fuseau est déjà en heure
  // serveur (champs UTC).
  const hasTz = /[+-]\d{2}:\d{2}$/.test(s) || s.endsWith("Z");
  if (hasTz) return new Date(new Date(s).getTime() + serverUtcOffset() * 3_600_000);
  return new Date(s + "Z");
}

export function encode(o: unknown): unknown {
  if (o === null || o === undefined) return o;
  if (o instanceof Decimal) return { $dec: o.toString() };
  if (o instanceof Date) return { $dt: dtIso(o) };
  if (Array.isArray(o)) return o.map(encode);
  if (o instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of o) out[String(k)] = encode(v);
    return out;
  }
  if (typeof o === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) out[k] = encode(v);
    return out;
  }
  return o; // string (enum inclus), number, boolean
}

export function decode(o: unknown): unknown {
  if (o === null || o === undefined) return o;
  if (Array.isArray(o)) return o.map(decode);
  if (typeof o === "object") {
    const rec = o as Record<string, unknown>;
    if ("$dec" in rec) return new Decimal(String(rec["$dec"]));
    if ("$dt" in rec) return parseDt(String(rec["$dt"]));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = decode(v);
    return out;
  }
  return o;
}

type Dict = Record<string, unknown>;
const asDec = (v: unknown): Decimal | null => (v instanceof Decimal ? v : v === null || v === undefined ? null : new Decimal(String(v)));
const asDate = (v: unknown): Date | null => (v instanceof Date ? v : null);

function thesisFrom(d: Dict | null | undefined): Thesis | null {
  if (!d) return null;
  return new Thesis({
    instrument: String(d["instrument"] ?? ""),
    direction: d["direction"] as Direction,
    macro_theme: (d["macro_theme"] as string) ?? "",
    catalyst: (d["catalyst"] as string) ?? "",
    macro_note: (d["macro_note"] as string) ?? "",
    blocks: (d["blocks"] as unknown[]) ?? [],
    setup: (d["setup"] as string) ?? "",
    timeframe: (d["timeframe"] as string) ?? "",
    technical_note: (d["technical_note"] as string) ?? "",
    entry_planned: asDec(d["entry_planned"]),
    stop_initial: asDec(d["stop_initial"]),
    targets: ((d["targets"] as unknown[]) ?? []).map((x) => asDec(x)!).filter(Boolean),
    risk_pct: asDec(d["risk_pct"]),
    thesis_kill_switch: (d["thesis_kill_switch"] as string) ?? "",
    conviction: (d["conviction"] as number | null) ?? null,
    risk_source: (d["risk_source"] as RiskSource) ?? RiskSource.COMPUTED,
  });
}

function otToInit(d: Dict): ConstructorParameters<typeof OpenTrade>[0] {
  return {
    ticket: String(d["ticket"]),
    symbol: String(d["symbol"]),
    direction: d["direction"] as Direction,
    volume: asDec(d["volume"]) ?? new Decimal(0),
    open_time: asDate(d["open_time"]) ?? new Date(0),
    open_price: asDec(d["open_price"]) ?? new Decimal(0),
    account_id: (d["account_id"] as string) ?? "",
    stop: asDec(d["stop"]),
    take_profit: asDec(d["take_profit"]),
    last_price: asDec(d["last_price"]),
    last_price_at: asDate(d["last_price_at"]),
    note: (d["note"] as string) ?? "",
  };
}
const openTradeFrom = (d: Dict): OpenTrade => new OpenTrade(otToInit(d));

function attachmentFrom(d: Dict): Attachment {
  return new Attachment({
    id: String(d["id"]),
    owner_type: String(d["owner_type"]),
    owner_id: String(d["owner_id"]),
    path: String(d["path"]),
    original_name: (d["original_name"] as string) ?? "",
    kind: (d["kind"] as CaptureKind) ?? CaptureKind.OTHER,
    caption: (d["caption"] as string) ?? "",
    added_at: asDate(d["added_at"]),
    removed: Boolean(d["removed"]),
  });
}

function reviewFrom(d: Dict | null | undefined): Review | null {
  if (!d) return null;
  return new Review({
    entry_in_zone: Boolean(d["entry_in_zone"]),
    size_conforme: Boolean(d["size_conforme"]),
    stop_at_invalidation: Boolean(d["stop_at_invalidation"]),
    stop_never_widened: Boolean(d["stop_never_widened"]),
    exit_per_plan: Boolean(d["exit_per_plan"]),
    thesis_outcome: (d["thesis_outcome"] as ThesisOutcome) ?? ThesisOutcome.UNTESTED,
    emotional_state: (d["emotional_state"] as string) ?? "",
    lesson: (d["lesson"] as string) ?? "",
    tags: (d["tags"] as string[]) ?? [],
  });
}

function positionFrom(d: Dict): Position {
  return new Position({
    position_id: String(d["position_id"]),
    account_id: String(d["account_id"] ?? ""),
    symbol: String(d["symbol"]),
    direction: d["direction"] as Direction,
    volume: asDec(d["volume"]) ?? new Decimal(0),
    open_time: asDate(d["open_time"]) ?? new Date(0),
    open_price: asDec(d["open_price"]) ?? new Decimal(0),
    close_time: asDate(d["close_time"]) ?? new Date(0),
    close_price: asDec(d["close_price"]) ?? new Decimal(0),
    commission: asDec(d["commission"]) ?? new Decimal(0),
    swap: asDec(d["swap"]) ?? new Decimal(0),
    profit_gross: asDec(d["profit_gross"]) ?? new Decimal(0),
    sl_final: asDec(d["sl_final"]),
    tp_final: asDec(d["tp_final"]),
    sl_at_placement: asDec(d["sl_at_placement"]),
    exit_reason: (d["exit_reason"] as ExitReason) ?? ExitReason.UNKNOWN,
  });
}

function dealFrom(d: Dict): Deal {
  return new Deal({
    deal_id: String(d["deal_id"]),
    time: asDate(d["time"]) ?? new Date(0),
    symbol: String(d["symbol"]),
    deal_type: String(d["deal_type"]),
    entry: String(d["entry"]),
    volume: asDec(d["volume"]),
    price: asDec(d["price"]),
    order_id: String(d["order_id"]),
    commission: asDec(d["commission"]) ?? new Decimal(0),
    fee: asDec(d["fee"]) ?? new Decimal(0),
    swap: asDec(d["swap"]) ?? new Decimal(0),
    profit: asDec(d["profit"]) ?? new Decimal(0),
    balance: asDec(d["balance"]) ?? new Decimal(0),
    comment: (d["comment"] as string) ?? "",
    account_id: (d["account_id"] as string) ?? "",
  });
}

function campaignFrom(d: Dict): Campaign {
  return new Campaign({
    id: String(d["id"]),
    created_at: asDate(d["created_at"]) ?? new Date(0),
    name: (d["name"] as string) ?? "",
    macro_theme: (d["macro_theme"] as string) ?? "",
    catalyst: (d["catalyst"] as string) ?? "",
    note: (d["note"] as string) ?? "",
    blocks: (d["blocks"] as unknown[]) ?? [],
    conviction: (d["conviction"] as number | null) ?? null,
    kill_switch: (d["kill_switch"] as string) ?? "",
    closed: Boolean(d["closed"]),
    abandoned: Boolean(d["abandoned"]),
    abandon_correct: (d["abandon_correct"] as boolean | null) ?? null,
    account_id: (d["account_id"] as string) ?? "",
  });
}

export interface LoadResult {
  ideas: Map<string, Idea>;
  positions: Map<string, Position>;
  deals: Deal[];
}

// --------------------------------------------------------------------- journal

export class Store {
  protected _events: EventRecord[] = [];
  private _campaigns = new Map<string, Campaign>();
  // Cache du rejeu : load() est appelé plusieurs fois par requête (load +
  // campaigns), or les événements ne changent pas entre deux appels. Invalidé
  // dès qu'un événement est ajouté (voir append + surcharges).
  protected _loadCache: LoadResult | null = null;
  demo: boolean;

  constructor(opts: { demo?: boolean; events?: EventRecord[] } = {}) {
    this.demo = opts.demo ?? false;
    if (opts.events) this._events = [...opts.events];
  }

  /** Charge un journal existant (une ligne JSONL = un EventRecord). */
  static fromEvents(events: EventRecord[]): Store {
    return new Store({ events });
  }

  append(eventType: string, payload: Dict): EventRecord {
    const ev: EventRecord = {
      v: SCHEMA_VERSION,
      ts: new Date().toISOString(),
      type: eventType,
      payload: encode(payload),
    };
    if (this.demo) ev.demo = true;
    this._events.push(ev);
    this._loadCache = null;
    return ev;
  }

  events(): EventRecord[] {
    return this._events;
  }

  load(): LoadResult {
    if (this._loadCache) return this._loadCache;
    const ideas = new Map<string, Idea>();
    const positions = new Map<string, Position>();
    const deals = new Map<string, Deal>();
    this._campaigns = new Map<string, Campaign>();
    const opens = new Map<string, [string, OpenTrade]>();
    const attachments = new Map<string, Attachment>();

    // Imports annulés (import du mauvais fichier) : leur lot est neutralisé au
    // replay — rien n'est effacé (append-only), les positions/soldes du lot sont
    // simplement ignorés. Passe préalable pour connaître les lots révoqués.
    const revertedImports = new Set<string>();
    for (const ev of this.events()) {
      if (ev.type === "import_reverted") {
        const rp = decode(ev.payload) as Dict;
        if (rp["import_id"]) revertedImports.add(String(rp["import_id"]));
      }
    }

    for (const ev of this.events()) {
      const t = ev.type;
      const p = decode(ev.payload) as Dict;

      if (t === "position_imported") {
        if (p["import_id"] && revertedImports.has(String(p["import_id"]))) continue;
        const pos = positionFrom(p);
        positions.set(pos.uid, pos);
      } else if (t === "deal_imported") {
        if (p["import_id"] && revertedImports.has(String(p["import_id"]))) continue;
        const d = dealFrom(p);
        deals.set(d.deal_id, d);
      } else if (t === "thesis_created") {
        const idea = new Idea({
          id: String(p["id"]),
          created_at: asDate(p["created_at"]) ?? new Date(0),
          thesis: thesisFrom(p["thesis"] as Dict),
          status: (p["status"] as IdeaStatus) ?? IdeaStatus.ARMED,
          off_plan: Boolean(p["off_plan"]),
          label: (p["label"] as string) ?? "",
          campaign_id: (p["campaign_id"] as string | null) ?? null,
          late_thesis: Boolean(p["late_thesis"]),
          account_id: (p["account_id"] as string) ?? "",
        });
        ideas.set(idea.id, idea);
      } else if (t === "thesis_updated" && ideas.has(String(p["id"]))) {
        const idea = ideas.get(String(p["id"]))!;
        idea.thesis = thesisFrom(p["thesis"] as Dict);
        if (p["label"] !== null && p["label"] !== undefined) idea.label = String(p["label"]);
      } else if (t === "idea_abandoned" && ideas.has(String(p["id"]))) {
        ideas.get(String(p["id"]))!.status = IdeaStatus.ABANDONED;
      } else if (t === "trade_opened" && ideas.has(String(p["idea_id"]))) {
        const tr = openTradeFrom(p["trade"] as Dict);
        opens.set(tr.uid, [String(p["idea_id"]), tr]);
      } else if (t === "trade_updated" && opens.has(String(p["uid"]))) {
        const [iid, tr] = opens.get(String(p["uid"]))!;
        opens.set(String(p["uid"]), [iid, new OpenTrade({ ...otInit(tr), ...decodeOtOverrides(p) })]);
      } else if (t === "trade_cancelled") {
        opens.delete(String(p["uid"]));
      } else if (t === "capture_added") {
        const a = attachmentFrom(p["attachment"] as Dict);
        attachments.set(a.id, a);
      } else if (t === "capture_removed" && attachments.has(String(p["id"]))) {
        const a = attachments.get(String(p["id"]))!;
        attachments.set(a.id, new Attachment({ ...attachmentInit(a), removed: true }));
      } else if (t === "position_linked" && ideas.has(String(p["idea_id"]))) {
        const idea = ideas.get(String(p["idea_id"]))!;
        const uid = String(p["position_uid"]);
        if (!idea.position_uids.includes(uid)) idea.position_uids.push(uid);
      } else if (t === "add_secured" && ideas.has(String(p["idea_id"]))) {
        ideas.get(String(p["idea_id"]))!.secured_on_add.set(String(p["position_uid"]), Boolean(p["secured"]));
      } else if (t === "position_unlinked" && ideas.has(String(p["idea_id"]))) {
        const idea = ideas.get(String(p["idea_id"]))!;
        idea.position_uids = idea.position_uids.filter((u) => u !== String(p["position_uid"]));
      } else if (t === "review_completed" && ideas.has(String(p["id"]))) {
        const idea = ideas.get(String(p["id"]))!;
        idea.review = reviewFrom(p["review"] as Dict);
        idea.status = IdeaStatus.REVIEWED;
      } else if (t === "campaign_created") {
        const c = campaignFrom(p);
        this._campaigns.set(c.id, c);
      } else if (t === "campaign_updated" && this._campaigns.has(String(p["id"]))) {
        const c = this._campaigns.get(String(p["id"]))!;
        for (const [k, v] of Object.entries(p)) {
          if (["id", "created_at", "ideas", "attachments"].includes(k)) continue;
          if (k in c) (c as unknown as Dict)[k] = v;
        }
      } else if (t === "idea_attached" && ideas.has(String(p["idea_id"]))) {
        ideas.get(String(p["idea_id"]))!.campaign_id = String(p["campaign_id"]);
      } else if (t === "idea_detached" && ideas.has(String(p["idea_id"]))) {
        ideas.get(String(p["idea_id"]))!.campaign_id = null;
      } else if (t === "idea_marked_late" && ideas.has(String(p["id"]))) {
        ideas.get(String(p["id"]))!.late_thesis = Boolean(p["late"] ?? true);
      } else if (t === "idea_missed" && ideas.has(String(p["id"]))) {
        const rd = (p["review"] as Dict) ?? {};
        const mr = new MissedReview({
          setup_appeared: (rd["setup_appeared"] as MissedOutcome) ?? MissedOutcome.NO_SETUP,
          would_have_won: (rd["would_have_won"] as boolean | null) ?? null,
          reason: (rd["reason"] as string) ?? "",
          note: (rd["note"] as string) ?? "",
        });
        const idea = ideas.get(String(p["id"]))!;
        idea.missed_review = mr;
        idea.status = IdeaStatus.ABANDONED;
      } else if (t === "campaign_abandoned" && this._campaigns.has(String(p["id"]))) {
        const c = this._campaigns.get(String(p["id"]))!;
        c.abandoned = true;
        c.abandon_correct = (p["correct"] as boolean | null) ?? null;
      } else if (t === "ticket_stop_set" && ideas.has(String(p["idea_id"]))) {
        const idea = ideas.get(String(p["idea_id"]))!;
        idea.manual_stops.set(String(p["position_uid"]), asDec(p["stop"])!);
        idea.stop_evidence.set(String(p["position_uid"]), (p["evidence"] as StopEvidence) ?? StopEvidence.CAPTURE);
      }
    }

    // résolution des campagnes
    for (const c of this._campaigns.values()) c.ideas = [];
    for (const idea of ideas.values()) {
      if (idea.campaign_id && this._campaigns.has(idea.campaign_id)) {
        this._campaigns.get(idea.campaign_id)!.ideas.push(idea);
      }
    }

    // --- LE TICKET IMPORTÉ CONSOMME LE TRADE OUVERT (+ autolink par ticket)
    const closedUids = new Set(positions.keys());
    const closedTickets = new Map<string, Set<string>>();
    const positionsByTicket = new Map<string, string[]>();
    for (const [uidP, pos] of positions) {
      if (!closedTickets.has(pos.position_id)) closedTickets.set(pos.position_id, new Set());
      closedTickets.get(pos.position_id)!.add(pos.account_id);
      if (!positionsByTicket.has(pos.position_id)) positionsByTicket.set(pos.position_id, []);
      positionsByTicket.get(pos.position_id)!.push(uidP);
    }

    const stillOpen = new Map<string, OpenTrade[]>();
    const autolink = new Map<string, Set<string>>();
    for (const [uid, [ideaId, tr]] of opens) {
      const comptes = closedTickets.get(tr.ticket);
      let ferme = closedUids.has(uid);
      if (!ferme && comptes) {
        const trAcct = /^\d+$/.test(tr.account_id) ? tr.account_id : "";
        ferme = !trAcct || comptes.has("") || comptes.has(trAcct);
      }
      if (ferme) {
        for (const u of positionsByTicket.get(tr.ticket) ?? []) {
          if (!autolink.has(ideaId)) autolink.set(ideaId, new Set());
          autolink.get(ideaId)!.add(u);
        }
        continue;
      }
      if (!stillOpen.has(ideaId)) stillOpen.set(ideaId, []);
      stillOpen.get(ideaId)!.push(tr);
    }

    // captures par propriétaire
    const byOwner = new Map<string, Attachment[]>();
    for (const a of attachments.values()) {
      if (!byOwner.has(a.owner_id)) byOwner.set(a.owner_id, []);
      byOwner.get(a.owner_id)!.push(a);
    }
    for (const lst of byOwner.values()) {
      lst.sort((x, y) => (x.added_at?.getTime() ?? 0) - (y.added_at?.getTime() ?? 0));
    }
    for (const [cid, c] of this._campaigns) c.attachments = byOwner.get(cid) ?? [];

    // résolution des positions + recalcul des statuts
    for (const idea of ideas.values()) {
      const uids = [...idea.position_uids];
      for (const u of autolink.get(idea.id) ?? []) if (!uids.includes(u)) uids.push(u);
      idea.positions = uids.map((u) => positions.get(u)).filter((x): x is Position => x !== undefined);
      idea.open_trades = (stillOpen.get(idea.id) ?? []).sort((a, b) => a.open_time.getTime() - b.open_time.getTime());
      idea.attachments = byOwner.get(idea.id) ?? [];
      if (idea.status === IdeaStatus.ABANDONED || idea.status === IdeaStatus.REVIEWED) continue;
      if (idea.open_trades.length) idea.status = IdeaStatus.RUNNING;
      else if (idea.positions.length) idea.status = IdeaStatus.CLOSED;
      else if (idea.thesis) idea.status = IdeaStatus.ARMED;
    }

    const dealsList = [...deals.values()].sort((a, b) => a.time.getTime() - b.time.getTime());
    this._loadCache = { ideas, positions, deals: dealsList };
    return this._loadCache;
  }

  // --- API haut niveau

  create_thesis(thesis: Thesis, opts: { label?: string; off_plan?: boolean; account_id?: string; created_at?: Date } = {}): Idea {
    const idea = new Idea({
      thesis,
      status: IdeaStatus.ARMED,
      off_plan: opts.off_plan ?? false,
      label: opts.label ?? "",
      account_id: opts.account_id ?? "",
    });
    if (opts.created_at) idea.created_at = opts.created_at;
    this.append("thesis_created", {
      id: idea.id,
      created_at: idea.created_at,
      thesis,
      status: idea.status,
      off_plan: idea.off_plan,
      label: idea.label,
      account_id: idea.account_id,
    });
    return idea;
  }

  open_trade(ideaId: string, trade: OpenTrade): OpenTrade {
    this.append("trade_opened", { idea_id: ideaId, trade });
    return trade;
  }
  update_trade(uid: string, champs: Dict): void {
    this.append("trade_updated", { uid, ...champs });
  }
  cancel_trade(uid: string, reason = ""): void {
    this.append("trade_cancelled", { uid, reason });
  }
  add_capture(attachment: Attachment): Attachment {
    this.append("capture_added", { attachment });
    return attachment;
  }
  remove_capture(attachmentId: string): void {
    this.append("capture_removed", { id: attachmentId });
  }
  update_thesis(ideaId: string, thesis: Thesis, label: string | null = null): void {
    this.append("thesis_updated", { id: ideaId, thesis, label });
  }
  abandon(ideaId: string): void {
    this.append("idea_abandoned", { id: ideaId });
  }

  import_report(positions: Position[], deals: Deal[]): Position[] {
    const { positions: knownPos, deals: knownDeals } = this.load();
    const knownDealIds = new Set(knownDeals.map((d) => d.deal_id));
    const fresh = positions.filter((p) => !knownPos.has(p.uid));
    const freshDeals = deals.filter((d) => !knownDealIds.has(d.deal_id));
    if (!fresh.length && !freshDeals.length) return fresh;
    // Chaque import forme un LOT (import_id) : ça le rend annulable en bloc si
    // l'utilisateur a déposé le mauvais fichier (revert_import).
    const importId = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    for (const p of fresh) this.append("position_imported", { ...(p as unknown as Dict), import_id: importId });
    for (const d of freshDeals) this.append("deal_imported", { ...(d as unknown as Dict), import_id: importId });
    return fresh;
  }

  /** Annule un lot d'import (neutralisé au replay, append-only). */
  revert_import(importId: string): void {
    this.append("import_reverted", { import_id: importId });
  }

  /** Marque le passage à une nouvelle phase du challenge (p2, funded) pour un
   *  compte : la conformité repart de la base à partir de cette date. */
  advance_phase(accountId: string, toPhase: string, at: Date): void {
    this.append("phase_advanced", { account_id: accountId, to_phase: toPhase, at });
  }

  /** Date de début de la phase COURANTE d'un compte (dernier passage), ou null. */
  phaseStart(accountId: string): Date | null {
    let last: Date | null = null;
    for (const ev of this.events()) {
      if (ev.type !== "phase_advanced") continue;
      const p = decode(ev.payload) as Dict;
      if (String(p["account_id"] ?? "") !== accountId) continue;
      const at = asDate(p["at"]);
      if (at && (!last || at > last)) last = at;
    }
    return last;
  }

  /**
   * Les lots d'import ENCORE actifs (non annulés), du plus récent au plus ancien —
   * pour proposer « annuler le dernier import » après un mauvais fichier.
   */
  undoableImports(): { import_id: string; positions: number; deals: number; when: string }[] {
    const reverted = new Set<string>();
    for (const ev of this.events()) {
      if (ev.type === "import_reverted") {
        const rp = decode(ev.payload) as Dict;
        if (rp["import_id"]) reverted.add(String(rp["import_id"]));
      }
    }
    const batches = new Map<string, { positions: number; deals: number; when: string }>();
    for (const ev of this.events()) {
      if (ev.type !== "position_imported" && ev.type !== "deal_imported") continue;
      const p = decode(ev.payload) as Dict;
      const id = p["import_id"] ? String(p["import_id"]) : "";
      if (!id || reverted.has(id)) continue;
      const b = batches.get(id) ?? { positions: 0, deals: 0, when: ev.ts };
      if (ev.type === "position_imported") b.positions += 1;
      else b.deals += 1;
      b.when = ev.ts;
      batches.set(id, b);
    }
    return [...batches.entries()]
      .map(([import_id, b]) => ({ import_id, ...b }))
      .sort((a, b) => (a.when < b.when ? 1 : -1));
  }

  link(ideaId: string, positionUid: string): void {
    this.append("position_linked", { idea_id: ideaId, position_uid: positionUid });
  }
  mark_late(ideaId: string, late = true): void {
    this.append("idea_marked_late", { id: ideaId, late });
  }
  unlink(ideaId: string, positionUid: string): void {
    this.append("position_unlinked", { idea_id: ideaId, position_uid: positionUid });
  }
  set_secured(ideaId: string, positionUid: string, secured: boolean): void {
    this.append("add_secured", { idea_id: ideaId, position_uid: positionUid, secured });
  }
  complete_review(ideaId: string, review: Review): void {
    this.append("review_completed", { id: ideaId, review });
  }

  campaigns(): Map<string, Campaign> {
    this.load();
    return this._campaigns;
  }
  create_campaign(campaign: Campaign): Campaign {
    this.append("campaign_created", campaign as unknown as Dict);
    return campaign;
  }
  update_campaign(campaign: Campaign): void {
    this.append("campaign_updated", campaign as unknown as Dict);
  }
  abandon_campaign(campaignId: string, correct: boolean | null = null): void {
    this.append("campaign_abandoned", { id: campaignId, correct });
  }
  review_missed(ideaId: string, review: MissedReview): void {
    this.append("idea_missed", { id: ideaId, review });
  }
  attach(ideaId: string, campaignId: string): void {
    this.append("idea_attached", { idea_id: ideaId, campaign_id: campaignId });
  }
  detach(ideaId: string): void {
    this.append("idea_detached", { idea_id: ideaId });
  }
  set_ticket_stop(ideaId: string, positionUid: string, stop: Decimal, evidence: StopEvidence = StopEvidence.CAPTURE): void {
    this.append("ticket_stop_set", { idea_id: ideaId, position_uid: positionUid, stop, evidence });
  }

  pending_trades(): Map<string, [string, OpenTrade]> {
    const { ideas } = this.load();
    const out = new Map<string, [string, OpenTrade]>();
    for (const idea of ideas.values()) for (const tr of idea.open_trades) out.set(tr.ticket, [idea.id, tr]);
    return out;
  }

  orphans(): Position[] {
    const { ideas, positions } = this.load();
    const linked = new Set<string>();
    for (const i of ideas.values()) for (const p of i.positions) linked.add(p.uid);
    return [...positions.values()].filter((p) => !linked.has(p.uid));
  }
}

// helpers internes
function attachmentInit(a: Attachment): ConstructorParameters<typeof Attachment>[0] {
  return {
    id: a.id, owner_type: a.owner_type, owner_id: a.owner_id, path: a.path,
    original_name: a.original_name, kind: a.kind, caption: a.caption,
    added_at: a.added_at, removed: a.removed,
  };
}
function otInit(tr: OpenTrade): ConstructorParameters<typeof OpenTrade>[0] {
  return {
    ticket: tr.ticket, symbol: tr.symbol, direction: tr.direction, volume: tr.volume,
    open_time: tr.open_time, open_price: tr.open_price, account_id: tr.account_id,
    stop: tr.stop, take_profit: tr.take_profit, last_price: tr.last_price,
    last_price_at: tr.last_price_at, note: tr.note,
  };
}
function decodeOtOverrides(p: Dict): Partial<ConstructorParameters<typeof OpenTrade>[0]> {
  const champs: Dict = {};
  for (const k of ["stop", "take_profit", "last_price", "last_price_at", "note"] as const) {
    if (k in p) champs[k] = p[k];
  }
  return champs as Partial<ConstructorParameters<typeof OpenTrade>[0]>;
}
