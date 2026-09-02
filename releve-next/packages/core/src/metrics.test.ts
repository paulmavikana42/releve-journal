import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Decimal } from "./decimal";
import {
  convictionCalibration,
  drawdown,
  equityCurve,
  sharpe,
  sortino,
  thesisExecutionMatrix,
  type EquityPoint,
} from "./metrics";
import { parseReport } from "./parser";
import { Direction, Idea, Position, Review, RiskSource, Thesis, ThesisOutcome } from "./models";

const FIXTURE = readFileSync(new URL("./__fixtures__/ReportHistory-14124899.html", import.meta.url));

// ------------------------------------------------------------------- ratios

describe("Sharpe", () => {
  it("volatilité nulle -> indéfini ; sinon IC encadre l'estimateur", () => {
    expect(sharpe(new Array(10).fill(0.01))).toBeNull();

    const s = sharpe([0.01, -0.005, 0.02, 0.0, -0.01, 0.015])!;
    expect(s).not.toBeNull();
    expect(s.ci_low! < s.value && s.value < s.ci_high!).toBe(true);
    expect(s.is_meaningful).toBe(false); // n=6
  });
});

describe("Sortino", () => {
  it("divise par n TOTAL (81.83, pas 47.25) et dépasse Sharpe", () => {
    const rs = [0.02, 0.01, -0.005, 0.015, -0.002, 0.03];
    const so = sortino(rs)!;
    expect(so.value).toBeCloseTo(81.83, 2);
    expect(Math.abs(so.value - 47.25)).toBeGreaterThan(0.01);
    expect(so.value).toBeGreaterThan(sharpe(rs)!.value);
  });
});

describe("Drawdown", () => {
  it("DD moyen sur les périodes en DD, pas sur toute la série", () => {
    const curve: EquityPoint[] = [
      { d: "2026-07-01", balance: 100_000 },
      { d: "2026-07-02", balance: 110_000 }, // plus haut
      { d: "2026-07-03", balance: 99_000 }, // -10 %
      { d: "2026-07-04", balance: 104_500 }, // -5 %
      { d: "2026-07-05", balance: 110_000 }, // retour au plus haut
    ];
    const dd = drawdown(curve)!;
    expect(dd.max_dd_pct).toBeCloseTo(10.0, 6);
    expect(dd.avg_dd_pct).toBeCloseTo(7.5, 6); // (10+5)/2, pas (0+0+10+5+0)/5
    expect(dd.longest_days).toBe(2);
  });
});

describe("equity_curve", () => {
  it("ne remplit pas les jours sans trade", () => {
    const r = parseReport(FIXTURE);
    const curve = equityCurve(r.deals);
    expect(curve.length).toBe(4); // 4 jours ayant bougé, pas 9 calendaires
    expect(curve[0]!.balance).toBe(100_000);
    expect(curve[curve.length - 1]!.balance).toBe(99_411.26);
  });
});

// ----------------------------------------------------- matrice & calibration

// Port du helper _reviewed de test_core.py : 1 lot, 1000 pts de risque, pv=1,
// donc R = pnl/1000 = r_target.
function reviewed(
  rTarget: number,
  score: number,
  outcome: ThesisOutcome,
  conviction = 3,
  offPlan = false,
): Idea {
  const idea = new Idea({
    off_plan: offPlan,
    thesis: new Thesis({
      instrument: "BTCUSD",
      direction: Direction.SELL,
      entry_planned: new Decimal("60000"),
      stop_initial: new Decimal("61000"),
      conviction,
      risk_source: RiskSource.COMPUTED,
    }),
  });
  const pnl = new Decimal(String(rTarget)).times("1000");
  const close = new Decimal("60000").minus(pnl); // sell : baisse = gain
  idea.positions = [
    new Position({
      position_id: "X",
      account_id: "A",
      symbol: "BTCUSD",
      direction: Direction.SELL,
      volume: new Decimal("1"),
      open_time: new Date(Date.UTC(2026, 6, 1)),
      open_price: new Decimal("60000"),
      close_time: new Date(Date.UTC(2026, 6, 2)),
      close_price: close,
      commission: new Decimal("0"),
      swap: new Decimal("0"),
      profit_gross: pnl,
    }),
  ];
  idea.review = new Review({
    entry_in_zone: score >= 1,
    size_conforme: score >= 2,
    stop_at_invalidation: score >= 3,
    stop_never_widened: score >= 4,
    exit_per_plan: score >= 5,
    thesis_outcome: outcome,
  });
  return idea;
}

describe("matrice thèse × exécution", () => {
  it("isole le coût de l'indiscipline", () => {
    const ideas = [
      reviewed(2.0, 5, ThesisOutcome.CORRECT),
      reviewed(2.4, 5, ThesisOutcome.CORRECT),
      reviewed(0.2, 2, ThesisOutcome.CORRECT), // bonne analyse, mal exécutée
      reviewed(-0.9, 5, ThesisOutcome.WRONG),
    ];
    const m = thesisExecutionMatrix(ideas)!;
    expect(m.clean_correct.n).toBe(2);
    expect(m.clean_correct.expectancy_r).toBeCloseTo(2.2, 6);
    expect(m.dirty_correct.n).toBe(1);
    expect(m.dirty_correct.expectancy_r).toBeCloseTo(0.2, 6);
    expect(m.cost_of_indiscipline!).toBeCloseTo(2.0, 6); // 2 R laissés par idée
  });
});

describe("calibration de conviction", () => {
  it("détecte une conviction inversée", () => {
    const ideas = [
      reviewed(-1.0, 5, ThesisOutcome.WRONG, 5),
      reviewed(-0.8, 5, ThesisOutcome.WRONG, 5),
      reviewed(1.5, 5, ThesisOutcome.CORRECT, 2),
      reviewed(1.9, 5, ThesisOutcome.CORRECT, 2),
    ];
    const cal = convictionCalibration(ideas);
    const c2 = cal.find((c) => c.conviction === 2)!;
    const c5 = cal.find((c) => c.conviction === 5)!;
    expect(c2.expectancy_r).toBeGreaterThan(c5.expectancy_r);
  });
});
