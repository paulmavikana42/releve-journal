// PHASE 2 — PREUVE de cloisonnement multi-comptes, de bout en bout.
//
// Deux challenges ne partagent RIEN. La preuve n'est pas au niveau unitaire
// (belongs_to/owner_uid, déjà couverts dans prop.test) mais sur un journal
// COMPLET rejoué : idées + positions + deals tagués par compte, puis scopés,
// puis métriques/challenge calculés par compte — aucune contamination croisée.
//
// Modèle fidèle à l'app : à la création/import, tout est tagué par l'UID INTERNE
// du compte actif (jamais le n° broker, vide ou partagé). Le n° broker vit dans
// position_id/ticket, pour le rapprochement seul.
import { describe, it, expect } from "vitest";
import { Decimal } from "./decimal";
import { Store } from "./store";
import { PropRules, scopeToAccount, mine } from "./prop";
import { expectancyOf, rMultiples } from "./metrics";
import { compute, Period } from "./challenge";
import { Campaign, Deal, Direction, Idea, Position, RiskSource, Thesis } from "./models";

const D = (s: string) => new Decimal(s);

/** Ajoute au journal une idée + son ticket + son deal, tous tagués `uid`. */
function trade(
  store: Store, uid: string, sym: string, entry: string, closeP: string,
  gross: string, balance: string, day: number, dealN: number,
): Idea {
  const idea = store.create_thesis(
    new Thesis({
      instrument: sym, direction: Direction.SELL, entry_planned: D(entry),
      stop_initial: D(entry).plus("100"), risk_source: RiskSource.COMPUTED,
    }),
    { label: `${sym} @ ${uid.slice(0, 4)}`, account_id: uid },
  );
  const pos = new Position({
    position_id: `${dealN}`, account_id: uid, symbol: sym, direction: Direction.SELL,
    volume: D("1"), open_time: new Date(Date.UTC(2026, 6, day, 9)), open_price: D(entry),
    close_time: new Date(Date.UTC(2026, 6, day, 17)), close_price: D(closeP),
    commission: D("0"), swap: D("0"), profit_gross: D(gross),
  });
  const deal = new Deal({
    deal_id: `d${dealN}`, time: new Date(Date.UTC(2026, 6, day, 17)), symbol: sym,
    deal_type: "sell", entry: "out", volume: D("1"), price: D(closeP), order_id: `${dealN}`,
    commission: D("0"), fee: D("0"), swap: D("0"), profit: D(gross), balance: D(balance),
    account_id: uid,
  });
  store.import_report([pos], [deal]);
  store.link(idea.id, pos.uid);
  return idea;
}

describe("PHASE 2 — cloisonnement multi-comptes (preuve bout-en-bout)", () => {
  // Deux comptes, dont un à n° broker VIDE (le vrai bug historique).
  const A = new PropRules({ account_id: "14124899", label: "FundedNext A" });
  const B = new PropRules({ account_id: "", label: "Perso B" });
  const uids = [A.uid, B.uid]; // [0] = défaut

  function journal(): Store {
    const store = new Store();
    trade(store, A.uid, "NDX100", "20000", "19900", "1000", "101000", 1, 1); // A gagne
    trade(store, A.uid, "SPX500", "5000", "5010", "-300", "100700", 2, 2); // A perd un peu
    trade(store, B.uid, "BTCUSD", "60000", "60500", "-500", "99500", 3, 3); // B perd
    // idée LEGACY : écrite avant les comptes multiples (account_id "").
    const legacy = store.create_thesis(
      new Thesis({ instrument: "XAUUSD", direction: Direction.BUY, entry_planned: D("2300"),
        stop_initial: D("2280"), risk_source: RiskSource.COMPUTED }),
      { label: "Vieille idée sans compte" }, // account_id "" par défaut
    );
    const lp = new Position({
      position_id: "9", account_id: "", symbol: "XAUUSD", direction: Direction.BUY,
      volume: D("1"), open_time: new Date(Date.UTC(2026, 6, 4, 9)), open_price: D("2300"),
      close_time: new Date(Date.UTC(2026, 6, 4, 17)), close_price: D("2320"),
      commission: D("0"), swap: D("0"), profit_gross: D("200"),
    });
    store.import_report([lp], [new Deal({
      deal_id: "d9", time: new Date(Date.UTC(2026, 6, 4, 17)), symbol: "XAUUSD",
      deal_type: "buy", entry: "out", volume: D("1"), price: D("2320"), order_id: "9",
      commission: D("0"), fee: D("0"), swap: D("0"), profit: D("200"), balance: D("100900"),
      account_id: "",
    })]);
    store.link(legacy.id, lp.uid);
    return store;
  }

  it("le compte A voit ses idées + le legacy, jamais celles de B", () => {
    const store = journal();
    const scoped = scopeToAccount(store.load(), A.uid, uids);
    const instruments = scoped.ideas.map((i) => i.thesis!.instrument).sort();
    expect(instruments).toEqual(["NDX100", "SPX500", "XAUUSD"]); // A + legacy
    expect(instruments).not.toContain("BTCUSD"); // rien de B
  });

  it("le compte B ne voit QUE ses idées — ni A, ni le legacy", () => {
    const store = journal();
    const scoped = scopeToAccount(store.load(), B.uid, uids);
    expect(scoped.ideas.map((i) => i.thesis!.instrument)).toEqual(["BTCUSD"]);
  });

  it("les transactions (soldes) sont cloisonnées elles aussi", () => {
    const store = journal();
    const a = scopeToAccount(store.load(), A.uid, uids);
    const b = scopeToAccount(store.load(), B.uid, uids);
    expect(a.deals.map((d) => d.deal_id).sort()).toEqual(["d1", "d2", "d9"]); // A + legacy
    expect(b.deals.map((d) => d.deal_id)).toEqual(["d3"]);
    // aucun deal partagé
    const inter = a.deals.filter((d) => b.deals.some((x) => x.deal_id === d.deal_id));
    expect(inter).toEqual([]);
  });

  it("les métriques par compte ne mélangent aucun trade", () => {
    const store = journal();
    const a = scopeToAccount(store.load(), A.uid, uids);
    const b = scopeToAccount(store.load(), B.uid, uids);
    const expA = expectancyOf(rMultiples(a.ideas))!;
    const expB = expectancyOf(rMultiples(b.ideas))!;
    expect(expA.n).toBe(3); // NDX100, SPX500, legacy XAUUSD
    expect(expB.n).toBe(1); // BTCUSD seul
    // A est globalement gagnant (1000 - 300 + 200), B perdant (-500)
    expect(expA.total_r).toBeGreaterThan(0);
    expect(expB.total_r).toBeLessThan(0);
  });

  it("le challenge se calcule sur le solde du SEUL compte scopé", () => {
    const store = journal();
    const a = scopeToAccount(store.load(), A.uid, uids);
    const b = scopeToAccount(store.load(), B.uid, uids);
    const stA = compute(a.deals, new Period())!;
    const stB = compute(b.deals, new Period())!;
    // dernier solde de A = 100900 (legacy clôt le dernier), de B = 99500
    expect(stA.balance.eq("100900")).toBe(true);
    expect(stB.balance.eq("99500")).toBe(true);
    expect(stA.balance.eq(stB.balance)).toBe(false); // deux comptes, deux réalités
  });

  it("un seul compte : tout est visible, y compris l'historique jamais tagué", () => {
    const store = journal();
    const scoped = scopeToAccount(store.load(), A.uid, [A.uid]); // len<=1
    const instruments = scoped.ideas.map((i) => i.thesis!.instrument).sort();
    expect(instruments).toEqual(["BTCUSD", "NDX100", "SPX500", "XAUUSD"]);
  });

  it("les thèses macro (campagnes) sont cloisonnées par compte", () => {
    const store = journal();
    store.create_campaign(new Campaign({ name: "Dollar fort", account_id: A.uid }));
    store.create_campaign(new Campaign({ name: "Crypto hiver", account_id: B.uid }));
    const load = store.load();
    const campaigns = store.campaigns();
    const a = scopeToAccount({ ...load, campaigns }, A.uid, uids);
    const b = scopeToAccount({ ...load, campaigns }, B.uid, uids);
    expect([...a.campaigns.values()].map((c) => c.name)).toEqual(["Dollar fort"]);
    expect([...b.campaigns.values()].map((c) => c.name)).toEqual(["Crypto hiver"]);
  });

  it("le n° broker vide ne confond pas deux comptes (uid unique)", () => {
    const store = journal();
    expect(A.uid).not.toBe(B.uid);
    // un objet tagué de l'uid de B n'appartient jamais à A, malgré le broker vide
    const bIdea = new Idea({ account_id: B.uid });
    expect(mine(bIdea, A.uid, uids)).toBe(false);
    expect(mine(bIdea, B.uid, uids)).toBe(true);
    // un tag inconnu (n° broker brut, compte supprimé) retombe sur le premier
    expect(mine(new Idea({ account_id: "999999" }), A.uid, uids)).toBe(true);
    expect(mine(new Idea({ account_id: "999999" }), B.uid, uids)).toBe(false);
  });
});
