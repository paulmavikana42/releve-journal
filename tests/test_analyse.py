"""
L'unité d'analyse, et ce qui en découle.

Le piège que ces tests verrouillent : **compter une thèse macro autant de fois
qu'elle a de jambes**. Un « dollar fort » joué en short EURUSD, long USDJPY et
short XAUUSD est UN pari. Compté trois fois, il triple l'échantillon, fait
passer une conviction pour trois confirmations, et gonfle la confiance qu'on
accorde à des chiffres qui n'ont pas grandi.
"""
from datetime import date, datetime
from decimal import Decimal

import pytest

from core import metrics as M
from core.models import (
    Campaign, Direction, Idea, Position, Quadrant, Review, RiskSource, Thesis,
    ThesisOutcome,
)

EQUITY = Decimal("100000")


def _idee(symbole, pnl, jour, campagne=None, score=None, risque="1000"):
    """Une idée clôturée dont le R vaut pnl / risque."""
    t = Thesis(instrument=symbole, direction=Direction.SELL,
               entry_planned=Decimal("100"),
               stop_initial=Decimal("100") + Decimal(risque) / Decimal("10"),
               risk_pct=Decimal("1"), risk_source=RiskSource.COMPUTED)
    i = Idea(thesis=t, campaign_id=campagne)
    i.positions = [Position(
        position_id=f"{symbole}{jour}", account_id="A", symbol=symbole,
        direction=Direction.SELL, volume=Decimal("1"),
        open_time=datetime(2026, 7, jour, 9, 0), open_price=Decimal("100"),
        close_time=datetime(2026, 7, jour, 17, 0),
        close_price=Decimal("100") - Decimal(pnl) / Decimal("10"),
        commission=Decimal("0"), swap=Decimal("0"),
        profit_gross=Decimal(pnl))]
    if score is not None:
        i.review = Review(*([True] * score + [False] * (5 - score)),
                          thesis_outcome=ThesisOutcome.CORRECT)
    return i


# ------------------------------------------------------- l'unité d'analyse

def test_par_defaut_une_these_compte_pour_une_seule_decision():
    camp = Campaign(id="c1", name="Dollar fort")
    ideas = [_idee("EURUSD", "1000", 6, "c1"),
             _idee("USDJPY", "-500", 7, "c1"),
             _idee("XAUUSD", "500", 8)]        # autonome

    rows = M.analysis_rows(ideas, {"c1": camp}, M.Unit.THESIS)
    assert len(rows) == 2, "trois idées, mais DEUX décisions"
    these = next(l for l in rows if l.is_campaign)
    assert these.n_ideas == 2
    assert these.pnl == 500.0
    assert these.r == pytest.approx(0.5)       # +1 R et -0.5 R


def test_le_mode_par_idee_compte_chaque_jambe():
    camp = Campaign(id="c1", name="Dollar fort")
    ideas = [_idee("EURUSD", "1000", 6, "c1"),
             _idee("USDJPY", "-500", 7, "c1"),
             _idee("XAUUSD", "500", 8)]

    rows = M.analysis_rows(ideas, {"c1": camp}, M.Unit.IDEA)
    assert len(rows) == 3
    assert all(not l.is_campaign for l in rows)


def test_le_mode_change_l_echantillon_donc_la_confiance():
    """
    La conséquence concrète, et c'est tout l'enjeu : le même historique donne
    n=2 ou n=3. Un outil qui affiche n=3 pour un seul pari ment sur la solidité
    de ses propres chiffres.
    """
    camp = Campaign(id="c1", name="Dollar fort")
    ideas = [_idee("EURUSD", "1000", 6, "c1"), _idee("USDJPY", "-500", 7, "c1"),
             _idee("XAUUSD", "500", 8)]

    par_these = M.expectancy_of(M.analysis_rows(ideas, {"c1": camp}, M.Unit.THESIS))
    par_idee = M.expectancy_of(M.analysis_rows(ideas, {"c1": camp}, M.Unit.IDEA))
    assert par_these.n == 2 and par_idee.n == 3


def test_une_these_dont_une_jambe_n_a_pas_de_R_n_a_pas_de_R():
    """Une somme partielle serait pire qu'une absence : elle aurait l'air vraie."""
    camp = Campaign(id="c1", name="Dollar fort")
    sans_r = _idee("USDJPY", "-500", 7, "c1")
    sans_r.thesis.stop_initial = None          # R non calculable
    rows = M.analysis_rows([_idee("EURUSD", "1000", 6, "c1"), sans_r],
                           {"c1": camp}, M.Unit.THESIS)
    assert rows[0].r is None
    assert rows[0].pnl == 500.0, "le P&L, lui, reste connu"


def test_une_these_abandonnee_ne_regroupe_plus_rien():
    camp = Campaign(id="c1", name="Abandonnée", abandoned=True)
    rows = M.analysis_rows([_idee("EURUSD", "1000", 6, "c1")],
                           {"c1": camp}, M.Unit.THESIS)
    assert len(rows) == 1 and not rows[0].is_campaign


# ---------------------------------------------------------- les métriques

def test_gain_moyen_et_perte_moyenne():
    ideas = [_idee("EURUSD", "1000", 6), _idee("USDJPY", "2000", 7),
             _idee("XAUUSD", "-500", 8)]
    exp = M.expectancy_of(M.analysis_rows(ideas, {}, M.Unit.IDEA))
    assert exp.avg_win_r == pytest.approx(1.5)     # (+1 R et +2 R) / 2
    assert exp.avg_loss_r == pytest.approx(-0.5)


def test_les_resultats_en_pourcentage_du_compte():
    """Quand le R ne suffit pas : ce que ça a fait AU COMPTE."""
    rows = M.analysis_rows([_idee("EURUSD", "1000", 6)], {}, M.Unit.IDEA)
    assert M.pct_results(rows, EQUITY) == [pytest.approx(1.0)]


def test_sharpe_calculable_sans_les_soldes_du_broker():
    """
    Un CSV sans colonne « solde » ne doit pas priver l'écran de Sharpe : on
    reconstitue les rendements depuis les clôtures, et on le dit.
    """
    ideas = [_idee("EURUSD", "1000", j) for j in range(6, 16)]
    rows = M.analysis_rows(ideas, {}, M.Unit.IDEA)
    rets = M.daily_returns_from_rows(rows, EQUITY)
    assert len(rets) == 10
    assert M.sharpe(rets) is not None


def test_le_pnl_par_jour_ne_compte_que_les_cloture():
    ideas = [_idee("EURUSD", "1000", 6), _idee("USDJPY", "-400", 6),
             _idee("XAUUSD", "500", 9)]
    par_jour = M.daily_pnl(M.analysis_rows(ideas, {}, M.Unit.IDEA))
    assert par_jour == {date(2026, 7, 6): 600.0, date(2026, 7, 9): 500.0}
    assert date(2026, 7, 7) not in par_jour, (
        "un jour sans clôture n'est pas un jour à zéro")


# ------------------------------------------------ la matrice décision × résultat

def test_la_matrice_chiffre_ce_que_chaque_case_coute():
    """Un simple compte ne dit pas si trois « erreurs » ont coûté 200 $ ou 12 000 $."""
    ideas = [_idee("EURUSD", "1000", 6, score=5),     # gain + bon process
             _idee("USDJPY", "-3000", 7, score=2)]    # perte + mauvais process
    dm = M.decision_matrix(ideas, {}, M.Unit.IDEA, None, EQUITY)

    erreur = dm.get(Quadrant.ERROR)
    assert erreur.n == 1
    assert erreur.pnl == -3000.0
    assert erreur.pct == pytest.approx(-3.0)
    assert dm.get(Quadrant.MASTERY).n == 1


def test_une_these_a_moitie_relue_n_est_pas_jugee():
    """Un process « à moitié jugé » n'est pas un process jugé."""
    camp = Campaign(id="c1", name="Dollar fort")
    ideas = [_idee("EURUSD", "1000", 6, "c1", score=5),
             _idee("USDJPY", "-500", 7, "c1")]         # pas de review
    dm = M.decision_matrix(ideas, {"c1": camp}, M.Unit.THESIS, None, EQUITY)
    assert dm.n_reviewed == 0 and dm.n_pending == 1


def test_sans_capital_de_reference_le_pourcentage_est_absent_pas_nul():
    ideas = [_idee("EURUSD", "1000", 6, score=5)]
    dm = M.decision_matrix(ideas, {}, M.Unit.IDEA, None, None)
    assert dm.get(Quadrant.MASTERY).pct is None, (
        "un 0 % se lirait « ça n'a rien coûté »")


# ------------------------------------ deux trades ≠ un trade et son renfort

def _ticket(pid, ouvert, ferme, symbole="UKOUSD", sens=Direction.BUY,
            pnl="0", volume="1"):
    return Position(
        position_id=pid, account_id="A", symbol=symbole, direction=sens,
        volume=Decimal(volume), open_time=ouvert, open_price=Decimal("93.9"),
        close_time=ferme, close_price=Decimal("94.0"),
        commission=Decimal("0"), swap=Decimal("0"), profit_gross=Decimal(pnl))


def test_un_ticket_ouvert_apres_la_cloture_n_est_pas_un_renforcement():
    """
    LE cas réel qui a rendu ce test nécessaire.

    Un trade ouvert le jeudi et clôturé au breakeven le vendredi matin ; un
    autre ouvert le vendredi après-midi, sur le même instrument. Le second était
    proposé — et rattaché — comme « renforcement » du premier. Les deux paris
    additionnaient alors leurs risques, le R devenait faux, et la conviction
    déclarée sur la seconde idée disparaissait au profit de la première.

    Le critère est objectif : un renforcement s'ouvre PENDANT que l'idée vit.
    """
    from core import matcher

    idee = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY,
                              conviction=5))
    idee.positions = [_ticket("254724773",
                              datetime(2026, 7, 23, 8, 42),
                              datetime(2026, 7, 24, 11, 49))]

    # ouvert 1 h 46 APRÈS la clôture du précédent
    nouveau = _ticket("255138642",
                      datetime(2026, 7, 24, 13, 35),
                      datetime(2026, 7, 24, 18, 12))

    assert matcher.candidates(nouveau, [idee]) == [], (
        "une idée dont tous les tickets sont clos ne doit plus rien recevoir")


def test_un_vrai_renforcement_reste_proposé():
    """La contrepartie : un ticket qui chevauche est bien un renforcement."""
    from core import matcher

    idee = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY))
    idee.positions = [_ticket("1", datetime(2026, 7, 23, 8, 42),
                              datetime(2026, 7, 24, 18, 0))]
    renfort = _ticket("2", datetime(2026, 7, 23, 15, 0),
                      datetime(2026, 7, 24, 18, 0))

    cands = matcher.candidates(renfort, [idee])
    assert cands and cands[0].is_add


def test_le_ticket_mal_rattache_est_signale():
    """
    Pour les journaux où le mauvais rattachement a DÉJÀ eu lieu : l'idée le
    dit, au lieu de calculer un R faux en silence.
    """
    idee = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY))
    idee.positions = [
        _ticket("254724773", datetime(2026, 7, 23, 8, 42),
                datetime(2026, 7, 24, 11, 49), pnl="12.73"),
        _ticket("255138642", datetime(2026, 7, 24, 13, 35),
                datetime(2026, 7, 24, 18, 12), pnl="-1218.47"),
    ]
    fautifs = idee.tickets_disjoints
    assert [p.position_id for p in fautifs] == ["255138642"]


def test_un_pyramidage_normal_ne_declenche_aucune_alerte():
    idee = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY))
    idee.positions = [
        _ticket("1", datetime(2026, 7, 23, 8, 0), datetime(2026, 7, 25, 18, 0)),
        _ticket("2", datetime(2026, 7, 23, 15, 0), datetime(2026, 7, 25, 18, 0)),
        _ticket("3", datetime(2026, 7, 24, 9, 0), datetime(2026, 7, 25, 18, 0)),
    ]
    assert idee.tickets_disjoints == []


# ------------------------------------------------------ les sorties partielles

def test_le_calendrier_date_chaque_sortie_a_son_jour():
    """
    Une sortie en deux fois : la moitié tombe le jour de la sortie partielle,
    le solde le jour de la clôture totale. Ranger tout sur le second jour
    effacerait ce qui est réellement tombé sur le compte le premier — et c'est
    ce jour-là que la prop firm a regardé.
    """
    idee = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY))
    idee.positions = [
        _ticket("1a", datetime(2026, 7, 20, 9, 0),
                datetime(2026, 7, 21, 15, 0), pnl="300"),   # sortie partielle
        _ticket("1b", datetime(2026, 7, 20, 9, 0),
                datetime(2026, 7, 23, 17, 0), pnl="-100"),  # le solde
    ]
    par_jour = M.daily_pnl_by_ticket([idee])
    assert par_jour == {date(2026, 7, 21): 300.0, date(2026, 7, 23): -100.0}


def test_la_sortie_finale_ne_porte_que_le_reste():
    """
    Ce que demande le calendrier : le jour de la sortie partielle porte ce qui
    est sorti ce jour-là ; le jour de la clôture finale porte le RESTE — le
    résultat de la position moins ce qui en était déjà sorti.

    Les transactions du broker le donnent directement : chaque sortie y figure
    avec sa date et son montant. Aucune estimation, deux chiffres du broker.
    """
    from core.models import Deal

    def sortie(jour, profit):
        return Deal(deal_id=f"d{jour}", time=datetime(2026, 7, jour, 17),
                    symbol="UKOUSD", deal_type="sell", entry="out",
                    volume=Decimal("0.5"), price=Decimal("94"), order_id="1",
                    commission=Decimal("0"), fee=Decimal("0"), swap=Decimal("0"),
                    profit=Decimal(profit), balance=Decimal("100000"))

    idee = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY))
    idee.positions = [_ticket("1", datetime(2026, 7, 20, 9, 0),
                              datetime(2026, 7, 23, 17, 0), pnl="200")]

    # position à +200 au total, dont +300 déjà sortis le 21 -> le 23 porte -100
    par_jour = M.daily_pnl_realise([idee], [sortie(21, "300"), sortie(23, "-100")])
    assert par_jour == {date(2026, 7, 21): 300.0, date(2026, 7, 23): -100.0}
    assert sum(par_jour.values()) == 200.0, "le total reste celui de la position"


def test_sans_transactions_le_calendrier_retombe_sur_les_tickets():
    """L'information n'existe pas : on ne l'invente pas."""
    idee = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY))
    idee.positions = [_ticket("1", datetime(2026, 7, 20, 9, 0),
                              datetime(2026, 7, 23, 17, 0), pnl="200")]
    assert M.daily_pnl_realise([idee], []) == {date(2026, 7, 23): 200.0}


def test_les_metriques_restent_agregees_a_l_idee():
    """
    Le calendrier découpe, les statistiques non : deux sorties sur un même
    trade restent UNE décision, sinon le taux de réussite compterait deux fois
    le même pari.
    """
    idee = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY,
                              entry_planned=Decimal("93.9"),
                              stop_initial=Decimal("92.9"),
                              risk_source=RiskSource.COMPUTED))
    idee.positions = [
        _ticket("1a", datetime(2026, 7, 20, 9, 0),
                datetime(2026, 7, 21, 15, 0), pnl="300"),
        _ticket("1b", datetime(2026, 7, 20, 9, 0),
                datetime(2026, 7, 23, 17, 0), pnl="-100"),
    ]
    rows = M.analysis_rows([idee], {}, M.Unit.IDEA)
    assert len(rows) == 1
    assert rows[0].pnl == 200.0
    assert rows[0].closed_at == date(2026, 7, 23), "l'idée appartient à sa clôture totale"


def test_le_prix_d_entree_departage_deux_idees_jumelles():
    """
    Le cas réel : deux idées UKOUSD long, écrites le même soir, à quelques
    minutes d'écart. Les scores temporels sont quasi identiques — c'est le PRIX
    VISÉ qui tranche, parce qu'il est écrit noir sur blanc dans chaque idée.
    """
    from core import matcher

    a = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY,
                           entry_planned=Decimal("93.917"),
                           stop_initial=Decimal("92.502"), conviction=5))
    a.created_at = datetime(2026, 7, 26, 19, 16)
    b = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY,
                           entry_planned=Decimal("94.828"),
                           stop_initial=Decimal("93.258"), conviction=3))
    b.created_at = datetime(2026, 7, 26, 20, 13)

    t1 = _ticket("254724773", datetime(2026, 7, 23, 8, 42),
                 datetime(2026, 7, 24, 11, 49))
    t1 = Position(**{**t1.__dict__, "open_price": Decimal("93.913")})
    t2 = _ticket("255138642", datetime(2026, 7, 24, 13, 35),
                 datetime(2026, 7, 24, 18, 12))
    t2 = Position(**{**t2.__dict__, "open_price": Decimal("94.828")})

    assert matcher.candidates(t1, [a, b])[0].idea is a
    assert matcher.candidates(t2, [a, b])[0].idea is b


def test_le_ticket_declare_tranche_avant_tout_le_reste():
    """
    Deux idées jumelles, MÊME prix d'entrée visé : le prix ne départage plus
    rien. Mais si l'une porte le numéro de ticket déclaré à l'ouverture, c'est
    un fait — pas une ressemblance. Elle est la seule proposée.
    """
    from core import matcher
    from core.models import OpenTrade

    a = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY,
                           entry_planned=Decimal("94.0"),
                           stop_initial=Decimal("93.0"), conviction=5))
    a.created_at = datetime(2026, 7, 26, 19, 16)
    b = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY,
                           entry_planned=Decimal("94.0"),
                           stop_initial=Decimal("93.0"), conviction=3))
    b.created_at = datetime(2026, 7, 26, 20, 13)
    b.open_trades = [OpenTrade(ticket="255138642", symbol="UKOUSD",
                               direction=Direction.BUY, volume=Decimal("1"),
                               open_time=datetime(2026, 7, 24, 13, 35),
                               open_price=Decimal("94.0"))]

    t = _ticket("255138642", datetime(2026, 7, 24, 13, 35),
                datetime(2026, 7, 24, 18, 12))
    t = Position(**{**t.__dict__, "open_price": Decimal("94.0")})

    props = matcher.candidates(t, [a, b])
    assert len(props) == 1 and props[0].idea is b
    assert "déclaré" in props[0].reason


def test_une_entree_loin_du_prix_vise_reste_proposee():
    """Indice de classement, jamais d'élimination : entrer loin de son prix
    visé est une exécution valable — et souvent la plus instructive."""
    from core import matcher

    idee = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY,
                              entry_planned=Decimal("90.0"),
                              stop_initial=Decimal("89.0")))
    idee.created_at = datetime(2026, 7, 20, 8, 0)
    t = _ticket("1", datetime(2026, 7, 21, 9, 0), datetime(2026, 7, 22, 9, 0))
    assert matcher.candidates(t, [idee])


# ---------------------------------------------- le stop quand le CSV n'en a pas

def test_le_noyau_sans_stop_prend_celui_de_l_idee_mais_pas_l_add():
    """
    La frontière, et elle est nette.

    NOYAU : un ordre au marché sort de l'export sans SL ; le stop de l'idée est
    la bonne réponse, il a été écrit avant d'entrer.

    RENFORCEMENT : il peut avoir été pris avec un stop PLUS SERRÉ que le noyau.
    Lui faire hériter du stop de l'idée surestimerait son risque et
    sous-estimerait le R — en silence. L'outil préfère ne rien savoir et le
    demander.
    """
    idee = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY,
                              entry_planned=Decimal("93.9"),
                              stop_initial=Decimal("92.9"),
                              risk_source=RiskSource.COMPUTED))
    noyau = _ticket("1", datetime(2026, 7, 20, 9, 0), datetime(2026, 7, 25, 18, 0))
    add = _ticket("2", datetime(2026, 7, 21, 9, 0), datetime(2026, 7, 25, 18, 0))
    idee.positions = [noyau, add]

    assert idee.stop_for(noyau)[0] == Decimal("92.9")
    assert idee.stop_for(add)[0] is None
    assert [p.position_id for p in idee.tickets_needing_stop()] == ["2"]

    # une fois saisi, tout redevient calculable
    idee.manual_stops[add.uid] = Decimal("93.4")
    assert idee.tickets_needing_stop() == []
    assert idee.stop_for(add)[0] == Decimal("93.4")


def test_le_stop_de_l_idee_reste_prioritaire_sur_le_ticket_initial():
    """
    Le garde-fou qui NE bouge pas : le broker n'archive que le dernier stop.
    Sur un trade passé au breakeven, ce stop vaut quelques points et produirait
    un R absurde. Sur le ticket initial, l'idée gagne toujours.
    """
    idee = Idea(thesis=Thesis(instrument="UKOUSD", direction=Direction.BUY,
                              entry_planned=Decimal("93.9"),
                              stop_initial=Decimal("92.9"),
                              risk_source=RiskSource.COMPUTED))
    p = _ticket("1", datetime(2026, 7, 20, 9, 0), datetime(2026, 7, 25, 18, 0))
    # le broker a archivé un stop collé à l'entrée (breakeven)
    p = Position(**{**p.__dict__, "sl_final": Decimal("93.89"),
                    "sl_at_placement": Decimal("93.89")})
    idee.positions = [p]
    assert idee.stop_for(p)[0] == Decimal("92.9")


# ------------------------------------------------------- la courbe bicolore

def test_la_courbe_change_de_couleur_au_croisement_exact():
    """
    Sans point de croisement calculé, la couleur ne changerait qu'au trade
    SUIVANT : l'œil daterait le passage en négatif d'un trade trop tard.
    """
    from app.views.dashboard import _couper_a_zero

    xs = [0, 1, 2]
    ys = [1.0, -1.0, -2.0]
    px, hauts, bas = _couper_a_zero(xs, ys)

    assert 1.5 not in px
    assert 0.5 in px, "le zéro est traversé à mi-chemin du premier segment"
    i = px.index(0.5)
    assert hauts[i] == 0.0 and bas[i] == 0.0, "les deux séries se relaient à zéro"
    assert hauts[0] == 1.0 and bas[0] is None
    assert hauts[-1] is None and bas[-1] == -2.0
