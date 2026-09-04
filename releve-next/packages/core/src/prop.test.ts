import { describe, it, expect } from "vitest";
import { Decimal } from "./decimal";
import {
  belongs_to,
  Compliance,
  equitySeries,
  evaluate,
  owner_uid,
  PropRules,
  rulesFor,
} from "./prop";
import { Campaign, Deal, Direction, Idea, OpenTrade, Position, Thesis } from "./models";

const REGLES = new PropRules({
  account_id: "14124899",
  start_balance: new Decimal("100000"),
  daily_loss_pct: new Decimal("5"),
  max_drawdown_pct: new Decimal("10"),
});

function idee(pnl: string, jour: number, symbol = "BTCUSD"): Idea {
  const i = new Idea({ thesis: new Thesis({ instrument: symbol, direction: Direction.SELL }) });
  i.positions = [
    new Position({
      position_id: `P${jour}`,
      account_id: "14124899",
      symbol,
      direction: Direction.SELL,
      volume: new Decimal("1"),
      open_time: new Date(Date.UTC(2026, 6, jour, 9, 0)),
      open_price: new Decimal("60000"),
      close_time: new Date(Date.UTC(2026, 6, jour, 18, 0)),
      close_price: new Decimal("59000"),
      commission: new Decimal("0"),
      swap: new Decimal("0"),
      profit_gross: new Decimal(pnl),
    }),
  ];
  return i;
}

function idee_ouverte(symbol = "UKOUSD"): Idea {
  const i = new Idea({ thesis: new Thesis({ instrument: symbol, direction: Direction.BUY }) });
  i.open_trades = [
    new OpenTrade({
      ticket: "88210912",
      symbol,
      direction: Direction.BUY,
      volume: new Decimal("1"),
      open_time: new Date(Date.UTC(2026, 6, 24, 10, 0)),
      open_price: new Decimal("71.40"),
      account_id: "14124899",
    }),
  ];
  return i;
}

const day = (d: number): Date => new Date(Date.UTC(2026, 6, d, 12, 0));
const at = (d: number, h: number): Date => new Date(Date.UTC(2026, 6, d, h, 0));

const check = (c: Compliance, key: string) => c.checks.find((ch) => ch.key === key)!;

// ------------------------------------------------------------------ la courbe

describe("courbe de solde", () => {
  it("sans soldes broker : reconstituée, et le dit", () => {
    const eq = equitySeries(REGLES, [idee("500", 6), idee("-200", 7)]);
    expect(eq.measured).toBe(false);
    expect(eq.last!.eq("100300")).toBe(true);
  });

  it("avec soldes broker : mesurée", () => {
    const deals = [
      new Deal({
        deal_id: "1", time: at(6, 18), symbol: "BTCUSD", deal_type: "sell", entry: "out",
        volume: new Decimal("1"), price: new Decimal("59000"), order_id: "1",
        commission: new Decimal(0), fee: new Decimal(0), swap: new Decimal(0),
        profit: new Decimal("500"), balance: new Decimal("100500"),
      }),
    ];
    const eq = equitySeries(REGLES, [idee("500", 6)], deals);
    expect(eq.measured).toBe(true);
    expect(eq.last!.eq("100500")).toBe(true);
  });
});

// --------------------------------------------------- la perte journalière

describe("perte journalière", () => {
  it("se mesure sur la base du JOUR (-4.21 %, pas -4.00)", () => {
    const c = evaluate(REGLES, [idee("-5000", 6), idee("-4000", 7)], [], day(7), at(7, 20));
    expect(c.daily_pct.toNumber()).toBeCloseTo(-4.21, 2);
    expect(c.checks[0]!.breached).toBe(false);
  });

  it("la limite franchie est un breach + tone loss", () => {
    const c = evaluate(REGLES, [idee("-5100", 7)], [], day(7), at(7, 20));
    expect(check(c, "daily").breached).toBe(true);
    expect(c.tone).toBe("loss");
  });

  it("un gain ne déclenche jamais la règle de perte", () => {
    const c = evaluate(REGLES, [idee("3000", 7)], [], day(7), at(7, 20));
    const d = check(c, "daily");
    expect(d.ok && !d.breached).toBe(true);
  });
});

// ---------------------------------------------------------------- drawdown

describe("drawdown", () => {
  it("statique : le plancher ne bouge jamais", () => {
    const c = evaluate(REGLES, [idee("20000", 6), idee("-5000", 7)], [], day(8), at(8, 12));
    expect(c.floor.eq("90000")).toBe(true);
    expect(c.margin_to_floor.eq("25000")).toBe(true);
    expect(c.drawdown_pct.isZero()).toBe(true);
  });

  it("trailing : suit le plus-haut", () => {
    const regles = new PropRules({
      start_balance: new Decimal("100000"),
      max_drawdown_pct: new Decimal("10"),
      drawdown_static: false,
    });
    const c = evaluate(regles, [idee("20000", 6), idee("-5000", 7)], [], day(8), at(8, 12));
    expect(c.floor.eq("108000")).toBe(true);
    expect(c.margin_to_floor.eq("7000")).toBe(true);
  });

  it("jamais en perte -> drawdown NUL ; tuile affiche la MARGE + 'pire creux 0.00 %'", () => {
    const c = evaluate(REGLES, [idee("500", 6)], [], day(7), at(7, 12));
    expect(c.drawdown_pct.isZero()).toBe(true);
    // La valeur affiche désormais la marge avant plancher (positive), le pire
    // creux passe en détail.
    expect(check(c, "drawdown").value).toMatch(/^\+\d+\.\d{2} % de marge$/);
    expect(check(c, "drawdown").detail).toContain("pire creux 0.00 %");
  });
});

describe("règles retirées et cohérence", () => {
  it("plus de règle week-end", () => {
    const c = evaluate(REGLES, [idee_ouverte()], [], day(25), at(25, 12));
    expect(c.checks.some((ch) => ch.key === "weekend")).toBe(false);
  });

  it("cohérence : poids du meilleur jour, alerte jamais breach", () => {
    const c = evaluate(REGLES, [idee("1000", 6), idee("1000", 7), idee("8000", 8)], [], day(9), at(9, 12));
    const coh = check(c, "consistency");
    expect(c.best_day_share!.toNumber()).toBeCloseTo(80.0, 6);
    expect(coh.ok).toBe(false);
    expect(coh.breached).toBe(false);
  });

  it("jours de trading comptés sur les clôtures", () => {
    const c = evaluate(REGLES, [idee("100", 6), idee("100", 6), idee("100", 7)], [], day(8), at(8, 12));
    expect(c.trading_days).toBe(2);
    expect(check(c, "days").ok).toBe(false);
  });
});

// ---------------------------------------------- type, phase, devise

describe("type, phase, devise", () => {
  it("le symbole de devise suit le compte", () => {
    expect(new PropRules({ currency: "EUR" }).symbol).toBe("€");
    expect(new PropRules({ currency: "GBP" }).symbol).toBe("£");
    expect(new PropRules({ currency: "USD" }).symbol).toBe("$");
  });

  it("l'objectif est celui de la phase courante", () => {
    const r = new PropRules({
      challenge_type: "two_phase",
      phase: "p1",
      profit_target_pct: new Decimal("8"),
      profit_target_p2_pct: new Decimal("5"),
    });
    expect(r.active_profit_target()!.eq("8")).toBe(true);
    r.phase = "p2";
    expect(r.active_profit_target()!.eq("5")).toBe(true);
  });

  it("instant funding et financé n'ont aucun objectif", () => {
    expect(new PropRules({ challenge_type: "instant" }).active_profit_target()).toBeNull();
    expect(new PropRules({ challenge_type: "instant" }).is_funded).toBe(true);
    expect(new PropRules({ phase: "funded" }).active_profit_target()).toBeNull();
    const c = evaluate(new PropRules({ account_id: "X", challenge_type: "instant" }), [idee("500", 6)], [], day(6), at(6, 18));
    expect(c.checks.some((ch) => ch.key === "target")).toBe(false);
  });

  it("les nouveaux champs font l'aller-retour JSON", () => {
    const r = new PropRules({
      account_id: "A", currency: "GBP", challenge_type: "two_phase", phase: "p2",
      profit_split_pct: new Decimal("90"), trading_day_rule: "gain",
      trading_day_threshold_pct: new Decimal("0.5"), min_days_scope: "always",
    });
    expect(PropRules.from_dict(r.to_dict()).equals(r)).toBe(true);
  });
});

// ----------------------------------------- compliance adaptée au type/phase

describe("compliance adaptée", () => {
  it("la marge avant plancher ne descend jamais sous zéro", () => {
    const r = new PropRules({ account_id: "Z", start_balance: new Decimal("100000"), max_drawdown_pct: new Decimal("10") });
    const c = evaluate(r, [idee("-15000", 6)], [], day(6), at(6, 18));
    expect(c.margin_to_floor.eq("0")).toBe(true);
  });

  it("la limite du jour s'indexe sur le drawdown restant", () => {
    const r = new PropRules({ account_id: "Z", start_balance: new Decimal("100000"), daily_loss_pct: new Decimal("5"), max_drawdown_pct: new Decimal("10") });
    const c = evaluate(r, [idee("-9000", 6)], [], day(6), at(6, 18));
    expect(c.daily_allow_amount.eq("1000")).toBe(true);
  });

  it("un financé affiche le payout indexé du split", () => {
    const r = new PropRules({ account_id: "F", start_balance: new Decimal("100000"), challenge_type: "instant", profit_split_pct: new Decimal("80") });
    const c = evaluate(r, [idee("5000", 6)], [], day(6), at(6, 18));
    expect(c.payout_amount!.eq("4000")).toBe(true);
    expect(c.checks.some((ch) => ch.key === "target")).toBe(false);
  });

  it("en perte, le financé voit son gain négatif sans split", () => {
    const r = new PropRules({ account_id: "F", challenge_type: "instant", profit_split_pct: new Decimal("80") });
    const c = evaluate(r, [idee("-2000", 6)], [], day(6), at(6, 18));
    expect(c.payout_amount!.eq("-2000")).toBe(true);
  });

  it("un jour ne compte que s'il atteint le seuil de gain", () => {
    const r = new PropRules({ account_id: "D", start_balance: new Decimal("100000"), min_trading_days: 2, trading_day_rule: "gain", trading_day_threshold_pct: new Decimal("0.5") });
    const c = evaluate(r, [idee("600", 6), idee("100", 7)], [], day(8), at(8, 12));
    expect(c.trading_days).toBe(1);
  });

  it("les jours de trading sont plafonnés à la cible", () => {
    const r = new PropRules({ account_id: "D", start_balance: new Decimal("100000"), min_trading_days: 2 });
    const c = evaluate(r, [idee("100", 6), idee("100", 7), idee("100", 8)], [], day(9), at(9, 12));
    expect(check(c, "days").value.startsWith("2 / 2")).toBe(true);
  });

  it("un compte sans limite journalière ne breach jamais dessus", () => {
    const r = new PropRules({ account_id: "AP", start_balance: new Decimal("100000"), daily_loss_pct: new Decimal("0"), max_drawdown_pct: new Decimal("10") });
    const c = evaluate(r, [idee("-4000", 6)], [], day(6), at(6, 18));
    const d = check(c, "daily");
    expect(d.breached).toBe(false);
    expect(d.value).toBe("aucune limite");
    expect(c.daily_allow_amount.eq(c.margin_to_floor)).toBe(true);
  });

  it("chaque scénario de phase ajuste la compliance", () => {
    const target = (r: PropRules) => {
      const c = evaluate(r, [idee("3000", 6)], [], day(6), at(6, 18));
      return { t: c.checks.find((ch) => ch.key === "target") ?? null, c };
    };

    const r = new PropRules({ account_id: "X", challenge_type: "two_phase", phase: "p1", profit_target_pct: new Decimal("8"), profit_target_p2_pct: new Decimal("5") });
    let res = target(r);
    expect(res.t !== null && res.t.detail.includes("+8") && !res.t.detail.includes("phase 2")).toBe(true);

    r.phase = "p2";
    res = target(r);
    expect(res.t !== null && res.t.detail.includes("+5") && res.t.detail.includes("phase 2")).toBe(true);

    r.phase = "funded";
    res = target(r);
    expect(res.t === null && res.c.payout_amount !== null).toBe(true);

    const inst = new PropRules({ account_id: "I", challenge_type: "instant" });
    res = target(inst);
    expect(res.t === null && res.c.payout_amount !== null).toBe(true);
  });

  it("un compte personnel persiste son statut", () => {
    const r = new PropRules({ account_id: "P", is_prop: false });
    expect(PropRules.from_dict(r.to_dict()).is_prop).toBe(false);
  });
});

// ------------------------------------------------------------ réglages & isolation

describe("réglages et cloisonnement", () => {
  it("les règles font l'aller-retour JSON", () => {
    const r = new PropRules({ account_id: "42", label: "The5%ers", start_balance: new Decimal("50000"), daily_loss_pct: new Decimal("4"), drawdown_static: false, profit_target_pct: new Decimal("6"), consistency_pct: null });
    expect(PropRules.from_dict(r.to_dict()).equals(r)).toBe(true);
  });

  it("un compte absent retombe sur le premier", () => {
    expect(rulesFor("inconnu", [REGLES])).toBe(REGLES);
  });

  it("deux comptes ne partagent pas leurs idées", () => {
    const a = new Idea({ account_id: "14124899" });
    const b = new Idea({ account_id: "55501" });
    expect(belongs_to(a, "14124899", "14124899")).toBe(true);
    expect(belongs_to(b, "14124899", "14124899")).toBe(false);
    expect(belongs_to(b, "55501", "14124899")).toBe(true);
  });

  it("l'uid isole même quand le n° broker est vide", () => {
    const a = new PropRules({ account_id: "" });
    const b = new PropRules({ account_id: "" });
    expect(a.uid && b.uid && a.uid !== b.uid).toBe(true);
    const uids = new Set([a.uid, b.uid]);
    expect(owner_uid(new Idea({ account_id: a.uid }), uids, a.uid)).toBe(a.uid);
    expect(owner_uid(new Idea({ account_id: b.uid }), uids, a.uid)).toBe(b.uid);
    expect(owner_uid(new Idea({ account_id: "" }), uids, a.uid)).toBe(a.uid);
    expect(owner_uid(new Idea({ account_id: "5794836" }), uids, a.uid)).toBe(a.uid);
  });

  it("l'uid persiste dans le JSON", () => {
    const r = new PropRules({ account_id: "X" });
    expect(PropRules.from_dict(r.to_dict()).uid).toBe(r.uid);
  });

  it("une idée sans compte reste visible sur le premier", () => {
    const ancienne = new Idea();
    expect(belongs_to(ancienne, "14124899", "14124899")).toBe(true);
    expect(belongs_to(ancienne, "55501", "14124899")).toBe(false);
  });

  it("le cloisonnement vaut aussi pour thèses et transactions", () => {
    const these = new Campaign({ name: "Dollar fort", account_id: "55501" });
    const deal = new Deal({
      deal_id: "1", time: at(1, 18), symbol: "BTCUSD", deal_type: "sell", entry: "out",
      volume: new Decimal("1"), price: new Decimal("59000"), order_id: "1",
      commission: new Decimal(0), fee: new Decimal(0), swap: new Decimal(0),
      profit: new Decimal("100"), balance: new Decimal("100100"), account_id: "55501",
    });
    expect(belongs_to(these, "55501", "14124899")).toBe(true);
    expect(belongs_to(these, "14124899", "14124899")).toBe(false);
    expect(belongs_to(deal, "55501", "14124899")).toBe(true);
    expect(belongs_to(deal, "14124899", "14124899")).toBe(false);
  });
});
