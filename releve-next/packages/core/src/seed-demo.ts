// La démonstration : un journal fabriqué de toutes pièces — port de seed_demo.py.
//
// TOUT EST INVENTÉ : compte fictif (DEMO-0001), tickets fictifs, aucun rapport
// réel. Les chiffres sont choisis pour RACONTER : un noyau gagnant dont les
// renforcements coûtent, une review 3/5 sur thèse fausse (quadrant « erreur »),
// un trade encore ouvert, une série de soldes pour le drawdown/compliance.
import { Decimal } from "./decimal";
import { serverNow } from "./clock";
import {
  Deal, Direction, ExitReason, OpenTrade, Position, Review, RiskSource, Thesis, ThesisOutcome,
} from "./models";
import type { Store } from "./store";

export const COMPTE = "DEMO-0001";
const DEPART = new Decimal("100000");

function jours(n: number, heure = 9): Date {
  const d = serverNow();
  const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), heure, 0, 0, 0));
  return new Date(base.getTime() - n * 86_400_000);
}

function position(
  ticket: string, volume: string, ouverture: Date, entree: string, cloture: Date,
  sortie: string, profit: string,
  opts: { sl?: string; slPlace?: string; symbole?: string; sens?: Direction; raison?: ExitReason } = {},
): Position {
  return new Position({
    position_id: ticket, account_id: COMPTE, symbol: opts.symbole ?? "NDX100",
    direction: opts.sens ?? Direction.SELL, volume: new Decimal(volume),
    open_time: ouverture, open_price: new Decimal(entree), close_time: cloture,
    close_price: new Decimal(sortie), commission: new Decimal("0"), swap: new Decimal("0"),
    profit_gross: new Decimal(profit),
    sl_final: opts.sl ? new Decimal(opts.sl) : null,
    sl_at_placement: opts.slPlace ? new Decimal(opts.slPlace) : null,
    exit_reason: opts.raison ?? ExitReason.MANUAL,
  });
}

function deal(n: number, quand: Date, profit: Decimal | string, balance: Decimal | string, ticket = "", symbole = "NDX100"): Deal {
  return new Deal({
    deal_id: `demo-${n}`, time: quand, symbol: ticket ? symbole : "",
    deal_type: ticket ? "sell" : "balance", entry: ticket ? "out" : "in",
    volume: null, price: null, order_id: ticket, commission: new Decimal("0"),
    fee: new Decimal("0"), swap: new Decimal("0"),
    profit: new Decimal(profit), balance: new Decimal(balance),
    comment: ticket ? "" : "Dépôt initial",
  });
}

/** Remplit `store` avec la démonstration. Renvoie l'id de l'idée principale. */
export function seed(store: Store): string {
  // ---- une idée GAGNANTE (cumul de R qui monte puis repasse sous zéro) ----
  const gagnante = store.create_thesis(
    new Thesis({
      instrument: "USDJPY", direction: Direction.SELL, macro_theme: "BoJ / yen",
      catalyst: "Intervention verbale du ministère des Finances",
      macro_note: "Positionnement short yen extrême, risque d'intervention sous-évalué. Exemple fabriqué pour la démonstration.",
      setup: "Range — extrémité", timeframe: "H4",
      technical_note: "Rejet du haut de range à 158.20, mèches répétées.",
      entry_planned: new Decimal("158.00"), stop_initial: new Decimal("158.50"),
      targets: [new Decimal("156.50")], risk_pct: new Decimal("0.5"), conviction: 3,
      thesis_kill_switch: "Un discours de la BoJ confirmant le statu quo.",
      risk_source: RiskSource.COMPUTED,
    }),
    { label: "Short USDJPY — BoJ", account_id: COMPTE, created_at: jours(14, 8) },
  );

  const g1 = position("100000", "0.5", jours(13, 10), "158.00", jours(11, 16), "157.85", "150",
    { sl: "158.50", slPlace: "158.50", symbole: "USDJPY" });
  store.import_report([g1], []);
  store.link(gagnante.id, g1.uid);
  store.complete_review(gagnante.id, new Review({
    entry_in_zone: true, size_conforme: true, stop_at_invalidation: true,
    stop_never_widened: true, exit_per_plan: true, thesis_outcome: ThesisOutcome.CORRECT,
    emotional_state: "Calme.",
    lesson: "Plan suivi de bout en bout. À répliquer, pas juste à célébrer.",
  }));

  // ---- l'idée pyramidée : noyau gagnant, renforcements qui coûtent ----
  const idee = store.create_thesis(
    new Thesis({
      instrument: "NDX100", direction: Direction.SELL, macro_theme: "Fed / taux US",
      catalyst: "CPI américain plus chaud que le consensus",
      macro_note: "Le marché price trois baisses de taux ; l'inflation des services ne ralentit pas. Exemple fabriqué pour la démonstration — remplace-le par ta propre idée.",
      setup: "Cassure de structure", timeframe: "H4",
      technical_note: "Perte du support H4 à 20 150, retour dessous en clôture.",
      entry_planned: new Decimal("20100"), stop_initial: new Decimal("20250"),
      targets: [new Decimal("19600")], risk_pct: new Decimal("0.75"), conviction: 4,
      thesis_kill_switch: "Un discours dovish de la Fed avant la sortie du CPI.",
      risk_source: RiskSource.COMPUTED,
    }),
    { label: "Short NDX100 — CPI", account_id: COMPTE, created_at: jours(9, 8) },
  );

  const t1 = position("100001", "0.5", jours(8, 10), "20100", jours(6, 15), "20060", "200", { sl: "20100", slPlace: "20250" });
  const t2 = position("100002", "0.5", jours(7, 11), "19950", jours(5, 17), "20060", "-550", { sl: "20100", slPlace: "20100" });
  const t3 = position("100003", "0.5", jours(6, 15), "19900", jours(5, 17), "20060", "-800", { sl: "20050", slPlace: "20050" });

  let solde = DEPART;
  const deals: Deal[] = [deal(0, jours(15, 8), "0", solde)];
  solde = solde.plus(g1.pnl_net);
  deals.push(deal(1, g1.close_time, g1.pnl_net, solde, g1.position_id, "USDJPY"));
  [t1, t2, t3].forEach((p, k) => {
    solde = solde.plus(p.pnl_net);
    deals.push(deal(k + 2, p.close_time, p.pnl_net, solde, p.position_id));
  });

  store.import_report([t1, t2, t3], deals);
  for (const p of [t1, t2, t3]) store.link(idee.id, p.uid);
  // Le noyau était au breakeven avant chaque renforcement (sinon : majorant).
  store.set_secured(idee.id, t2.uid, true);
  store.set_secured(idee.id, t3.uid, true);

  store.complete_review(idee.id, new Review({
    entry_in_zone: true, size_conforme: true, stop_at_invalidation: true,
    stop_never_widened: false, exit_per_plan: false, thesis_outcome: ThesisOutcome.WRONG,
    emotional_state: "Agacé après le premier renforcement.",
    lesson: "J'ai renforcé une idée que le marché ne confirmait pas. Le ticket initial gagnait ; les deux adds ont tout repris.",
  }));

  // ---- le trade EN COURS ----
  const vivante = store.create_thesis(
    new Thesis({
      instrument: "XAUUSD", direction: Direction.BUY, macro_theme: "Risk-off géopolitique",
      catalyst: "Tensions au Moyen-Orient",
      macro_note: "Prime de risque sous-évaluée, flux acheteurs sur les ETF or. Exemple fabriqué pour la démonstration.",
      setup: "Retest de zone", timeframe: "H4",
      technical_note: "Retest de l'ancien plafond à 2 380 devenu support.",
      entry_planned: new Decimal("2384"), stop_initial: new Decimal("2362"),
      targets: [new Decimal("2440")], risk_pct: new Decimal("0.5"), conviction: 3,
      thesis_kill_switch: "Un accord de cessez-le-feu confirmé.",
      risk_source: RiskSource.COMPUTED,
    }),
    { label: "Long XAUUSD — risk-off", account_id: COMPTE, created_at: jours(2, 8) },
  );

  store.open_trade(vivante.id, new OpenTrade({
    ticket: "100004", symbol: "XAUUSD", direction: Direction.BUY, volume: new Decimal("0.25"),
    open_price: new Decimal("2384"), open_time: jours(2, 10), account_id: COMPTE,
    stop: new Decimal("2362"), note: "stop placé à l'invalidation H4",
  }));

  return idee.id;
}
