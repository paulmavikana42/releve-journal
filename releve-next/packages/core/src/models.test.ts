import { describe, it, expect } from "vitest";
import { Decimal } from "./decimal";
import {
  Direction,
  ExitReason,
  Idea,
  Position,
  Quadrant,
  Review,
  RiskBasis,
  RiskSource,
  StopProvenance,
  Thesis,
  ThesisOutcome,
  type SpecBookLike,
} from "./models";

// Miroir du helper _pos de tests/test_core.py : une Position BTCUSD construite à
// la main, sans passer par le parser (branché au tour suivant).
function pos(
  pid: string,
  openP: string,
  closeP: string,
  opts: {
    vol?: string;
    direction?: Direction;
    gross?: string;
    sl?: string | null;
    slPlacement?: string | null;
    h?: number;
    closeH?: number;
    commission?: string;
    swap?: string;
  } = {},
): Position {
  const h = opts.h ?? 0;
  const t0 = new Date(2026, 6, 7, 21, 51);
  const open = new Date(t0.getTime() + h * 3_600_000);
  const close = new Date(open.getTime() + (opts.closeH ?? 12) * 3_600_000);
  return new Position({
    position_id: pid,
    account_id: "14124899",
    symbol: "BTCUSD",
    direction: opts.direction ?? Direction.SELL,
    volume: new Decimal(opts.vol ?? "0.66"),
    open_time: open,
    open_price: new Decimal(openP),
    close_time: close,
    close_price: new Decimal(closeP),
    commission: new Decimal(opts.commission ?? "0"),
    swap: new Decimal(opts.swap ?? "0"),
    profit_gross: new Decimal(opts.gross ?? "0"),
    sl_final: opts.sl != null ? new Decimal(opts.sl) : null,
    sl_at_placement: opts.slPlacement != null ? new Decimal(opts.slPlacement) : null,
  });
}

const PV1: SpecBookLike = { point_value: () => new Decimal(1) };

// ------------------------------------ le piège : le stop de MT5 ment (port 1:1)

describe("le stop de MT5 produirait un R absurde", () => {
  it("refuse de calculer sur un breakeven, mais accepte le stop de la thèse", () => {
    const p = pos("251022835", "63791.42", "63105.60", { gross: "452.64", sl: "63782.35" });

    const risqueSelonMt5 = p.volume
      .times(p.open_price.minus(p.sl_final as Decimal).abs())
      .times(p.point_value as Decimal);
    expect(p.pnl_net.div(risqueSelonMt5).gt(60)).toBe(true); // +63.5 R, absurde

    // Le garde-fou : refuse plutôt que de mentir.
    expect(p.stop_provenance).toBe(StopProvenance.SUSPECT_BE);
    expect(p.stop_original).toBeNull();
    expect(p.risk()).toBeNull();

    // Avec le stop RÉEL de la thèse, écrit avant d'entrer :
    const idea = new Idea({
      thesis: new Thesis({
        instrument: "BTCUSD",
        direction: Direction.SELL,
        entry_planned: new Decimal("63791.42"),
        stop_initial: new Decimal("64700.51"),
      }),
    });
    idea.positions = [p];
    const r = idea.r_multiple() as Decimal;
    expect(r.gt("0.7") && r.lt("0.8")).toBe(true); // +0.75 R, crédible
  });
});

// ------------------------------------------------------------ provenance du stop

describe("provenance du stop", () => {
  it("PROVEN quand SL placement == SL final ; risque calculable", () => {
    const p = pos("A", "100", "90", {
      vol: "1",
      gross: "10",
      sl: "110",
      slPlacement: "110",
      direction: Direction.SELL,
    });
    expect(p.stop_provenance).toBe(StopProvenance.PROVEN);
    expect((p.stop_original as Decimal).eq("110")).toBe(true);
  });

  it("MOVED quand ils diffèrent : l'original est le SL du placement", () => {
    const p = pos("A", "100", "90", {
      vol: "1",
      gross: "10",
      sl: "101",
      slPlacement: "112",
      direction: Direction.SELL,
    });
    expect(p.stop_provenance).toBe(StopProvenance.MOVED);
    expect((p.stop_original as Decimal).eq("112")).toBe(true);
  });

  it("NONE sans aucun SL", () => {
    const p = pos("A", "100", "90", { vol: "1", gross: "10" });
    expect(p.stop_provenance).toBe(StopProvenance.NONE);
    expect(p.stop_original).toBeNull();
  });
});

// ------------------------------------------------ valeur du point auto-déduite

describe("valeur du point auto-déduite (une position)", () => {
  it("pv = profit_brut / (volume × déplacement)", () => {
    // SELL 100 -> 90, vol 0.66, gross 452.64  =>  move = 10, denom = 6.6
    const p = pos("A", "100", "90", { vol: "0.66", gross: "6.6", direction: Direction.SELL });
    expect((p.point_value as Decimal).eq("1")).toBe(true);
    expect(p.price_move.eq("10")).toBe(true);
  });
});

// ------------------------------------------- somme des risques, invalidation

describe("le risque d'une idée est la SOMME de ses tickets", () => {
  it("additionne les risques par ticket (base SUM)", () => {
    const core = pos("core", "100", "95", { vol: "1", gross: "5", h: 0, closeH: 10 });
    const add = pos("add", "100", "97", {
      vol: "1",
      gross: "3",
      sl: "94",
      slPlacement: "94", // PROVEN -> stop_original 94
      h: 1,
      closeH: 3,
    });
    const idea = new Idea({
      thesis: new Thesis({
        instrument: "BTCUSD",
        direction: Direction.SELL,
        entry_planned: new Decimal("100"),
        stop_initial: new Decimal("90"), // stop du noyau
      }),
    });
    idea.positions = [core, add];

    // noyau : stop de l'idée (90) -> risque 1*10*1 = 10
    // add   : son propre stop prouvé (94) -> risque 1*6*1 = 6
    const risks = idea.ticket_risks(PV1);
    expect((risks.get("core") as Decimal).eq("10")).toBe(true);
    expect((risks.get("add") as Decimal).eq("6")).toBe(true);

    const total = idea.risk_realized(PV1, RiskBasis.SUM) as Decimal;
    expect(total.eq("16")).toBe(true);
  });

  it("un seul ticket sans stop connu invalide le total (null)", () => {
    const core = pos("core", "100", "95", { vol: "1", gross: "5", h: 0, closeH: 10 });
    const add = pos("add", "100", "97", { vol: "1", gross: "3", h: 1, closeH: 3 }); // pas de SL
    const idea = new Idea({
      thesis: new Thesis({
        instrument: "BTCUSD",
        direction: Direction.SELL,
        entry_planned: new Decimal("100"),
        stop_initial: new Decimal("90"),
      }),
    });
    idea.positions = [core, add];
    // l'add n'a ni stop propre ni stop hérité (le stop de l'idée ne vaut QUE pour le noyau)
    expect(idea.tickets_needing_stop().map((p) => p.position_id)).toEqual(["add"]);
    expect(idea.risk_realized(PV1, RiskBasis.SUM)).toBeNull();
  });
});

// ------------------------------------------------ exposition simultanée + BE

describe("exposition simultanée (max_concurrent_risk)", () => {
  function ideaAvecAdd(): { idea: Idea; addUid: string } {
    const core = pos("core", "100", "98", { vol: "1", gross: "2", h: 0, closeH: 10 });
    const add = pos("add", "100", "99", {
      vol: "1",
      gross: "1",
      sl: "95",
      slPlacement: "95", // PROVEN -> stop 95 -> risque 5
      h: 2,
      closeH: 4, // ouvert pendant que le noyau vit -> vrai add qui chevauche
    });
    const idea = new Idea({
      thesis: new Thesis({
        instrument: "BTCUSD",
        direction: Direction.SELL,
        entry_planned: new Decimal("100"),
        stop_initial: new Decimal("90"), // noyau -> risque 10
      }),
    });
    idea.positions = [core, add];
    return { idea, addUid: add.uid };
  }

  it("additionne les risques concurrents quand rien n'est sécurisé", () => {
    const { idea } = ideaAvecAdd();
    // noyau (10) + add (5) se chevauchent -> pic 15
    expect((idea.max_concurrent_risk(PV1) as Decimal).eq("15")).toBe(true);
    expect(idea.exposure_is_measured()).toBe(false); // add sans réponse BE
  });

  it("le noyau au breakeven sort du calcul à l'ouverture de l'add", () => {
    const { idea, addUid } = ideaAvecAdd();
    idea.secured_on_add.set(addUid, true);
    // à l'ouverture de l'add, le noyau tombe à 0 -> pic = max(10 seul, 0+5) = 10
    expect((idea.max_concurrent_risk(PV1) as Decimal).eq("10")).toBe(true);
    expect(idea.exposure_is_measured()).toBe(true);
  });
});

// ------------------------------------------------ noyau / fragment / add

describe("noyau, fragment, add", () => {
  it("même heure ET même prix = fragment du noyau ; sinon add", () => {
    const core = pos("core", "100", "98", { vol: "1", gross: "2", h: 0, closeH: 10 });
    const fragment = pos("frag", "100", "97", { vol: "1", gross: "1", h: 0, closeH: 6 }); // même t0+prix
    const add = pos("add", "100", "99", { vol: "1", gross: "1", h: 3, closeH: 5 }); // heure différente
    const idea = new Idea();
    idea.positions = [core, fragment, add];

    expect(idea.est_du_noyau(core)).toBe(true);
    expect(idea.est_du_noyau(fragment)).toBe(true);
    expect(idea.est_du_noyau(add)).toBe(false);
    expect(idea.adds.map((p) => p.position_id)).toEqual(["add"]);
  });

  it("tickets_disjoints : un ticket qui ne chevauche aucun autre est signalé", () => {
    const core = pos("core", "100", "98", { vol: "1", gross: "2", h: 0, closeH: 4 }); // [0h,4h]
    const tard = pos("tard", "100", "99", { vol: "1", gross: "1", h: 10, closeH: 2 }); // [10h,12h]
    const idea = new Idea();
    idea.positions = [core, tard];
    expect(idea.tickets_disjoints.map((p) => p.position_id)).toEqual(["tard"]);
  });
});

// ------------------------------------------------ pnl noyau vs adds

describe("P&L noyau vs renforcements", () => {
  it("sépare le P&L du noyau de celui des adds", () => {
    const core = pos("core", "100", "98", { vol: "1", gross: "380.36", h: 0, closeH: 10 });
    const add = pos("add", "100", "99", { vol: "1", gross: "-969.10", h: 2, closeH: 4 });
    const idea = new Idea();
    idea.positions = [core, add];
    expect(idea.pnl_initial.eq("380.36")).toBe(true);
    expect(idea.pnl_adds.eq("-969.10")).toBe(true);
    expect(idea.pnl_initial.plus(idea.pnl_adds).eq(idea.pnl_net)).toBe(true);
  });
});

// ------------------------------------------------ quadrant décision × résultat

describe("quadrant décision × résultat", () => {
  function executed(pnl: string, score: number, reviewed = true): Idea {
    const p = pos("A", "100", "90", { vol: "1", gross: pnl });
    const idea = new Idea();
    idea.positions = [p];
    if (reviewed) {
      idea.review = new Review({
        entry_in_zone: score >= 1,
        size_conforme: score >= 2,
        stop_at_invalidation: score >= 3,
        stop_never_widened: score >= 4,
        exit_per_plan: score >= 5,
        thesis_outcome: ThesisOutcome.CORRECT,
      });
    }
    return idea;
  }

  it("maîtrise = gain + process tenu (>=4/5)", () => {
    expect(executed("10", 5).quadrant).toBe(Quadrant.MASTERY);
  });
  it("chance = gain + process dégradé", () => {
    expect(executed("10", 2).quadrant).toBe(Quadrant.LUCK);
  });
  it("erreur = perte + process dégradé", () => {
    expect(executed("-10", 2).quadrant).toBe(Quadrant.ERROR);
  });
  it("aléa OK = perte + process tenu", () => {
    expect(executed("-10", 5).quadrant).toBe(Quadrant.VARIANCE);
  });
  it("en attente sans review", () => {
    expect(executed("10", 5, false).quadrant).toBe(Quadrant.PENDING);
  });
});

// ------------------------------------------------ R calculable ?

describe("risk_source", () => {
  it("UNKNOWN sans aucun stop dans la thèse", () => {
    const idea = new Idea({
      thesis: new Thesis({ instrument: "BTCUSD", direction: Direction.SELL }),
    });
    expect(idea.risk_source).toBe(RiskSource.UNKNOWN);
  });
  it("COMPUTED dès qu'un stop initial existe", () => {
    const idea = new Idea({
      thesis: new Thesis({
        instrument: "BTCUSD",
        direction: Direction.SELL,
        stop_initial: new Decimal("90"),
      }),
    });
    expect(idea.risk_source).toBe(RiskSource.COMPUTED);
  });
  it("UNKNOWN sans thèse du tout", () => {
    expect(new Idea().risk_source).toBe(RiskSource.UNKNOWN);
  });
});

// garde-fou anti-régression : ExitReason par défaut
describe("valeurs par défaut", () => {
  it("une Position sans exit_reason est UNKNOWN", () => {
    expect(pos("A", "100", "90").exit_reason).toBe(ExitReason.UNKNOWN);
  });
});
