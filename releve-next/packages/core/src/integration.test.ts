// Cycle complet sur le vrai fichier — port de tests/test_integration.py.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Decimal } from "./decimal";
import { Store } from "./store";
import { parseReport } from "./parser";
import { SpecBook } from "./specs";
import { candidates } from "./matcher";
import {
  expectancyOf, rMultiples, drawdown, dealCurve, equityCurve,
} from "./metrics";
import { businessDaysBetween, reviewDue, businessDaysLeft, REVIEW_WINDOW_BUSINESS_DAYS } from "./clock";
import { thesisLines } from "./challenge";
import {
  Campaign, Direction, IdeaStatus, MissedOutcome, MissedReview, Position,
  Review, RiskSource, StopEvidence, Thesis, ThesisOutcome,
} from "./models";

const FIXTURE = readFileSync(new URL("./__fixtures__/ReportHistory-14124899.html", import.meta.url));
const D = (s: string) => new Decimal(s);
const close = (v: Decimal, s: string, abs = "1") => v.minus(s).abs().lte(abs);

function pos(pid: string, sym: string, dir: Direction, entry: string, closeP: string,
  gross: string, day: number, sl?: string): Position {
  return new Position({
    position_id: pid, account_id: "A", symbol: sym, direction: dir, volume: D("1"),
    open_time: new Date(Date.UTC(2026, 6, day, 9)), open_price: D(entry),
    close_time: new Date(Date.UTC(2026, 6, day, 18)), close_price: D(closeP),
    commission: D("0"), swap: D("0"), profit_gross: D(gross),
    sl_final: sl ? D(sl) : null,
  });
}

describe("cycle complet BTC (fixture réelle)", () => {
  it("thèse → import → appariement → review → métriques", () => {
    const report = parseReport(FIXTURE);
    const store = new Store();
    const idea = store.create_thesis(
      new Thesis({
        instrument: "BTCUSD", direction: Direction.SELL, macro_theme: "Crypto — liquidité",
        catalyst: "Resserrement Fed", entry_planned: D("63791.42"), stop_initial: D("64700.51"),
        risk_pct: D("0.6"), conviction: 4, thesis_kill_switch: "Un pivot dovish de la Fed.",
        risk_source: RiskSource.COMPUTED,
      }),
      { label: "Short BTC — resserrement", created_at: new Date(Date.UTC(2026, 6, 7, 12, 0)) },
    );

    const fresh = store.import_report(report.positions, report.deals);
    expect(fresh.length).toBe(3);
    expect(store.import_report(report.positions, report.deals)).toEqual([]);

    let { positions, deals } = store.load();
    expect(positions.size).toBe(3);
    expect(deals.length).toBe(7);

    let ideas = store.load().ideas;
    let orphans = store.orphans();
    expect(orphans.length).toBe(3);
    for (const p of [...orphans].sort((a, b) => a.open_time.getTime() - b.open_time.getTime())) {
      const cands = candidates(p, [...ideas.values()]);
      expect(cands.length).toBeGreaterThan(0);
      expect(cands[0]!.idea.id).toBe(idea.id);
      store.link(idea.id, p.uid);
      ideas = store.load().ideas;
    }
    expect(store.orphans()).toEqual([]);

    const loaded = store.load();
    const i = loaded.ideas.get(idea.id)!;
    const book = new SpecBook([...loaded.positions.values()]);

    expect(i.positions.length).toBe(3);
    expect(i.pnl_net.eq("-588.74")).toBe(true);
    expect(i.adds.length).toBe(2);
    expect(i.initial_position!.position_id).toBe("251022835");

    const risks = i.ticket_risks(book);
    expect(risks.size).toBe(3);
    expect([...risks.values()].every((v) => v !== null)).toBe(true);
    expect(close(i.risk_realized(book)!, "1556.82")).toBe(true);

    const r = i.r_multiple(book) as Decimal;
    expect(r.gt("-0.42") && r.lt("-0.34")).toBe(true);

    const peak = i.max_concurrent_risk(book)!;
    expect(close(peak, "1105.76")).toBe(true);
    expect(peak.gt("600")).toBe(true);

    expect(i.pnl_initial.eq("380.36")).toBe(true);
    expect(i.pnl_adds.eq("-969.10")).toBe(true);

    store.complete_review(idea.id, new Review({
      entry_in_zone: true, size_conforme: true, stop_at_invalidation: true,
      stop_never_widened: false, exit_per_plan: false, thesis_outcome: ThesisOutcome.WRONG,
      lesson: "Ajouté sur une thèse qui ne se confirmait pas.",
    }));
    const i2 = store.load().ideas.get(idea.id)!;
    expect(i2.discipline_score).toBe(3);
    expect(i2.status).toBe(IdeaStatus.REVIEWED);

    const exp = expectancyOf(rMultiples([i2]))!;
    expect(exp.n).toBe(1);
    expect(exp.win_rate).toBe(0.0);

    deals = store.load().deals;
    const dd = drawdown(dealCurve(deals))!;
    expect(Math.abs(dd.max_dd_pct - 0.99) < 0.01).toBe(true);
    expect(Math.abs(dd.max_dd_abs - 985.94) < 0.01).toBe(true);
    const ddDaily = drawdown(equityCurve(deals))!;
    expect(Math.abs(ddDaily.max_dd_pct - 0.59) < 0.01).toBe(true);
  });

  it("réimport après lien ne casse rien", () => {
    const report = parseReport(FIXTURE);
    const store = new Store();
    store.import_report(report.positions, report.deals);
    const idea = store.create_thesis(new Thesis({
      instrument: "BTCUSD", direction: Direction.SELL, entry_planned: D("63791.42"), stop_initial: D("64700.51") }));
    for (const uid of store.load().positions.keys()) store.link(idea.id, uid);
    const before = [...store.load().ideas.get(idea.id)!.position_uids];
    store.import_report(report.positions, report.deals);
    const after = store.load().ideas.get(idea.id)!.position_uids;
    expect(after).toEqual(before);
    expect(store.orphans()).toEqual([]);
  });

  it("un trade sans thèse est hors-plan", () => {
    const report = parseReport(FIXTURE);
    const store = new Store();
    store.import_report(report.positions, report.deals);
    const ideas = store.load().ideas;
    for (const p of store.orphans()) expect(candidates(p, [...ideas.values()])).toEqual([]);
    for (const p of store.orphans()) {
      const i = store.create_thesis(
        new Thesis({ instrument: p.symbol, direction: p.direction, entry_planned: p.open_price, risk_source: RiskSource.UNKNOWN }),
        { off_plan: true });
      store.link(i.id, p.uid);
    }
    const execs = [...store.load().ideas.values()].filter((i) => i.is_executed);
    expect(execs.length).toBeGreaterThan(0);
    expect(execs.every((i) => i.off_plan)).toBe(true);
  });
});

describe("journalisation différée & rétrocompat", () => {
  it("une idée journalisée le soir ne dégrade rien", () => {
    const report = parseReport(FIXTURE);
    const store = new Store();
    store.import_report(report.positions, report.deals);
    const idea = store.create_thesis(new Thesis({
      instrument: "BTCUSD", direction: Direction.SELL, entry_planned: D("63791.42"), stop_initial: D("64700.51") }));
    const ideas = store.load().ideas;
    const orphans = [...store.orphans()].sort((a, b) => a.open_time.getTime() - b.open_time.getTime());
    const cands = candidates(orphans[0]!, [...ideas.values()], 100000);
    expect(cands.length).toBeGreaterThan(0);
    store.link(idea.id, orphans[0]!.uid);
    expect(store.load().ideas.get(idea.id)!.risk_source).toBe(RiskSource.COMPUTED);
  });

  it("un ancien journal marqué tardif se relit sans dégrader", () => {
    const report = parseReport(FIXTURE);
    const store = new Store();
    store.import_report(report.positions, report.deals);
    const idea = store.create_thesis(new Thesis({
      instrument: "BTCUSD", direction: Direction.SELL, entry_planned: D("63791.42"), stop_initial: D("64700.51") }));
    const first = [...store.orphans()].sort((a, b) => a.open_time.getTime() - b.open_time.getTime())[0]!;
    store.link(idea.id, first.uid);
    store.mark_late(idea.id);
    const i = store.load().ideas.get(idea.id)!;
    expect(i.late_thesis).toBe(true);
    expect(i.risk_source).toBe(RiskSource.COMPUTED);
  });

  it("une campagne agrège deux instruments", () => {
    const store = new Store();
    const camp = store.create_campaign(new Campaign({ name: "Dollar fort — Fed hawkish", macro_theme: "Fed / taux US", conviction: 4 }));
    const mk = (sym: string, dir: Direction, entry: string, stop: string, closeP: string, gross: string, day: number) => {
      const idea = store.create_thesis(new Thesis({ instrument: sym, direction: dir, entry_planned: D(entry), stop_initial: D(stop), risk_source: RiskSource.COMPUTED }), { label: `${sym} ${dir}` });
      store.attach(idea.id, camp.id);
      const p = pos(`P${day}`, sym, dir, entry, closeP, gross, day);
      store.import_report([p], []);
      store.link(idea.id, p.uid);
    };
    mk("EURUSD", Direction.SELL, "1.1000", "1.1100", "1.1040", "-400", 1);
    mk("USDJPY", Direction.BUY, "160.00", "159.00", "161.20", "1200", 2);

    const c = store.campaigns().get(camp.id)!;
    expect(c.executed_ideas.length).toBe(2);
    expect(c.instruments).toEqual(["EURUSD", "USDJPY"]);
    expect(c.pnl_net.eq("800")).toBe(true);

    const book = new SpecBook([...store.load().positions.values()]);
    const rs = c.executed_ideas.map((i) => Number(i.r_multiple(book))).sort((a, b) => a - b);
    expect(Math.abs(rs[0]! - -0.4) < 0.01).toBe(true);
    expect(Math.abs(rs[1]! - 1.2) < 0.01).toBe(true);
    expect(Math.abs(Number(c.r_total(book)) - 0.8) < 0.01).toBe(true);
    expect(Math.abs(Number(c.r_weighted(book)) - 0.4) < 0.01).toBe(true);
  });

  it("stop manuel sauve le R d'une idée entière ; l'add n'hérite pas du noyau", () => {
    const store = new Store();
    const idea = store.create_thesis(new Thesis({
      instrument: "BTCUSD", direction: Direction.SELL, entry_planned: D("63000"), stop_initial: D("63600"), risk_source: RiskSource.COMPUTED }));
    const noyau = pos("A1", "BTCUSD", Direction.SELL, "63000", "62500", "500", 1, "63600");
    const addBe = pos("A2", "BTCUSD", Direction.SELL, "62500", "62400", "100", 2, "62505");
    store.import_report([noyau, addBe], []);
    store.link(idea.id, noyau.uid);
    store.link(idea.id, addBe.uid);

    let loaded = store.load();
    let i = loaded.ideas.get(idea.id)!;
    const book = new SpecBook([...loaded.positions.values()]);
    expect(i.tickets_needing_stop().map((p) => p.position_id)).toEqual(["A2"]);
    expect(i.r_multiple(book)).toBeNull();

    store.set_ticket_stop(idea.id, addBe.uid, D("62900"));
    i = store.load().ideas.get(idea.id)!;
    const risks = i.ticket_risks(book);
    expect(risks.get("A1")!.eq("600")).toBe(true);
    expect(risks.get("A2")!.eq("400")).toBe(true);
    expect(i.risk_realized(book)!.eq("1000")).toBe(true);
    expect(i.risk_source).toBe(RiskSource.COMPUTED);
  });

  it("un stop saisi (même MEMORY) ne dégrade plus l'idée", () => {
    const store = new Store();
    const idea = store.create_thesis(new Thesis({
      instrument: "BTCUSD", direction: Direction.SELL, entry_planned: D("63000"), stop_initial: D("63600"), risk_source: RiskSource.COMPUTED }));
    const add = pos("A2", "BTCUSD", Direction.SELL, "62500", "62400", "100", 2, "62505");
    store.import_report([add], []);
    store.link(idea.id, add.uid);
    store.set_ticket_stop(idea.id, add.uid, D("62900"), StopEvidence.MEMORY);
    const i = store.load().ideas.get(idea.id)!;
    expect(i.stop_for(add)[0]!.eq("62900")).toBe(true);
    expect(i.risk_source).toBe(RiskSource.COMPUTED);
  });

  it("abandonner une thèse ne l'efface pas et l'empêche de capter", () => {
    const store = new Store();
    const idea = store.create_thesis(new Thesis({
      instrument: "BTCUSD", direction: Direction.SELL, entry_planned: D("63000"), stop_initial: D("63600") }), { label: "Short BTC — à abandonner" });
    expect(store.load().ideas.get(idea.id)!.status).toBe(IdeaStatus.ARMED);
    store.abandon(idea.id);
    const ideas = store.load().ideas;
    const ab = ideas.get(idea.id)!;
    expect(ab.status).toBe(IdeaStatus.ABANDONED);
    expect(ab.thesis!.stop_initial!.eq("63600")).toBe(true);
    expect(ab.label).toBe("Short BTC — à abandonner");
    const p = pos("X1", "BTCUSD", Direction.SELL, "63000", "62500", "500", 20);
    expect(candidates(p, [...ideas.values()])).toEqual([]);
  });
});

describe("fenêtre 5 jours ouvrés & vue par thèse", () => {
  it("la fenêtre de 5 jours ouvrés saute le week-end", () => {
    const mercredi = new Date(Date.UTC(2026, 6, 15, 10, 0));
    expect(businessDaysBetween(mercredi, new Date(Date.UTC(2026, 6, 17, 10)))).toBe(2);
    expect(businessDaysBetween(mercredi, new Date(Date.UTC(2026, 6, 19, 10)))).toBe(2);
    expect(businessDaysBetween(mercredi, new Date(Date.UTC(2026, 6, 20, 10)))).toBe(3);
    expect(reviewDue(mercredi, new Date(Date.UTC(2026, 6, 21, 10)))).toBe(false);
    expect(reviewDue(mercredi, new Date(Date.UTC(2026, 6, 22, 10)))).toBe(true);
    expect(businessDaysLeft(mercredi, new Date(Date.UTC(2026, 6, 20, 10)))).toBe(2);
  });

  it("business_days_between ne renvoie jamais de négatif", () => {
    const mercredi = new Date(Date.UTC(2026, 6, 15, 10, 0));
    const lendemain = new Date(Date.UTC(2026, 6, 16, 10, 0));
    expect(businessDaysBetween(mercredi, mercredi)).toBe(0);
    expect(businessDaysBetween(lendemain, mercredi)).toBe(0);
    expect(reviewDue(mercredi, new Date(Date.UTC(2026, 6, 10, 10)))).toBe(false);
    expect(businessDaysLeft(mercredi, new Date(Date.UTC(2026, 6, 10, 10)))).toBe(REVIEW_WINDOW_BUSINESS_DAYS);
  });

  it("review d'une idée abandonnée (occasion, pas raison)", () => {
    const store = new Store();
    const idea = store.create_thesis(new Thesis({
      instrument: "BTCUSD", direction: Direction.SELL, entry_planned: D("63000"), stop_initial: D("63600") }), { label: "Short BTC — jamais pris" });
    store.review_missed(idea.id, new MissedReview({
      setup_appeared: MissedOutcome.HESITATED, would_have_won: true,
      reason: "pas devant l'écran", note: "Mon setup s'est présenté, je n'étais pas là." }));
    const i = store.load().ideas.get(idea.id)!;
    expect(i.status).toBe(IdeaStatus.ABANDONED);
    expect(i.missed_review!.setup_appeared).toBe(MissedOutcome.HESITATED);
    expect(i.missed_review!.would_have_won).toBe(true);
    expect(i.thesis!.stop_initial!.eq("63600")).toBe(true);
  });

  it("abandonner une thèse libère ses idées", () => {
    const store = new Store();
    const camp = store.create_campaign(new Campaign({ name: "Dollar fort" }));
    const idea = store.create_thesis(new Thesis({
      instrument: "EURUSD", direction: Direction.SELL, entry_planned: D("1.1000"), stop_initial: D("1.1100"), risk_source: RiskSource.COMPUTED }), { label: "EURUSD sell" });
    store.attach(idea.id, camp.id);
    const p = pos("P1", "EURUSD", Direction.SELL, "1.1000", "1.0900", "1000", 1);
    store.import_report([p], []);
    store.link(idea.id, p.uid);

    let loaded = store.load();
    let book = new SpecBook([...loaded.positions.values()]);
    let execs = [...loaded.ideas.values()].filter((i) => i.is_executed);
    let lignes = thesisLines(execs, store.campaigns(), book);
    expect(lignes.length).toBe(1);
    expect(lignes[0]!.is_campaign).toBe(true);

    store.abandon_campaign(camp.id);
    loaded = store.load();
    execs = [...loaded.ideas.values()].filter((i) => i.is_executed);
    lignes = thesisLines(execs, store.campaigns(), book);
    expect(lignes.length).toBe(1);
    expect(lignes[0]!.is_campaign).toBe(false);
    expect(lignes[0]!.pnl_net.eq("1000")).toBe(true);
  });

  it("une idée sans thèse apparaît quand même", () => {
    const store = new Store();
    const camp = store.create_campaign(new Campaign({ name: "Risk-off" }));
    const mk = (sym: string, label: string, gross: string, day: number, attach: boolean) => {
      const i = store.create_thesis(new Thesis({ instrument: sym, direction: Direction.SELL, entry_planned: D("100"), stop_initial: D("110"), risk_source: RiskSource.COMPUTED }), { label });
      if (attach) store.attach(i.id, camp.id);
      const p = new Position({ position_id: `P${day}`, account_id: "A", symbol: sym, direction: Direction.SELL, volume: D("1"),
        open_time: new Date(Date.UTC(2026, 6, day, 9)), open_price: D("100"), close_time: new Date(Date.UTC(2026, 6, day, 18)),
        close_price: D("100").minus(gross), commission: D("0"), swap: D("0"), profit_gross: D(gross) });
      store.import_report([p], []);
      store.link(i.id, p.uid);
    };
    mk("XAUUSD", "Or", "50", 1, true);
    mk("US30", "Indice", "30", 2, false);

    const loaded = store.load();
    const book = new SpecBook([...loaded.positions.values()]);
    const execs = [...loaded.ideas.values()].filter((i) => i.is_executed);
    const lignes = thesisLines(execs, store.campaigns(), book);
    expect(lignes.length).toBe(2);
    expect(lignes.reduce((a, l) => a.plus(l.pnl_net), new Decimal(0)).eq("80")).toBe(true);
    expect(lignes.some((l) => l.is_campaign)).toBe(true);
    expect(lignes.some((l) => !l.is_campaign)).toBe(true);
  });
});
