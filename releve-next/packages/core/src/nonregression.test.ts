// PHASE 7 — non-régression sur le VRAI journal.
//
// Charge le même events.jsonl que py_snapshot.py, recalcule les mêmes chiffres
// et vérifie l'égalité champ par champ avec le snapshot Python. C'est LE gate de
// confiance : le moteur TS reproduit exactement le Python sur les vraies données
// de Paul, avant qu'on ne coupe Streamlit.
//
// Les deux fichiers (journal + snapshot) sont PERSONNELS : non committés,
// .gitignored. Sans eux (CI, autre machine), le test se SAUTE proprement.
//
// Pour (re)générer la référence :  python releve-next/tools/py_snapshot.py
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Decimal } from "./decimal";
import { Store, EventRecord } from "./store";
import { SpecBook } from "./specs";
import { expectancyOf, rMultiples, drawdown, dealCurve } from "./metrics";
import { compute, Period } from "./challenge";

const JOURNAL = fileURLToPath(new URL("../../../../data/events.jsonl", import.meta.url));
const SNAPSHOT = fileURLToPath(new URL("../../../tools/snapshot.json", import.meta.url));

const present = existsSync(JOURNAL) && existsSync(SNAPSHOT);

function q(x: Decimal | null, places: number): string | null {
  return x === null ? null : x.toFixed(places);
}

function tsSnapshot() {
  const events: EventRecord[] = readFileSync(JOURNAL, "utf-8")
    .split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as EventRecord);
  const store = Store.fromEvents(events);
  const { ideas, positions, deals } = store.load();
  const book = new SpecBook([...positions.values()]);
  const campaigns = store.campaigns();

  const snap: {
    ideas: Record<string, unknown>;
    campaigns: Record<string, unknown>;
    global: Record<string, unknown>;
  } = { ideas: {}, campaigns: {}, global: {} };

  for (const [iid, i] of ideas) {
    snap.ideas[iid] = {
      symbol: i.symbol,
      status: i.status,
      n_positions: i.positions.length,
      n_adds: i.adds.length,
      pnl_net: q(i.pnl_net, 2),
      pnl_initial: q(i.pnl_initial, 2),
      pnl_adds: q(i.pnl_adds, 2),
      r_multiple: q(i.r_multiple(book), 4),
      risk_realized: q(i.risk_realized(book), 2),
      max_concurrent_risk: q(i.max_concurrent_risk(book), 2),
      exposure_measured: i.exposure_is_measured(),
      discipline: i.discipline_score,
      quadrant: i.quadrant,
      off_plan: i.off_plan,
      account_id: i.account_id,
    };
  }

  for (const [cid, c] of campaigns) {
    snap.campaigns[cid] = {
      name: c.name,
      instruments: c.instruments,
      n_executed: c.executed_ideas.length,
      pnl_net: q(c.pnl_net, 2),
      r_total: q(c.r_total(book), 4),
      r_weighted: q(c.r_weighted(book), 4),
      abandoned: c.abandoned,
    };
  }

  const exp = expectancyOf(rMultiples([...ideas.values()]));
  const dd = drawdown(dealCurve(deals));
  const st = compute(deals, new Period());

  snap.global = {
    n_ideas: ideas.size,
    n_positions: positions.size,
    n_deals: deals.length,
    n_campaigns: campaigns.size,
    expectancy_n: exp?.n ?? null,
    expectancy_r: exp ? exp.expectancy_r : null,
    win_rate: exp ? exp.win_rate : null,
    total_r: exp ? exp.total_r : null,
    dd_pct: dd ? dd.max_dd_pct : null,
    dd_abs: dd ? new Decimal(dd.max_dd_abs).toFixed(2) : null,
    challenge_balance: q(st?.balance ?? null, 2),
    challenge_margin: q(st?.margin_to_floor ?? null, 2),
    challenge_lowest: q(st?.lowest_ever ?? null, 2),
    challenge_dd_pct: q(st?.drawdown_from_start_pct ?? null, 4),
  };
  return snap;
}

// Champs "global" issus de flottants : comparés numériquement (tolérance),
// pas en chaîne — un dernier chiffre ne doit pas faire échouer une parité réelle.
const FLOAT_GLOBALS = new Set(["expectancy_r", "win_rate", "total_r", "dd_pct"]);

describe.skipIf(!present)("PHASE 7 — non-régression Python ⇄ TS (vrai journal)", () => {
  const py = present
    ? (JSON.parse(readFileSync(SNAPSHOT, "utf-8")) as ReturnType<typeof tsSnapshot>)
    : { ideas: {}, campaigns: {}, global: {} };
  const ts = present ? tsSnapshot() : { ideas: {}, campaigns: {}, global: {} };

  it("mêmes idées, mêmes clés", () => {
    expect(Object.keys(ts.ideas).sort()).toEqual(Object.keys(py.ideas).sort());
    expect(Object.keys(ts.campaigns).sort()).toEqual(Object.keys(py.campaigns).sort());
  });

  it("chaque idée : R, exposition, P&L, quadrant identiques", () => {
    for (const id of Object.keys(py.ideas)) {
      expect(ts.ideas[id], `idée ${id}`).toEqual(py.ideas[id]);
    }
  });

  it("chaque campagne : R agrégé et P&L identiques", () => {
    for (const id of Object.keys(py.campaigns)) {
      expect(ts.campaigns[id], `campagne ${id}`).toEqual(py.campaigns[id]);
    }
  });

  it("agrégats globaux : Decimal exacts, flottants à ±1e-3", () => {
    const pg = py.global as Record<string, unknown>;
    const tg = ts.global as Record<string, unknown>;
    for (const k of Object.keys(pg)) {
      if (FLOAT_GLOBALS.has(k)) {
        expect(Math.abs(Number(tg[k]) - Number(pg[k])), `global.${k}`).toBeLessThan(1e-3);
      } else {
        expect(tg[k], `global.${k}`).toEqual(pg[k]);
      }
    }
  });
});
