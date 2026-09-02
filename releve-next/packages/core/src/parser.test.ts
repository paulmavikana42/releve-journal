import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Decimal } from "./decimal";
import { num, parseReport } from "./parser";
import { SpecBook } from "./specs";
import { Direction, ExitReason, Idea, RiskBasis, StopProvenance, Thesis } from "./models";

// Le vrai rapport MT5 (compte de référence). Test-only, non embarqué à la prod.
const FIXTURE = readFileSync(new URL("./__fixtures__/ReportHistory-14124899.html", import.meta.url));

function near(a: Decimal | null, expected: string, tol: string): void {
  expect(a).not.toBeNull();
  expect((a as Decimal).minus(expected).abs().lte(tol)).toBe(true);
}

// ------------------------------------------------------------------- parsing

describe("num — séparateur insécable", () => {
  it("lit un nombre à espace insécable, rejette le non-numérique", () => {
    expect((num("100 000.00") as Decimal).eq("100000.00")).toBe(true);
    expect((num("-16.84") as Decimal).eq("-16.84")).toBe(true);
    expect(num("market")).toBeNull();
    expect(num("")).toBeNull();
  });
});

describe("TEST D'OR — parse au centime", () => {
  it("reproduit exactement le Profit Total Net (-588.74)", () => {
    const r = parseReport(FIXTURE);
    expect(r.account_id).toBe("14124899");
    expect(r.currency).toBe("USD");
    expect(r.positions.length).toBe(3);

    const total = r.positions.reduce((a, p) => a.plus(p.pnl_net), new Decimal(0));
    expect(total.eq("-588.74")).toBe(true);
    expect(r.deals[r.deals.length - 1]!.balance.eq("99411.26")).toBe(true);
    expect(new Decimal("100000").plus(total).eq(r.deals[r.deals.length - 1]!.balance)).toBe(true);
  });
});

describe("profit MT5 est brut", () => {
  it("le net inclut commission et swap", () => {
    const r = parseReport(FIXTURE);
    const p = r.positions.find((p) => p.position_id === "251022835")!;
    expect(p.profit_gross.eq("452.64")).toBe(true);
    expect(p.commission.eq("-16.84")).toBe(true);
    expect(p.swap.eq("-55.44")).toBe(true);
    expect(p.pnl_net.eq("380.36")).toBe(true);
  });
});

describe("valeur du point auto-déduite", () => {
  it("brut proche de 1, snappé exactement à 1", () => {
    const r = parseReport(FIXTURE);
    for (const p of r.positions) {
      expect((p.point_value as Decimal).minus("1").abs().lt("0.0001")).toBe(true);
    }
    const book = new SpecBook(r.positions);
    const spec = book.get("BTCUSD")!;
    expect(spec.point_value.eq("1")).toBe(true);
    expect(spec.samples).toBe(3);
    expect(spec.is_stable).toBe(true);
    expect((book.point_value(r.positions[0]!) as Decimal).eq("1")).toBe(true);
  });
});

describe("cause de sortie lue dans le commentaire", () => {
  it("[sl ...] -> STOP_LOSS, sinon MANUAL", () => {
    const r = parseReport(FIXTURE);
    const byId = new Map(r.positions.map((p) => [p.position_id, p.exit_reason]));
    expect(byId.get("251396944")).toBe(ExitReason.STOP_LOSS);
    expect(byId.get("251022835")).toBe(ExitReason.MANUAL);
  });
});

// ------------------------------------------- LE piège : le stop de MT5 ment

describe("stop prouvé récupéré depuis la table Ordres", () => {
  it("SL placement == SL final -> PROVEN, risque calculable ; sinon SUSPECT_BE", () => {
    const r = parseReport(FIXTURE);
    const byId = new Map(r.positions.map((p) => [p.position_id, p]));

    const prouve = byId.get("251321750")!;
    expect(prouve.sl_at_placement!.eq("62424.72")).toBe(true);
    expect(prouve.sl_final!.eq("62424.72")).toBe(true);
    expect(prouve.stop_provenance).toBe(StopProvenance.PROVEN);
    near(prouve.risk(), "451.06", "0.1");

    const suspect = byId.get("251022835")!;
    expect(suspect.stop_provenance).toBe(StopProvenance.SUSPECT_BE);
  });
});

// ------------------------------------------- l'idée, pas le ticket

function ideaBtc(riskPct?: string): { idea: Idea; book: SpecBook } {
  const r = parseReport(FIXTURE);
  const book = new SpecBook(r.positions);
  const idea = new Idea({
    thesis: new Thesis({
      instrument: "BTCUSD",
      direction: Direction.SELL,
      entry_planned: new Decimal("63791.42"),
      stop_initial: new Decimal("64700.51"),
      risk_pct: riskPct ? new Decimal(riskPct) : null,
    }),
  });
  idea.positions = [...r.positions];
  return { idea, book };
}

describe("le risque d'une idée est la SOMME de ses tickets (données réelles)", () => {
  it("additionne les risques par ticket, R ≈ -0.38 (et non -0.98)", () => {
    const { idea, book } = ideaBtc();
    const risks = idea.ticket_risks(book);
    near(risks.get("251022835") ?? null, "600", "0.5");
    near(risks.get("251321750") ?? null, "451.06", "0.1");
    near(risks.get("251396944") ?? null, "505.76", "0.1");

    near(idea.risk_realized(book, RiskBasis.SUM), "1556.82", "0.5");
    near(idea.r_multiple(book, RiskBasis.SUM), "-0.38", "0.01");
    near(idea.r_multiple(book, RiskBasis.INITIAL_ONLY), "-0.98", "0.01");
  });
});

describe("exposition simultanée (données réelles)", () => {
  it("pic ≈ 1105.76, soit > 1.1 % vs 0.6 % annoncé", () => {
    const { idea, book } = ideaBtc("0.6");
    const peak = idea.max_concurrent_risk(book);
    near(peak, "1105.76", "1");
    expect((peak as Decimal).div("100000").times(100).gt("1.1")).toBe(true);
  });
});

describe("trois tickets, une idée", () => {
  it("1 idée = 1 perte, ~-1.2 R et non 33 % de réussite", () => {
    const { idea, book } = ideaBtc();
    expect(idea.positions.length).toBe(3);
    expect(idea.pnl_net.eq("-588.74")).toBe(true);
    expect((idea.r_multiple(book) as Decimal).lt(0)).toBe(true);
  });
});

describe("les adds ont transformé un gagnant en perdant", () => {
  it("le noyau gagnait, les adds ont tout mangé", () => {
    const { idea } = ideaBtc();
    expect(idea.pnl_initial.eq("380.36")).toBe(true);
    expect(idea.pnl_adds.eq("-969.10")).toBe(true);
    expect(idea.pnl_initial.plus(idea.pnl_adds).eq(idea.pnl_net)).toBe(true);
  });
});
