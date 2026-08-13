"""
La démonstration : un journal fabriqué de toutes pièces.

    python seed_demo.py

------------------------------------------------------------------------------
TOUT CE QUI SUIT EST INVENTÉ

Aucun trade réel, aucun numéro de compte réel, aucun rapport de broker. La
version précédente rejouait un vrai rapport MT5 — pratique, mais le jour où on
donne le programme à quelqu'un, cette personne récupère l'historique de trading
de celui qui l'a construit. Un journal de trading est une donnée personnelle :
elle n'a rien à faire dans un exécutable qu'on distribue.

Les chiffres ci-dessous sont donc choisis à la main, pour qu'ils RACONTENT
quelque chose plutôt que pour être vrais :

  - une idée pyramidée dont le ticket initial GAGNE et dont les renforcements
    COÛTENT — c'est le signal le plus cher que produit l'outil ;
  - une review à 3/5 sur une thèse fausse, ce qui range l'idée dans le quadrant
    « erreur » ;
  - un trade ENCORE OUVERT, pour que l'état « en cours » soit visible dès la
    première ouverture ;
  - une série de soldes, pour que le drawdown et la compliance aient de quoi
    calculer.

Ces données vivent dans `data/demo.jsonl` et sont SUPPRIMÉES au premier import
réel (voir core/onboarding.py).
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core import clock, paths
from core.models import (
    Deal, Direction, ExitReason, OpenTrade, Position, Review, RiskSource,
    Thesis, ThesisOutcome,
)
from core.store import Store

# Un compte qui ne peut appartenir à personne.
COMPTE = "DEMO-0001"
DEPART = Decimal("100000")

# 1 lot de NDX100 = 10 $ le point. La valeur est cohérente avec les profits
# ci-dessous, donc l'outil la retrouvera tout seul par rétro-calcul — c'est
# aussi une façon de montrer que rien n'est configuré à la main.
PV = Decimal("10")


def _jours(n: int, heure: int = 9) -> datetime:
    """Il y a n jours ouvrés environ, à heure fixe. Le journal reste « récent »."""
    d = clock.server_now().replace(hour=heure, minute=0, second=0, microsecond=0)
    return d - timedelta(days=n)


def _position(ticket, volume, ouverture, entree, cloture, sortie, profit,
              sl=None, sl_place=None, symbole="NDX100",
              sens=Direction.SELL, raison=ExitReason.MANUAL) -> Position:
    return Position(
        position_id=ticket, account_id=COMPTE, symbol=symbole,
        direction=sens, volume=Decimal(volume),
        open_time=ouverture, open_price=Decimal(entree),
        close_time=cloture, close_price=Decimal(sortie),
        commission=Decimal("0"), swap=Decimal("0"), profit_gross=Decimal(profit),
        sl_final=Decimal(sl) if sl else None,
        sl_at_placement=Decimal(sl_place) if sl_place else None,
        exit_reason=raison,
    )


def _deal(n, quand, profit, balance, ticket="", symbole="NDX100") -> Deal:
    return Deal(
        deal_id=f"demo-{n}", time=quand, symbol=symbole if ticket else "",
        deal_type="sell" if ticket else "balance",
        entry="out" if ticket else "in",
        volume=None, price=None, order_id=ticket,
        commission=Decimal("0"), fee=Decimal("0"), swap=Decimal("0"),
        profit=Decimal(profit), balance=Decimal(balance),
        comment="" if ticket else "Dépôt initial",
    )


def seed(store: Store, verbose: bool = True) -> str:
    """Remplit `store` avec la démonstration. Renvoie l'id de l'idée principale."""
    return _build(store, verbose)


def _build(store: Store, verbose: bool = True) -> str:
    # ------------------------------------------------------ une idée GAGNANTE
    # Elle vient en premier dans le temps, et elle est modeste : le cumul de R
    # monte, puis repasse SOUS zéro avec l'idée suivante. C'est ce qui rend
    # visibles, dès l'ouverture, la courbe bicolore et un calendrier à deux
    # couleurs — sinon la démonstration ne montrerait que la moitié des écrans.
    gagnante = store.create_thesis(
        Thesis(
            instrument="USDJPY",
            direction=Direction.SELL,
            macro_theme="BoJ / yen",
            catalyst="Intervention verbale du ministère des Finances",
            macro_note=("Positionnement short yen extrême, risque d'intervention "
                        "sous-évalué. Exemple fabriqué pour la démonstration."),
            setup="Range — extrémité",
            timeframe="H4",
            technical_note="Rejet du haut de range à 158.20, mèches répétées.",
            entry_planned=Decimal("158.00"),
            stop_initial=Decimal("158.50"),
            targets=[Decimal("156.50")],
            risk_pct=Decimal("0.5"),
            conviction=3,
            thesis_kill_switch="Un discours de la BoJ confirmant le statu quo.",
            risk_source=RiskSource.COMPUTED,
        ),
        label="Short USDJPY — BoJ",
        account_id=COMPTE,
        created_at=_jours(14, heure=8))

    # +0,3 R : volontairement PLUS PETIT que la perte qui suit (-0,51 R), pour
    # que le cumul repasse sous zéro et que la courbe montre ses deux couleurs.
    g1 = _position("100000", "0.5", _jours(13, 10), "158.00",
                   _jours(11, 16), "157.85", "150",
                   sl="158.50", sl_place="158.50",
                   symbole="USDJPY")
    store.import_report([g1], [])
    store.link(gagnante.id, g1.uid)
    store.complete_review(gagnante.id, Review(
        entry_in_zone=True, size_conforme=True, stop_at_invalidation=True,
        stop_never_widened=True, exit_per_plan=True,
        thesis_outcome=ThesisOutcome.CORRECT,
        emotional_state="Calme.",
        lesson="Plan suivi de bout en bout. À répliquer, pas juste à célébrer.",
    ))

    # ---------------------------------------------------------------- l'idée
    # Écrite AVANT le premier ticket : c'est ce qui la rend falsifiable, et la
    # démonstration ne serait pas honnête si elle trichait là-dessus.
    idee = store.create_thesis(
        Thesis(
            instrument="NDX100",
            direction=Direction.SELL,
            macro_theme="Fed / taux US",
            catalyst="CPI américain plus chaud que le consensus",
            macro_note=("Le marché price trois baisses de taux ; l'inflation "
                        "des services ne ralentit pas. Exemple fabriqué pour la "
                        "démonstration — remplace-le par ta propre idée."),
            setup="Cassure de structure",
            timeframe="H4",
            technical_note="Perte du support H4 à 20 150, retour dessous en clôture.",
            entry_planned=Decimal("20100"),
            stop_initial=Decimal("20250"),      # 150 points = 750 $ = 0,75 %
            targets=[Decimal("19600")],
            risk_pct=Decimal("0.75"),
            conviction=4,
            thesis_kill_switch="Un discours dovish de la Fed avant la sortie du CPI.",
            risk_source=RiskSource.COMPUTED,
        ),
        label="Short NDX100 — CPI",
        account_id=COMPTE,
        created_at=_jours(9, heure=8))

    # ------------------------------------------------------------- l'exécution
    # Trois tickets, UNE décision. Le noyau gagne, les deux renforcements
    # coûtent : c'est le chiffre que ni MT5 ni un tableur ne montrent.
    # Les trois tickets ne se ferment pas le même jour : c'est plus fidèle à un
    # dénouement réel, et ça donne au calendrier comme au Sharpe de quoi exister.
    t1 = _position("100001", "0.5", _jours(8, 10), "20100", _jours(6, 15), "20060",
                   "200", sl="20100", sl_place="20250")
    t2 = _position("100002", "0.5", _jours(7, 11), "19950", _jours(5, 17), "20060",
                   "-550", sl="20100", sl_place="20100")
    t3 = _position("100003", "0.5", _jours(6, 15), "19900", _jours(5, 17), "20060",
                   "-800", sl="20050", sl_place="20050")

    solde = DEPART
    deals = [_deal(0, _jours(15, 8), "0", solde)]
    solde += g1.pnl_net
    deals.append(_deal(1, g1.close_time, g1.pnl_net, solde, g1.position_id,
                       symbole="USDJPY"))
    for n, p in enumerate((t1, t2, t3), start=2):
        solde += p.pnl_net
        deals.append(_deal(n, p.close_time, p.pnl_net, solde, p.position_id))

    store.import_report([t1, t2, t3], deals)
    for p in (t1, t2, t3):
        store.link(idee.id, p.uid)
    # Le noyau était au breakeven avant chaque renforcement : sans cette
    # réponse, l'outil n'afficherait qu'un MAJORANT d'exposition.
    store.set_secured(idee.id, t2.uid, True)
    store.set_secured(idee.id, t3.uid, True)

    # ---------------------------------------------------------------- la review
    store.complete_review(idee.id, Review(
        entry_in_zone=True,
        size_conforme=True,
        stop_at_invalidation=True,
        stop_never_widened=False,     # stop remonté puis redescendu sur les adds
        exit_per_plan=False,          # sortie manuelle, avant l'objectif
        thesis_outcome=ThesisOutcome.WRONG,
        emotional_state="Agacé après le premier renforcement.",
        lesson=("J'ai renforcé une idée que le marché ne confirmait pas. "
                "Le ticket initial gagnait ; les deux adds ont tout repris."),
    ))

    # ------------------------------------------------------- le trade en cours
    # Sans lui, l'outil s'ouvrirait sur un journal entièrement passé — alors que
    # l'état « en cours » est le maillon central : une idée qui vit, dont le stop
    # réellement placé est déjà enregistré, et que le prochain import clôturera
    # par son seul numéro de ticket.
    vivante = store.create_thesis(
        Thesis(
            instrument="XAUUSD",
            direction=Direction.BUY,
            macro_theme="Risk-off géopolitique",
            catalyst="Tensions au Moyen-Orient",
            macro_note=("Prime de risque sous-évaluée, flux acheteurs sur les "
                        "ETF or. Exemple fabriqué pour la démonstration."),
            setup="Retest de zone",
            timeframe="H4",
            technical_note="Retest de l'ancien plafond à 2 380 devenu support.",
            entry_planned=Decimal("2384"),
            stop_initial=Decimal("2362"),
            targets=[Decimal("2440")],
            risk_pct=Decimal("0.5"),
            conviction=3,
            thesis_kill_switch="Un accord de cessez-le-feu confirmé.",
            risk_source=RiskSource.COMPUTED,
        ),
        label="Long XAUUSD — risk-off",
        account_id=COMPTE,
        created_at=_jours(2, heure=8))

    store.open_trade(vivante.id, OpenTrade(
        ticket="100004",
        symbol="XAUUSD",
        direction=Direction.BUY,
        volume=Decimal("0.25"),
        open_price=Decimal("2384"),
        open_time=_jours(2, heure=10),
        account_id=COMPTE,
        stop=Decimal("2362"),
        note="stop placé à l'invalidation H4",
    ))

    if not verbose:
        return idee.id

    # ------------------------------------------------------------ vérification
    from core.specs import SpecBook
    ideas, positions, _ = store.load()
    i = ideas[idee.id]
    book = SpecBook(list(positions.values()))

    print()
    print(f"  Idée            : {i.display_name}")
    print(f"  Tickets         : {len(i.positions)} (initial + {len(i.adds)} add)")
    print(f"  Valeur du point : {book.get('NDX100').point_value} "
          f"(rétro-déduite, aucune table)")
    print(f"  Risque engagé   : {i.risk_realized(book):.2f} $")
    print(f"  Exposition max  : {i.max_concurrent_risk(book):.2f} $ "
          f"({'mesurée' if i.exposure_is_measured() else 'majorant'})")
    print(f"  P&L net         : {i.pnl_net:+.2f} $")
    print(f"  R               : {i.r_multiple(book):+.2f} R")
    print(f"  Discipline      : {i.discipline_score}/5  → {i.quadrant.value}")
    print()
    print(f"  Ticket initial  : {i.pnl_initial:+.2f} $")
    print(f"  Renforcements   : {i.pnl_adds:+.2f} $   <- le chiffre qui pique")
    print()
    v = ideas[vivante.id]
    print(f"  Trade en cours  : {v.display_name} · ticket "
          f"{v.open_trades[0].ticket} (statut « {v.status.value} »)")
    print( "  Dépose un export contenant ce ticket : il sera clôturé tout seul.")
    print()
    print("  Tout ceci est INVENTÉ : compte fictif, tickets fictifs.")
    print(f"  Journal de démonstration : {store.path}")
    print()
    print("Lance :  streamlit run app/main.py")
    return idee.id


def main():
    store = Store(paths.journal_path(demo=True), demo=True)
    if store.events():
        print("Le journal de démonstration existe déjà. Rien à faire.")
        print(f"Pour le refaire : supprime {store.path}")
        return
    _build(store, verbose=True)


if __name__ == "__main__":
    main()
