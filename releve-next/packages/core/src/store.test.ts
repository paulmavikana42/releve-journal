import { describe, it, expect } from "vitest";
import { Decimal } from "./decimal";
import { Store } from "./store";
import { balanceDeals, Outcome, parse, reconcile } from "./csvimport";
import { SpecBook } from "./specs";
import { decisionMatrix, ideasCorrectRate, outcomeBreakdown } from "./metrics";
import {
  Attachment,
  Campaign,
  CaptureKind,
  Direction,
  IdeaStatus,
  OpenTrade,
  Position,
  Quadrant,
  Review,
  RiskSource,
  Thesis,
  ThesisOutcome,
} from "./models";

const enc = (s: string) => new TextEncoder().encode(s);

function idee(store: Store, instrument = "UKOUSD", direction = Direction.BUY, entree = "71.40", stop = "70.20") {
  return store.create_thesis(
    new Thesis({
      instrument,
      direction,
      entry_planned: new Decimal(entree),
      stop_initial: new Decimal(stop),
      risk_pct: new Decimal("1"),
      conviction: 4,
      macro_theme: "Risk-off géopolitique",
      thesis_kill_switch: "Désescalade confirmée",
      risk_source: RiskSource.COMPUTED,
    }),
    { label: "UKOUSD buy — Ormuz", account_id: "14124899" },
  );
}

function ticket(t = "88210912", account = "14124899", stop: string | null = "70.20") {
  return new OpenTrade({
    ticket: t,
    symbol: "UKOUSD",
    direction: Direction.BUY,
    volume: new Decimal("1"),
    open_time: new Date(Date.UTC(2026, 6, 19, 10, 30)),
    open_price: new Decimal("71.40"),
    account_id: account,
    stop: stop ? new Decimal(stop) : null,
  });
}

const CSV_CLOTURE =
  "Ticket;Symbol;Type;Volume;Open Time;Open Price;Close Time;Close Price;" +
  "S/L;Commission;Swap;Profit;Balance\n" +
  "88210912;UKOUSD;buy;1.00;2026.07.19 10:30;71.40;2026.07.22 14:05;73.32;" +
  "70.20;0;0;1 920,00;101 920,00\n";

// ------------------------------------------------------- le trade qui vit

describe("le trade qui vit", () => {
  it("déclarer un ticket fait passer l'idée en cours", () => {
    const store = new Store();
    const i0 = idee(store);
    store.open_trade(i0.id, ticket());
    const i = store.load().ideas.get(i0.id)!;
    expect(i.status).toBe(IdeaStatus.RUNNING);
    expect(i.is_running && !i.is_executed).toBe(true);
    expect(i.open_trades[0]!.ticket).toBe("88210912");
    expect(i.open_trades[0]!.stop!.eq("70.20")).toBe(true);
  });

  it("le ticket déclaré devient la clé de rapprochement", () => {
    const store = new Store();
    const i0 = idee(store);
    store.open_trade(i0.id, ticket());
    expect([...store.pending_trades().keys()]).toEqual(["88210912"]);
  });

  it("un trade en cours ne demande pas de review (quadrant PENDING)", () => {
    const store = new Store();
    const i0 = idee(store);
    store.open_trade(i0.id, ticket());
    const i = store.load().ideas.get(i0.id)!;
    expect(i.is_executed && !i.is_running && i.review === null).toBe(false);
    expect(i.quadrant).toBe(Quadrant.PENDING);
  });

  it("un ticket déclaré par erreur s'annule", () => {
    const store = new Store();
    const i0 = idee(store);
    store.open_trade(i0.id, ticket());
    const uid = store.load().ideas.get(i0.id)!.open_trades[0]!.uid;
    store.cancel_trade(uid);
    const i = store.load().ideas.get(i0.id)!;
    expect(i.open_trades).toEqual([]);
    expect(i.status).toBe(IdeaStatus.ARMED);
  });

  it("le stop déplacé pendant le trade est journalisé (append-only)", () => {
    const store = new Store();
    const i0 = idee(store);
    store.open_trade(i0.id, ticket());
    const uid = store.load().ideas.get(i0.id)!.open_trades[0]!.uid;
    store.update_trade(uid, { stop: new Decimal("71.40"), note: "passé au BE" });
    const o = store.load().ideas.get(i0.id)!.open_trades[0]!;
    expect(o.stop!.eq("71.40")).toBe(true);
    expect(o.note).toBe("passé au BE");
    const types = store.events().map((e) => e.type);
    expect(types.filter((t) => t === "trade_opened").length).toBe(1);
    expect(types.filter((t) => t === "trade_updated").length).toBe(1);
  });
});

// ------------------------------------------------- la clôture par le CSV

describe("clôture par le CSV", () => {
  it("le CSV clôture le trade par son ticket", () => {
    const store = new Store();
    const i0 = idee(store);
    store.open_trade(i0.id, ticket());

    const cf = parse(enc(CSV_CLOTURE));
    const matches = reconcile(cf, store.load().positions, store.pending_trades());
    expect(matches[0]!.outcome).toBe(Outcome.CLOSES);

    const pos = matches[0]!.row.to_position(matches[0]!.open_trade!.account_id);
    store.import_report([pos], balanceDeals(cf));
    store.link(matches[0]!.idea_id!, pos.uid);

    const { ideas, deals } = store.load();
    const i = ideas.get(i0.id)!;
    expect(i.status).toBe(IdeaStatus.CLOSED);
    expect(i.is_running).toBe(false);
    expect(i.is_executed).toBe(true);
    expect(i.pnl_net.eq("1920.00")).toBe(true);
    const r = i.r_multiple(new SpecBook([...i.positions])) as Decimal;
    expect(r.minus("1.6").abs().lte("0.01")).toBe(true);
    expect(deals[0]!.balance.eq("101920.00")).toBe(true);
  });

  it("ticket obligatoire avant import : devinette -> clé déterministe", () => {
    const store = new Store();
    const i0 = idee(store);
    const cf = parse(enc(CSV_CLOTURE));

    const avant = reconcile(cf, store.load().positions, store.pending_trades());
    expect(avant[0]!.outcome).not.toBe(Outcome.CLOSES);

    let ot = cf.rows[0]!.to_open_trade("14124899");
    ot = new OpenTrade({ ...ot, stop: i0.thesis!.stop_initial });
    store.open_trade(i0.id, ot);

    const apres = reconcile(cf, store.load().positions, store.pending_trades());
    expect(apres[0]!.outcome).toBe(Outcome.CLOSES);
    expect(apres[0]!.idea_id).toBe(i0.id);
    expect(ot.stop!.eq("70.20")).toBe(true);
  });

  it("réimporter le même CSV ne duplique rien", () => {
    const store = new Store();
    const i0 = idee(store);
    store.open_trade(i0.id, ticket());
    const cf = parse(enc(CSV_CLOTURE));
    for (let k = 0; k < 3; k++) {
      const matches = reconcile(cf, store.load().positions, store.pending_trades());
      for (const m of matches) {
        if (m.outcome === Outcome.CLOSES || m.outcome === Outcome.NEW_CLOSED) {
          const p = m.row.to_position("14124899");
          store.import_report([p], []);
          if (m.idea_id) store.link(m.idea_id, p.uid);
        }
      }
    }
    const { ideas, positions } = store.load();
    expect(positions.size).toBe(1);
    expect(ideas.get(i0.id)!.positions.length).toBe(1);
  });
});

// ------------------------------------------------- fermeture par ticket / comptes

describe("fermeture par ticket et comptes", () => {
  it("un ticket sans compte ferme quand même le trade déclaré", () => {
    const store = new Store();
    const i0 = idee(store);
    store.open_trade(i0.id, ticket("88210912", "14124899"));
    const cf = parse(enc(CSV_CLOTURE));
    const pos = cf.rows[0]!.to_position(""); // aucun compte
    store.import_report([pos], []);
    store.link(i0.id, pos.uid);
    expect(store.load().ideas.get(i0.id)!.is_running).toBe(false);
  });

  it("un uid interne se ferme par ticket (régression)", () => {
    const store = new Store();
    const i0 = idee(store);
    store.open_trade(i0.id, ticket("88210912", "89a44220cca6")); // uid interne
    const cf = parse(enc(CSV_CLOTURE));
    const pos = cf.rows[0]!.to_position("81714841"); // numéro broker
    store.import_report([pos], []); // sans lien explicite
    const i = store.load().ideas.get(i0.id)!;
    expect(i.is_running).toBe(false);
    expect(i.is_executed).toBe(true);
    expect(i.status).toBe(IdeaStatus.CLOSED);
    expect(store.orphans()).toEqual([]);
  });

  it("deux comptes renseignés ne se mélangent pas", () => {
    const store = new Store();
    const i0 = idee(store);
    store.open_trade(i0.id, ticket("88210912", "14124899"));
    const cf = parse(enc(CSV_CLOTURE));
    const pos = cf.rows[0]!.to_position("99999999"); // un AUTRE compte
    store.import_report([pos], []);
    expect(store.load().ideas.get(i0.id)!.is_running).toBe(true);
  });
});

// ------------------------------------------------- captures & blocs

describe("captures et blocs", () => {
  function att(id: string, ownerId: string, kind = CaptureKind.THESIS, caption = "") {
    return new Attachment({ id, owner_type: "idea", owner_id: ownerId, path: `captures/x/${id}.png`, kind, caption });
  }

  it("plusieurs captures sur une idée", () => {
    const store = new Store();
    const i0 = idee(store);
    store.add_capture(att("s0", i0.id, CaptureKind.THESIS));
    store.add_capture(att("s1", i0.id, CaptureKind.ENTRY));
    store.add_capture(att("s2", i0.id, CaptureKind.EXIT));
    const i = store.load().ideas.get(i0.id)!;
    expect(i.captures.length).toBe(3);
    expect(i.captures.map((a) => a.kind)).toEqual([CaptureKind.THESIS, CaptureKind.ENTRY, CaptureKind.EXIT]);
  });

  it("retirer une capture la marque sans l'effacer", () => {
    const store = new Store();
    const i0 = idee(store);
    const a = att("s0", i0.id);
    store.add_capture(a);
    store.remove_capture(a.id);
    const i = store.load().ideas.get(i0.id)!;
    expect(i.captures).toEqual([]);
    expect(i.attachments.length === 1 && i.attachments[0]!.removed).toBe(true);
  });

  it("les blocs d'une idée font l'aller-retour", () => {
    const store = new Store();
    const blocs = [
      { type: "text", text: "Cassure H4 sur volume.", bid: "a1" },
      { type: "image", path: "captures/x/y.png", caption: "H4", bid: "b2" },
    ];
    const i0 = store.create_thesis(
      new Thesis({ instrument: "UKOUSD", direction: Direction.BUY, entry_planned: new Decimal("71.40"), stop_initial: new Decimal("70.20"), macro_note: "Cassure H4 sur volume.", blocks: blocs }),
    );
    const t = store.load().ideas.get(i0.id)!.thesis!;
    expect(t.blocks).toEqual(blocs);
  });

  it("les blocs d'une thèse font l'aller-retour + réordonnancement", () => {
    const store = new Store();
    const blocs = [
      { type: "text", text: "Le dollar est cher.", bid: "a1" },
      { type: "image", path: "captures/x/y.png", caption: "DXY", bid: "b2" },
      { type: "text", text: "La Fed reste ferme.", bid: "c3" },
    ];
    const camp = store.create_campaign(new Campaign({ name: "Dollar fort", blocks: blocs }));
    const c = store.campaigns().get(camp.id)!;
    expect(c.blocks).toEqual(blocs);

    const reordered = [blocs[2], blocs[0], blocs[1]];
    store.update_campaign(new Campaign({ id: camp.id, created_at: camp.created_at, name: "Dollar fort", blocks: reordered }));
    const c2 = store.campaigns().get(camp.id)!;
    expect((c2.blocks as { bid: string }[]).map((b) => b.bid)).toEqual(["c3", "a1", "b2"]);
  });
});

// ------------------------------------------------- justesse & quadrant

function pos(ticket_: string, op: string, ot: Date, cp: string, ct: Date, sym = "USDJPY", acc = "14124899") {
  return new Position({
    position_id: ticket_, account_id: acc, symbol: sym, direction: Direction.BUY,
    volume: new Decimal("1"), open_time: ot, open_price: new Decimal(op),
    close_time: ct, close_price: new Decimal(cp), commission: new Decimal(0),
    swap: new Decimal(0), profit_gross: new Decimal("100"),
  });
}

describe("justesse et quadrant", () => {
  it("le taux d'idées correctes (marché a tranché)", () => {
    const store = new Store();
    for (const [tag, outcome] of [
      ["PA", ThesisOutcome.CORRECT],
      ["PB", ThesisOutcome.WRONG],
      ["PC", ThesisOutcome.CORRECT],
      ["PD", ThesisOutcome.UNTESTED],
    ] as const) {
      const i = idee(store);
      const p = pos(tag, "71.40", new Date(Date.UTC(2026, 6, 1, 10)), "72.00", new Date(Date.UTC(2026, 6, 2, 10)), "UKOUSD");
      store.import_report([p], []);
      store.link(i.id, p.uid);
      store.complete_review(i.id, new Review({ thesis_outcome: outcome }));
    }
    const ideas = [...store.load().ideas.values()];
    const rate = ideasCorrectRate(ideas)!;
    expect(rate.n).toBe(3);
    expect(rate.n_correct).toBe(2);
    expect(Math.abs(rate.rate - 2 / 3)).toBeLessThan(1e-9);

    const b = outcomeBreakdown(ideas);
    expect([b.correct, b.wrong, b.untested]).toEqual([2, 1, 1]);
    expect(b.judged).toBe(3);
  });

  function cloturee(pnl: string, score: number) {
    const store = new Store();
    const i0 = idee(store);
    store.open_trade(i0.id, ticket());
    const cf = parse(enc(CSV_CLOTURE.replace("1 920,00", pnl)));
    const p = cf.rows[0]!.to_position("14124899");
    store.import_report([p], []);
    store.link(i0.id, p.uid);
    store.complete_review(
      i0.id,
      new Review({
        entry_in_zone: score >= 1, size_conforme: score >= 2, stop_at_invalidation: score >= 3,
        stop_never_widened: score >= 4, exit_per_plan: score >= 5, thesis_outcome: ThesisOutcome.CORRECT,
      }),
    );
    return store.load().ideas.get(i0.id)!;
  }

  it.each([
    ["1 920,00", 5, Quadrant.MASTERY],
    ["1 920,00", 2, Quadrant.LUCK],
    ["-900,00", 2, Quadrant.ERROR],
    ["-900,00", 5, Quadrant.VARIANCE],
  ])("quadrant croise process et résultat : %s / %d", (pnl, score, attendu) => {
    expect(cloturee(pnl as string, score as number).quadrant).toBe(attendu);
  });

  it("la matrice décision×résultat compte les non-relus à part", () => {
    const gagnant = cloturee("1 920,00", 5);
    const dm = decisionMatrix([gagnant]);
    expect(dm.get(Quadrant.MASTERY).n).toBe(1);
    expect(dm.n_pending).toBe(0);
  });
});
