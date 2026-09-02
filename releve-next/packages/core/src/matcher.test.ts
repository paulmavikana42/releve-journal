import { describe, it, expect } from "vitest";
import { Decimal } from "./decimal";
import { Store } from "./store";
import { candidates } from "./matcher";
import { Direction, OpenTrade, Position, RiskSource, Thesis } from "./models";

function idee(store: Store, instrument = "USDJPY", entree = "157.00", stop = "156.20") {
  return store.create_thesis(
    new Thesis({
      instrument, direction: Direction.BUY,
      entry_planned: new Decimal(entree), stop_initial: new Decimal(stop),
      risk_pct: new Decimal("1"), conviction: 4, risk_source: RiskSource.COMPUTED,
    }),
    { label: "test", account_id: "14124899" },
  );
}

function pos(ticket: string, op: string, ot: Date, cp: string, ct: Date, sym = "USDJPY") {
  return new Position({
    position_id: ticket, account_id: "14124899", symbol: sym, direction: Direction.BUY,
    volume: new Decimal("1"), open_time: ot, open_price: new Decimal(op),
    close_time: ct, close_price: new Decimal(cp), commission: new Decimal(0),
    swap: new Decimal(0), profit_gross: new Decimal("100"),
  });
}

describe("matcher", () => {
  it("un fragment de sortie partielle n'est pas un add", () => {
    const store = new Store();
    const id = idee(store);

    const core = pos("3001", "157.00", new Date(Date.UTC(2026, 6, 1, 10)), "157.80", new Date(Date.UTC(2026, 6, 2, 10)));
    store.import_report([core], []);
    store.link(id.id, core.uid);
    let idea = store.load().ideas.get(id.id)!;

    // fragment : MÊME heure + MÊME prix que le noyau, autre ticket
    const fragment = pos("3002", "157.00", new Date(Date.UTC(2026, 6, 1, 10)), "158.50", new Date(Date.UTC(2026, 6, 4, 10)));
    let cands = candidates(fragment, [idea]);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]!.is_fragment).toBe(true);
    expect(cands[0]!.is_add).toBe(false);

    // une fois le fragment rattaché, un VRAI add (heure ET prix différents) reste un add
    store.import_report([fragment], []);
    store.link(id.id, fragment.uid);
    idea = store.load().ideas.get(id.id)!;
    const add = pos("3003", "157.60", new Date(Date.UTC(2026, 6, 3, 10)), "158.50", new Date(Date.UTC(2026, 6, 4, 10)));
    cands = candidates(add, [idea]);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]!.is_add).toBe(true);
    expect(cands[0]!.is_fragment).toBe(false);
  });

  it("un ticket déclaré tranche seul, sans autre candidate", () => {
    const store = new Store();
    const id = idee(store);
    // déclare un ticket à l'ouverture
    store.open_trade(id.id, new OpenTrade({
      ticket: "5555", symbol: "USDJPY", direction: Direction.BUY, volume: new Decimal("1"),
      open_time: new Date(Date.UTC(2026, 6, 1, 10)), open_price: new Decimal("157.00"),
      account_id: "", stop: new Decimal("156.20"),
    }));
    const idea = store.load().ideas.get(id.id)!;
    const p = pos("5555", "157.00", new Date(Date.UTC(2026, 6, 1, 10)), "158.00", new Date(Date.UTC(2026, 6, 2, 10)));
    const cands = candidates(p, [idea]);
    expect(cands.length).toBe(1);
    expect(cands[0]!.score).toBe(100.0);
    expect(cands[0]!.late).toBe(false);
  });

  it("une thèse hors fenêtre sur un premier ticket est éliminée", () => {
    const store = new Store();
    const id = idee(store); // created_at ≈ maintenant
    // trade ouvert bien au-delà de 30 jours dans le passé
    const p = pos("9001", "157.00", new Date(Date.UTC(2020, 0, 1, 10)), "158.00", new Date(Date.UTC(2020, 0, 2, 10)));
    const idea = store.load().ideas.get(id.id)!;
    const cands = candidates(p, [idea]);
    expect(cands.length).toBe(0);
  });
});
