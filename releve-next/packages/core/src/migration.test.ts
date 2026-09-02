import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Decimal } from "./decimal";
import * as M from "./migration";
import * as O from "./onboarding";
import { JsonlStore } from "./jsonl-store";
import { Direction, RiskSource, Thesis } from "./models";

const enc = (s: string) => new TextEncoder().encode(s);

// Un journal tel que l'écrivait la PREMIÈRE version : pas d'account_id, pas de
// drapeau demo, pas de trade ouvert, pas de capture — et pourtant il se relit.
const ANCIEN =
  [
    JSON.stringify({ v: 1, ts: "2026-05-02T08:00:00+00:00", type: "thesis_created",
      payload: { id: "abc123", created_at: { $dt: "2026-05-02T08:00:00" },
        thesis: { instrument: "EURUSD", direction: "sell", macro_theme: "BCE / zone euro",
          entry_planned: { $dec: "1.0900" }, stop_initial: { $dec: "1.1000" },
          risk_pct: { $dec: "0.5" }, risk_source: "computed", targets: [] },
        status: "armee", off_plan: false, label: "Short EURUSD — BCE" } }),
    JSON.stringify({ v: 1, ts: "2026-05-04T18:00:00+00:00", type: "position_imported",
      payload: { position_id: "77001", account_id: "14124899", symbol: "EURUSD",
        direction: "sell", volume: { $dec: "1.0" }, open_time: { $dt: "2026-05-03T09:00:00" },
        open_price: { $dec: "1.0900" }, close_time: { $dt: "2026-05-04T17:00:00" },
        close_price: { $dec: "1.0850" }, commission: { $dec: "0" }, swap: { $dec: "0" },
        profit_gross: { $dec: "500" }, exit_reason: "manual" } }),
    JSON.stringify({ v: 1, ts: "2026-05-04T18:00:01+00:00", type: "position_linked",
      payload: { idea_id: "abc123", position_uid: "14124899:77001" } }),
  ].join("\n") + "\n";

let tmp: string;
const prev = process.env["RELEVE_DATA"];
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "releve-mig-"));
  process.env["RELEVE_DATA"] = tmp;
});
afterEach(() => {
  if (prev === undefined) delete process.env["RELEVE_DATA"];
  else process.env["RELEVE_DATA"] = prev;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function journalActuel(label = "idée récente"): JsonlStore {
  const store = new JsonlStore(O.startBlank());
  store.create_thesis(
    new Thesis({ instrument: "XAUUSD", direction: Direction.BUY,
      entry_planned: new Decimal("2380"), stop_initial: new Decimal("2360"),
      risk_source: RiskSource.COMPUTED }),
    { label },
  );
  return store;
}

describe("migration : regarder", () => {
  it("l'aperçu dit ce que contient le fichier", () => {
    const ap = M.inspect(enc(ANCIEN));
    expect(ap.evenements).toBe(3);
    expect(ap.idees).toBe(1);
    expect(ap.tickets).toBe(1);
    expect(ap.illisibles).toBe(0);
    expect(ap.types_inconnus.size).toBe(0);
    expect(ap.premiere!.getUTCFullYear()).toBe(2026);
    expect(ap.premiere!.getUTCMonth() + 1).toBe(5);
    expect(ap.premiere!.getUTCDate()).toBe(2);
  });

  it("un fichier qui n'est pas un journal est refusé", () => {
    expect(() => M.inspect(enc("Ticket;Symbol;Type\n88210912;UKOUSD;buy\n"))).toThrow(M.MigrationError);
    expect(() => M.inspect(enc(""))).toThrow(M.MigrationError);
  });

  it("une ligne corrompue ne condamne pas le fichier", () => {
    const ap = M.inspect(enc(ANCIEN + "{ceci n'est pas du json\n"));
    expect(ap.evenements).toBe(3);
    expect(ap.illisibles).toBe(1);
  });

  it("un type inconnu est signalé, pas avalé", () => {
    const futur = ANCIEN + JSON.stringify({ v: 2, ts: "2027-01-01T00:00:00+00:00", type: "chose_du_futur", payload: {} }) + "\n";
    const ap = M.inspect(enc(futur));
    expect([...ap.types_inconnus]).toEqual(["chose_du_futur"]);
  });

  it("UTF-16 et BOM sont acceptés", () => {
    // UTF-16LE avec BOM
    const bom = Buffer.from([0xff, 0xfe]);
    const body = Buffer.from(ANCIEN, "utf16le");
    const ap = M.inspect(new Uint8Array(Buffer.concat([bom, body])));
    expect(ap.evenements).toBe(3);
  });
});

describe("migration : installer", () => {
  it("un ancien journal se relit sans conversion", () => {
    M.install(enc(ANCIEN), "remplacer");
    const { ideas, positions } = new JsonlStore(O.currentJournal()).load();
    expect(ideas.size).toBe(1);
    expect(positions.size).toBe(1);
    const idee = ideas.get("abc123")!;
    expect(idee.symbol).toBe("EURUSD");
    expect(idee.pnl_net.eq("500")).toBe(true);
    // R rétro-déduit : 500 $ / (1 lot × 0.0050) → risque 1000 $ pour 100 pts. +0.5 R.
    expect((idee.r_multiple() as Decimal).eq("0.5")).toBe(true);
    expect(idee.account_id).toBe("");
    expect(idee.open_trades).toEqual([]);
    expect(idee.captures).toEqual([]);
  });

  it("remplacer sauvegarde l'ancien journal", () => {
    journalActuel("trois ans de travail");
    const [, ecrites, sauvegarde] = M.install(enc(ANCIEN), "remplacer");
    expect(ecrites).toBe(3);
    expect(sauvegarde).not.toBeNull();
    expect(fs.existsSync(sauvegarde!)).toBe(true);
    expect(fs.readFileSync(sauvegarde!, "utf-8")).toContain("trois ans de travail");
    expect(fs.readFileSync(O.currentJournal(), "utf-8")).not.toContain("trois ans de travail");
  });

  it("ajouter ne reprend pas deux fois les mêmes lignes", () => {
    M.install(enc(ANCIEN), "remplacer");
    const [, ecrites] = M.install(enc(ANCIEN), "ajouter");
    expect(ecrites).toBe(0);
    const { ideas, positions } = new JsonlStore(O.currentJournal()).load();
    expect(ideas.size).toBe(1);
    expect(positions.size).toBe(1);
  });

  it("ajouter conserve ce qui était déjà là", () => {
    journalActuel("mon idée du mois");
    const [, ecrites] = M.install(enc(ANCIEN), "ajouter");
    expect(ecrites).toBe(3);
    const { ideas } = new JsonlStore(O.currentJournal()).load();
    const labels = new Set([...ideas.values()].map((i) => i.label));
    expect(labels.has("mon idée du mois")).toBe(true);
    expect(labels.has("Short EURUSD — BCE")).toBe(true);
  });

  it("reprendre un journal met fin à la démonstration", () => {
    new JsonlStore(O.startDemo(), { demo: true }).create_thesis(
      new Thesis({ instrument: "BTCUSD", direction: Direction.SELL }), { label: "décor BTC" });
    expect(O.demoMode()).toBe(true);

    M.install(enc(ANCIEN), "remplacer");

    expect(O.demoMode()).toBe(false);
    expect(O.configured()).toBe(true);
    expect(fs.existsSync(path.join(tmp, "demo.jsonl"))).toBe(false);
    expect(fs.readFileSync(O.currentJournal(), "utf-8")).not.toContain("décor BTC");
  });

  it("un mode inconnu est refusé", () => {
    expect(() => M.install(enc(ANCIEN), "fusionner" as "remplacer")).toThrow(M.MigrationError);
  });
});
