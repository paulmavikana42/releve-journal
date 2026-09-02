// Port de tests/test_analyse.py — l'unité d'analyse et ce qui en découle.
// (Le test UI _couper_a_zero de app/views/dashboard reste hors du moteur.)
import { describe, it, expect } from "vitest";
import { Decimal } from "./decimal";
import {
  analysisRows, decisionMatrix, expectancyOfRows, pctResults, dailyReturnsFromRows,
  sharpe, dailyPnl, dailyPnlByTicket, dailyPnlRealise, Unit,
} from "./metrics";
import { candidates } from "./matcher";
import {
  Campaign, Deal, Direction, Idea, Position, Quadrant, Review, RiskSource, Thesis, ThesisOutcome,
} from "./models";

const EQUITY = new Decimal("100000");

function reviewScore(score: number): Review {
  const flags = [false, false, false, false, false].map((_, i) => i < score);
  return new Review({
    entry_in_zone: flags[0], size_conforme: flags[1], stop_at_invalidation: flags[2],
    stop_never_widened: flags[3], exit_per_plan: flags[4], thesis_outcome: ThesisOutcome.CORRECT,
  });
}

function idee(symbole: string, pnl: string, jour: number, campagne: string | null = null,
  score: number | null = null, risque = "1000"): Idea {
  const t = new Thesis({
    instrument: symbole, direction: Direction.SELL, entry_planned: new Decimal("100"),
    stop_initial: new Decimal("100").plus(new Decimal(risque).div(10)),
    risk_pct: new Decimal("1"), risk_source: RiskSource.COMPUTED,
  });
  const i = new Idea({ thesis: t, campaign_id: campagne });
  i.positions = [new Position({
    position_id: `${symbole}${jour}`, account_id: "A", symbol: symbole, direction: Direction.SELL,
    volume: new Decimal("1"), open_time: new Date(Date.UTC(2026, 6, jour, 9, 0)),
    open_price: new Decimal("100"), close_time: new Date(Date.UTC(2026, 6, jour, 17, 0)),
    close_price: new Decimal("100").minus(new Decimal(pnl).div(10)),
    commission: new Decimal("0"), swap: new Decimal("0"), profit_gross: new Decimal(pnl),
  })];
  if (score !== null) i.review = reviewScore(score);
  return i;
}

function ticket(pid: string, ouvert: Date, ferme: Date, pnl = "0", vol = "1"): Position {
  return new Position({
    position_id: pid, account_id: "A", symbol: "UKOUSD", direction: Direction.BUY,
    volume: new Decimal(vol), open_time: ouvert, open_price: new Decimal("93.9"),
    close_time: ferme, close_price: new Decimal("94.0"), commission: new Decimal("0"),
    swap: new Decimal("0"), profit_gross: new Decimal(pnl),
  });
}

const camps = (c: Campaign) => new Map([[c.id, c]]);

describe("l'unité d'analyse", () => {
  it("par défaut une thèse compte pour une seule décision", () => {
    const camp = new Campaign({ id: "c1", name: "Dollar fort" });
    const ideas = [idee("EURUSD", "1000", 6, "c1"), idee("USDJPY", "-500", 7, "c1"), idee("XAUUSD", "500", 8)];
    const rows = analysisRows(ideas, camps(camp), Unit.THESIS);
    expect(rows.length).toBe(2);
    const these = rows.find((l) => l.is_campaign)!;
    expect(these.n_ideas).toBe(2);
    expect(these.pnl).toBe(500.0);
    expect(these.r).toBeCloseTo(0.5, 6);
  });

  it("le mode par idée compte chaque jambe", () => {
    const camp = new Campaign({ id: "c1", name: "Dollar fort" });
    const ideas = [idee("EURUSD", "1000", 6, "c1"), idee("USDJPY", "-500", 7, "c1"), idee("XAUUSD", "500", 8)];
    const rows = analysisRows(ideas, camps(camp), Unit.IDEA);
    expect(rows.length).toBe(3);
    expect(rows.every((l) => !l.is_campaign)).toBe(true);
  });

  it("le mode change l'échantillon donc la confiance", () => {
    const camp = new Campaign({ id: "c1", name: "Dollar fort" });
    const ideas = [idee("EURUSD", "1000", 6, "c1"), idee("USDJPY", "-500", 7, "c1"), idee("XAUUSD", "500", 8)];
    expect(expectancyOfRows(analysisRows(ideas, camps(camp), Unit.THESIS))!.n).toBe(2);
    expect(expectancyOfRows(analysisRows(ideas, camps(camp), Unit.IDEA))!.n).toBe(3);
  });

  it("une thèse dont une jambe n'a pas de R n'a pas de R", () => {
    const camp = new Campaign({ id: "c1", name: "Dollar fort" });
    const sansR = idee("USDJPY", "-500", 7, "c1");
    sansR.thesis!.stop_initial = null;
    const rows = analysisRows([idee("EURUSD", "1000", 6, "c1"), sansR], camps(camp), Unit.THESIS);
    expect(rows[0]!.r).toBeNull();
    expect(rows[0]!.pnl).toBe(500.0);
  });

  it("une thèse abandonnée ne regroupe plus rien", () => {
    const camp = new Campaign({ id: "c1", name: "Abandonnée", abandoned: true });
    const rows = analysisRows([idee("EURUSD", "1000", 6, "c1")], camps(camp), Unit.THESIS);
    expect(rows.length).toBe(1);
    expect(rows[0]!.is_campaign).toBe(false);
  });
});

describe("les métriques", () => {
  it("gain moyen et perte moyenne", () => {
    const ideas = [idee("EURUSD", "1000", 6), idee("USDJPY", "2000", 7), idee("XAUUSD", "-500", 8)];
    const exp = expectancyOfRows(analysisRows(ideas, null, Unit.IDEA))!;
    expect(exp.avg_win_r).toBeCloseTo(1.5, 6);
    expect(exp.avg_loss_r).toBeCloseTo(-0.5, 6);
  });

  it("les résultats en pourcentage du compte", () => {
    const rows = analysisRows([idee("EURUSD", "1000", 6)], null, Unit.IDEA);
    const pct = pctResults(rows, EQUITY);
    expect(pct.length).toBe(1);
    expect(pct[0]!).toBeCloseTo(1.0, 6);
  });

  it("Sharpe calculable sans les soldes du broker", () => {
    const ideas = Array.from({ length: 10 }, (_, k) => idee("EURUSD", "1000", 6 + k));
    const rows = analysisRows(ideas, null, Unit.IDEA);
    const rets = dailyReturnsFromRows(rows, EQUITY);
    expect(rets.length).toBe(10);
    expect(sharpe(rets)).not.toBeNull();
  });

  it("le pnl par jour ne compte que les clôtures", () => {
    const ideas = [idee("EURUSD", "1000", 6), idee("USDJPY", "-400", 6), idee("XAUUSD", "500", 9)];
    const parJour = dailyPnl(analysisRows(ideas, null, Unit.IDEA));
    expect(parJour.get("2026-07-06")).toBe(600.0);
    expect(parJour.get("2026-07-09")).toBe(500.0);
    expect(parJour.has("2026-07-07")).toBe(false);
  });
});

describe("la matrice décision × résultat", () => {
  it("chiffre ce que chaque case coûte", () => {
    const ideas = [idee("EURUSD", "1000", 6, null, 5), idee("USDJPY", "-3000", 7, null, 2)];
    const dm = decisionMatrix(ideas, null, Unit.IDEA, null, EQUITY);
    const erreur = dm.get(Quadrant.ERROR);
    expect(erreur.n).toBe(1);
    expect(erreur.pnl).toBe(-3000.0);
    expect(erreur.pct!).toBeCloseTo(-3.0, 6);
    expect(dm.get(Quadrant.MASTERY).n).toBe(1);
  });

  it("une thèse à moitié relue n'est pas jugée", () => {
    const camp = new Campaign({ id: "c1", name: "Dollar fort" });
    const ideas = [idee("EURUSD", "1000", 6, "c1", 5), idee("USDJPY", "-500", 7, "c1")];
    const dm = decisionMatrix(ideas, camps(camp), Unit.THESIS, null, EQUITY);
    expect(dm.n_reviewed).toBe(0);
    expect(dm.n_pending).toBe(1);
  });

  it("sans capital de référence le pourcentage est absent, pas nul", () => {
    const dm = decisionMatrix([idee("EURUSD", "1000", 6, null, 5)], null, Unit.IDEA, null, null);
    expect(dm.get(Quadrant.MASTERY).pct).toBeNull();
  });
});

describe("deux trades ≠ un trade et son renfort", () => {
  it("un ticket ouvert après la clôture n'est pas un renforcement", () => {
    const id = new Idea({ thesis: new Thesis({ instrument: "UKOUSD", direction: Direction.BUY, conviction: 5 }) });
    id.positions = [ticket("254724773", new Date(Date.UTC(2026, 6, 23, 8, 42)), new Date(Date.UTC(2026, 6, 24, 11, 49)))];
    const nouveau = ticket("255138642", new Date(Date.UTC(2026, 6, 24, 13, 35)), new Date(Date.UTC(2026, 6, 24, 18, 12)));
    expect(candidates(nouveau, [id])).toEqual([]);
  });

  it("un vrai renforcement reste proposé", () => {
    const id = new Idea({ thesis: new Thesis({ instrument: "UKOUSD", direction: Direction.BUY }) });
    id.positions = [ticket("1", new Date(Date.UTC(2026, 6, 23, 8, 42)), new Date(Date.UTC(2026, 6, 24, 18, 0)))];
    const renfort = ticket("2", new Date(Date.UTC(2026, 6, 23, 15, 0)), new Date(Date.UTC(2026, 6, 24, 18, 0)));
    const cands = candidates(renfort, [id]);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]!.is_add).toBe(true);
  });

  it("le ticket mal rattaché est signalé", () => {
    const id = new Idea({ thesis: new Thesis({ instrument: "UKOUSD", direction: Direction.BUY }) });
    id.positions = [
      ticket("254724773", new Date(Date.UTC(2026, 6, 23, 8, 42)), new Date(Date.UTC(2026, 6, 24, 11, 49)), "12.73"),
      ticket("255138642", new Date(Date.UTC(2026, 6, 24, 13, 35)), new Date(Date.UTC(2026, 6, 24, 18, 12)), "-1218.47"),
    ];
    expect(id.tickets_disjoints.map((p) => p.position_id)).toEqual(["255138642"]);
  });

  it("un pyramidage normal ne déclenche aucune alerte", () => {
    const id = new Idea({ thesis: new Thesis({ instrument: "UKOUSD", direction: Direction.BUY }) });
    id.positions = [
      ticket("1", new Date(Date.UTC(2026, 6, 23, 8, 0)), new Date(Date.UTC(2026, 6, 25, 18, 0))),
      ticket("2", new Date(Date.UTC(2026, 6, 23, 15, 0)), new Date(Date.UTC(2026, 6, 25, 18, 0))),
      ticket("3", new Date(Date.UTC(2026, 6, 24, 9, 0)), new Date(Date.UTC(2026, 6, 25, 18, 0))),
    ];
    expect(id.tickets_disjoints).toEqual([]);
  });
});

describe("les sorties partielles", () => {
  it("le calendrier date chaque sortie à son jour", () => {
    const id = new Idea({ thesis: new Thesis({ instrument: "UKOUSD", direction: Direction.BUY }) });
    id.positions = [
      ticket("1a", new Date(Date.UTC(2026, 6, 20, 9, 0)), new Date(Date.UTC(2026, 6, 21, 15, 0)), "300"),
      ticket("1b", new Date(Date.UTC(2026, 6, 20, 9, 0)), new Date(Date.UTC(2026, 6, 23, 17, 0)), "-100"),
    ];
    const parJour = dailyPnlByTicket([id]);
    expect(parJour.get("2026-07-21")).toBe(300.0);
    expect(parJour.get("2026-07-23")).toBe(-100.0);
    expect(parJour.size).toBe(2);
  });

  it("la sortie finale ne porte que le reste", () => {
    const sortie = (jour: number, profit: string) =>
      new Deal({
        deal_id: `d${jour}`, time: new Date(Date.UTC(2026, 6, jour, 17)), symbol: "UKOUSD",
        deal_type: "sell", entry: "out", volume: new Decimal("0.5"), price: new Decimal("94"),
        order_id: "1", commission: new Decimal("0"), fee: new Decimal("0"), swap: new Decimal("0"),
        profit: new Decimal(profit), balance: new Decimal("100000"),
      });
    const id = new Idea({ thesis: new Thesis({ instrument: "UKOUSD", direction: Direction.BUY }) });
    id.positions = [ticket("1", new Date(Date.UTC(2026, 6, 20, 9, 0)), new Date(Date.UTC(2026, 6, 23, 17, 0)), "200")];
    const parJour = dailyPnlRealise([id], [sortie(21, "300"), sortie(23, "-100")]);
    expect(parJour.get("2026-07-21")).toBe(300.0);
    expect(parJour.get("2026-07-23")).toBe(-100.0);
    expect([...parJour.values()].reduce((a, b) => a + b, 0)).toBe(200.0);
  });

  it("sans transactions le calendrier retombe sur les tickets", () => {
    const id = new Idea({ thesis: new Thesis({ instrument: "UKOUSD", direction: Direction.BUY }) });
    id.positions = [ticket("1", new Date(Date.UTC(2026, 6, 20, 9, 0)), new Date(Date.UTC(2026, 6, 23, 17, 0)), "200")];
    const parJour = dailyPnlRealise([id], []);
    expect(parJour.size).toBe(1);
    expect(parJour.get("2026-07-23")).toBe(200.0);
  });

  it("les métriques restent agrégées à l'idée", () => {
    const id = new Idea({ thesis: new Thesis({
      instrument: "UKOUSD", direction: Direction.BUY, entry_planned: new Decimal("93.9"),
      stop_initial: new Decimal("92.9"), risk_source: RiskSource.COMPUTED }) });
    id.positions = [
      ticket("1a", new Date(Date.UTC(2026, 6, 20, 9, 0)), new Date(Date.UTC(2026, 6, 21, 15, 0)), "300"),
      ticket("1b", new Date(Date.UTC(2026, 6, 20, 9, 0)), new Date(Date.UTC(2026, 6, 23, 17, 0)), "-100"),
    ];
    const rows = analysisRows([id], null, Unit.IDEA);
    expect(rows.length).toBe(1);
    expect(rows[0]!.pnl).toBe(200.0);
    expect(rows[0]!.closed_at).toBe("2026-07-23");
  });
});

describe("le prix d'entrée et le ticket déclaré", () => {
  it("le prix d'entrée départage deux idées jumelles", () => {
    const a = new Idea({ thesis: new Thesis({ instrument: "UKOUSD", direction: Direction.BUY,
      entry_planned: new Decimal("93.917"), stop_initial: new Decimal("92.502"), conviction: 5 }) });
    a.created_at = new Date(Date.UTC(2026, 6, 26, 19, 16));
    const b = new Idea({ thesis: new Thesis({ instrument: "UKOUSD", direction: Direction.BUY,
      entry_planned: new Decimal("94.828"), stop_initial: new Decimal("93.258"), conviction: 3 }) });
    b.created_at = new Date(Date.UTC(2026, 6, 26, 20, 13));

    const mk = (pid: string, price: string, ot: Date, ct: Date) => {
      const p = ticket(pid, ot, ct);
      return new Position({ ...p, open_price: new Decimal(price) } as never);
    };
    const t1 = mk("254724773", "93.913", new Date(Date.UTC(2026, 6, 23, 8, 42)), new Date(Date.UTC(2026, 6, 24, 11, 49)));
    const t2 = mk("255138642", "94.828", new Date(Date.UTC(2026, 6, 24, 13, 35)), new Date(Date.UTC(2026, 6, 24, 18, 12)));

    expect(candidates(t1, [a, b])[0]!.idea).toBe(a);
    expect(candidates(t2, [a, b])[0]!.idea).toBe(b);
  });

  it("une entrée loin du prix visé reste proposée", () => {
    const id = new Idea({ thesis: new Thesis({ instrument: "UKOUSD", direction: Direction.BUY,
      entry_planned: new Decimal("90.0"), stop_initial: new Decimal("89.0") }) });
    id.created_at = new Date(Date.UTC(2026, 6, 20, 8, 0));
    const t = ticket("1", new Date(Date.UTC(2026, 6, 21, 9, 0)), new Date(Date.UTC(2026, 6, 22, 9, 0)));
    expect(candidates(t, [id]).length).toBeGreaterThan(0);
  });
});

describe("le stop quand le CSV n'en a pas", () => {
  it("le noyau sans stop prend celui de l'idée mais pas l'add", () => {
    const id = new Idea({ thesis: new Thesis({ instrument: "UKOUSD", direction: Direction.BUY,
      entry_planned: new Decimal("93.9"), stop_initial: new Decimal("92.9"), risk_source: RiskSource.COMPUTED }) });
    const noyau = ticket("1", new Date(Date.UTC(2026, 6, 20, 9, 0)), new Date(Date.UTC(2026, 6, 25, 18, 0)));
    const add = ticket("2", new Date(Date.UTC(2026, 6, 21, 9, 0)), new Date(Date.UTC(2026, 6, 25, 18, 0)));
    id.positions = [noyau, add];

    expect(id.stop_for(noyau)[0]!.eq("92.9")).toBe(true);
    expect(id.stop_for(add)[0]).toBeNull();
    expect(id.tickets_needing_stop().map((p) => p.position_id)).toEqual(["2"]);

    id.manual_stops.set(add.uid, new Decimal("93.4"));
    expect(id.tickets_needing_stop()).toEqual([]);
    expect(id.stop_for(add)[0]!.eq("93.4")).toBe(true);
  });

  it("le stop de l'idée reste prioritaire sur le ticket initial", () => {
    const id = new Idea({ thesis: new Thesis({ instrument: "UKOUSD", direction: Direction.BUY,
      entry_planned: new Decimal("93.9"), stop_initial: new Decimal("92.9"), risk_source: RiskSource.COMPUTED }) });
    const base = ticket("1", new Date(Date.UTC(2026, 6, 20, 9, 0)), new Date(Date.UTC(2026, 6, 25, 18, 0)));
    const p = new Position({ ...base, sl_final: new Decimal("93.89"), sl_at_placement: new Decimal("93.89") } as never);
    id.positions = [p];
    expect(id.stop_for(p)[0]!.eq("92.9")).toBe(true);
  });
});
