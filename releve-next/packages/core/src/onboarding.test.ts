import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Decimal } from "./decimal";
import * as O from "./onboarding";
import * as paths from "./paths";
import * as settings from "./settings";
import { PropRules } from "./prop";
import { JsonlStore } from "./jsonl-store";
import { Direction, Position, Quadrant, RiskSource, Thesis } from "./models";
import { COMPTE, seed } from "./seed-demo";
import { SpecBook } from "./specs";

function these(instrument = "BTCUSD"): Thesis {
  return new Thesis({ instrument, direction: Direction.SELL,
    entry_planned: new Decimal("60000"), stop_initial: new Decimal("61000"),
    risk_source: RiskSource.COMPUTED });
}

function position(ticket = "99001"): Position {
  return new Position({
    position_id: ticket, account_id: "A", symbol: "BTCUSD", direction: Direction.SELL,
    volume: new Decimal("1"), open_time: new Date(Date.UTC(2026, 6, 20, 9, 0)),
    open_price: new Decimal("60000"), close_time: new Date(Date.UTC(2026, 6, 20, 18, 0)),
    close_price: new Decimal("59000"), commission: new Decimal("0"), swap: new Decimal("0"),
    profit_gross: new Decimal("1000") });
}

let tmp: string;
const prev = process.env["RELEVE_DATA"];
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "releve-onb-"));
  process.env["RELEVE_DATA"] = tmp;
  paths.setFrozen(false);
});
afterEach(() => {
  paths.setFrozen(false);
  if (prev === undefined) delete process.env["RELEVE_DATA"];
  else process.env["RELEVE_DATA"] = prev;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("premier lancement", () => {
  it("au premier lancement, rien n'est configuré", () => {
    expect(O.configured()).toBe(false);
    expect(O.demoMode()).toBe(false);
  });

  it("démarrer vierge ne crée aucune donnée", () => {
    O.startBlank();
    expect(O.configured()).toBe(true);
    expect(O.demoMode()).toBe(false);
    const journal = O.currentJournal();
    expect(path.basename(journal)).toBe("events.jsonl");
    expect(new JsonlStore(journal).events()).toEqual([]);
  });

  it("le choix ne se redemande jamais", () => {
    O.startBlank();
    expect(O.configured()).toBe(true);
    expect(new JsonlStore(O.currentJournal()).events()).toEqual([]);
    expect(O.configured()).toBe(true);
  });

  it("aucun compte n'est supposé avant le choix", () => {
    expect(settings.read()["accounts"]).toBeUndefined();
    settings.saveAccounts([new PropRules({ label: "The5%ers", start_balance: new Decimal("50000") })]);
    expect(settings.accounts()[0]!.start_balance.eq("50000")).toBe(true);
  });
});

describe("la démo isolée", () => {
  it("la démo vit dans son propre fichier", () => {
    const chemin = O.startDemo();
    expect(path.basename(chemin)).toBe("demo.jsonl");
    new JsonlStore(chemin, { demo: true }).create_thesis(these(), { label: "démo" });
    expect(fs.existsSync(path.join(tmp, "demo.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, "events.jsonl"))).toBe(false);
  });

  it("chaque événement de démo est marqué", () => {
    const store = new JsonlStore(O.startDemo(), { demo: true });
    store.create_thesis(these(), { label: "démo" });
    expect(store.events().every((e) => e.demo)).toBe(true);
  });

  it("un store normal ne marque rien", () => {
    const store = new JsonlStore(O.startBlank());
    store.create_thesis(these(), { label: "vrai" });
    expect(store.events().some((e) => e.demo)).toBe(false);
  });

  it("la démonstration est entièrement inventée", () => {
    const store = new JsonlStore(O.startDemo(), { demo: true });
    seed(store);
    const { ideas, positions } = store.load();
    expect(COMPTE.startsWith("DEMO")).toBe(true);
    expect(new Set([...positions.values()].map((p) => p.account_id))).toEqual(new Set([COMPTE]));
    expect(new Set([...ideas.values()].map((i) => i.account_id))).toEqual(new Set([COMPTE]));
    const brut = fs.readFileSync(O.currentJournal(), "utf-8");
    expect(brut).not.toContain("14124899");
    expect(brut).not.toContain("251022835");
  });

  it("la démonstration raconte quelque chose", () => {
    const store = new JsonlStore(O.startDemo(), { demo: true });
    const idId = seed(store);
    const { ideas, positions, deals } = store.load();
    const i = ideas.get(idId)!;
    expect(i.positions.length).toBe(3);
    expect(i.adds.length).toBe(2);
    expect(i.pnl_initial.gt(0)).toBe(true);
    expect(i.pnl_adds.lt(0)).toBe(true);
    expect(i.review).not.toBeNull();
    expect(i.quadrant).toBe(Quadrant.ERROR);
    expect(i.exposure_is_measured()).toBe(true);
    expect((i.r_multiple(new SpecBook([...positions.values()])) as Decimal).lt(0)).toBe(true);
    expect(deals.length).toBeGreaterThan(0);
    expect([...ideas.values()].some((x) => x.is_running)).toBe(true);
  });
});

describe("la démo saute au 1er import", () => {
  it("le premier import réel met fin à la démo", () => {
    new JsonlStore(O.startDemo(), { demo: true }).create_thesis(these(), { label: "idée de démonstration" });
    expect(O.demoMode()).toBe(true);
    const [reelPath, repris] = O.leaveDemo();
    expect(O.demoMode()).toBe(false);
    expect(path.basename(reelPath)).toBe("events.jsonl");
    expect(repris).toBe(0);
    expect(new JsonlStore(reelPath).events()).toEqual([]);
  });

  it("ce que l'utilisateur a écrit pendant la démo est conservé", () => {
    new JsonlStore(O.startDemo(), { demo: true }).create_thesis(these(), { label: "décor de démonstration" });
    const sien = new JsonlStore(O.currentJournal(), { demo: false });
    const idee = sien.create_thesis(these("UKOUSD"), { label: "ma vraie idée" });
    const [reelPath, repris] = O.leaveDemo();
    expect(repris).toBe(1);
    const { ideas } = new JsonlStore(reelPath).load();
    expect(ideas.size).toBe(1);
    expect(ideas.get(idee.id)!.label).toBe("ma vraie idée");
  });

  it("le décor de démonstration est supprimé", () => {
    new JsonlStore(O.startDemo(), { demo: true }).create_thesis(these(), { label: "décor BTC" });
    O.leaveDemo();
    expect(fs.existsSync(path.join(tmp, "demo.jsonl"))).toBe(false);
    const restes = fs.readdirSync(tmp).filter((f) => f.endsWith(".jsonl"))
      .map((f) => fs.readFileSync(path.join(tmp, f), "utf-8")).join("\n");
    expect(restes).not.toContain("décor BTC");
  });

  it("le décor n'est effacé qu'APRÈS avoir sauvé ce qui compte", () => {
    new JsonlStore(O.startDemo(), { demo: true }).create_thesis(these(), { label: "décor" });
    new JsonlStore(O.currentJournal(), { demo: false }).create_thesis(these("XAUUSD"), { label: "la mienne" });
    const [reel, repris] = O.leaveDemo();
    expect(repris).toBe(1);
    expect(fs.existsSync(path.join(tmp, "demo.jsonl"))).toBe(false);
    expect(fs.readFileSync(reel, "utf-8")).toContain("la mienne");
  });

  it("quitter la démo deux fois ne duplique rien", () => {
    new JsonlStore(O.startDemo(), { demo: true }).create_thesis(these(), { label: "décor" });
    new JsonlStore(O.currentJournal(), { demo: false }).create_thesis(these("XAUUSD"), { label: "la mienne" });
    O.leaveDemo();
    const n1 = new JsonlStore(O.currentJournal()).events().length;
    O.leaveDemo();
    expect(new JsonlStore(O.currentJournal()).events().length).toBe(n1);
  });

  it("détection de vrais tickets", () => {
    const store = new JsonlStore(O.startDemo(), { demo: true });
    store.import_report([position()], []);
    expect(O.hasRealPositions(store.path)).toBe(false);

    const vrai = new JsonlStore(O.startBlank());
    vrai.import_report([position("99002")], []);
    expect(O.hasRealPositions(vrai.path)).toBe(true);
  });
});

describe("remise à zéro", () => {
  it("sauvegarde avant d'écarter", () => {
    new JsonlStore(O.startBlank()).create_thesis(these(), { label: "trois ans de travail" });
    O.resetAll(true);
    expect(fs.existsSync(path.join(tmp, "events.jsonl"))).toBe(false);
    expect(O.configured()).toBe(false);
    const sauvegardes = fs.readdirSync(tmp).filter((f) => f.includes("avant-remise-a-zero"));
    expect(sauvegardes.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(tmp, sauvegardes[0]!), "utf-8")).toContain("trois ans de travail");
  });

  it("jette la démonstration sans la sauvegarder", () => {
    new JsonlStore(O.startDemo(), { demo: true }).create_thesis(these(), { label: "décor BTC" });
    O.resetAll(true);
    expect(fs.existsSync(path.join(tmp, "demo.jsonl"))).toBe(false);
    expect(fs.readdirSync(tmp).filter((f) => f.startsWith("demo") && f.includes("avant-remise-a-zero")).length).toBe(0);
  });
});

describe("les chemins", () => {
  it("le dossier de données est forçable", () => {
    expect(paths.dataDir()).toBe(tmp);
  });

  it("le journal ne vit jamais à côté du programme", () => {
    delete process.env["RELEVE_DATA"];
    paths.setFrozen(true);
    const d = paths.dataDir();
    const root = paths.repoRoot();
    expect(d.startsWith(root)).toBe(false);
    expect(path.isAbsolute(d)).toBe(true);
  });
});
