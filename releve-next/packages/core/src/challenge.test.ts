import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Decimal } from "./decimal";
import { availablePeriods, compute, Period } from "./challenge";
import { parseReport } from "./parser";
import { Direction, Idea, Thesis } from "./models";

const FIXTURE = readFileSync(new URL("./__fixtures__/ReportHistory-14124899.html", import.meta.url));

describe("challenge : survie globale, stats mensuelles", () => {
  it("marge de survie sur tout l'historique", () => {
    const r = parseReport(FIXTURE);
    const state = compute(r.deals, new Period())!;
    expect(state.floor.eq("90000")).toBe(true);
    expect(state.balance.eq("99411.26")).toBe(true);
    expect(state.margin_to_floor.eq("9411.26")).toBe(true);
    expect(state.lowest_ever.eq("99014.06")).toBe(true);
    expect(state.drawdown_from_start_pct.minus("0.588").abs().lte("0.01")).toBe(true);
  });

  it("la marge reste globale même en vue mensuelle", () => {
    const r = parseReport(FIXTURE);
    const tout = compute(r.deals, new Period())!;
    const juillet = compute(r.deals, new Period(2026, 7))!;
    expect(tout.margin_to_floor.eq(juillet.margin_to_floor)).toBe(true);
    expect(tout.balance.eq(juillet.balance)).toBe(true);
  });

  it("les périodes disponibles se comptent sur la CLÔTURE", () => {
    const r = parseReport(FIXTURE);
    const idea = new Idea({
      thesis: new Thesis({
        instrument: "BTCUSD",
        direction: Direction.SELL,
        entry_planned: new Decimal("63791.42"),
        stop_initial: new Decimal("64700"),
      }),
    });
    idea.positions = [...r.positions];

    const periods = availablePeriods([idea]);
    expect(periods[periods.length - 1]!.is_all).toBe(true);
    expect(periods.some((p) => p.year === 2026 && p.month === 7)).toBe(true);
    expect(idea.closed_at!.getUTCMonth() + 1).toBe(7);
  });
});
