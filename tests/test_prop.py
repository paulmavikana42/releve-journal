"""
Compliance prop firm.

Ces règles sont CONTRACTUELLES : une erreur ici ne produit pas un chiffre
approximatif, elle produit un compte perdu. Les cas testés sont ceux qui se
trompent silencieusement — la base de calcul de la perte du jour, le mode de
drawdown, et la position oubliée un vendredi soir.
"""
from datetime import date, datetime
from decimal import Decimal

import pytest

from core import prop as P
from core.models import (
    Deal, Direction, Idea, IdeaStatus, OpenTrade, Position, Thesis,
)

REGLES = P.PropRules(account_id="14124899", start_balance=Decimal("100000"),
                     daily_loss_pct=Decimal("5"), max_drawdown_pct=Decimal("10"))


def _idee(pnl: str, jour: int, symbol="BTCUSD") -> Idea:
    i = Idea(thesis=Thesis(instrument=symbol, direction=Direction.SELL))
    i.positions = [Position(
        position_id=f"P{jour}", account_id="14124899", symbol=symbol,
        direction=Direction.SELL, volume=Decimal("1"),
        open_time=datetime(2026, 7, jour, 9, 0), open_price=Decimal("60000"),
        close_time=datetime(2026, 7, jour, 18, 0), close_price=Decimal("59000"),
        commission=Decimal("0"), swap=Decimal("0"), profit_gross=Decimal(pnl))]
    return i


def _idee_ouverte(symbol="UKOUSD") -> Idea:
    i = Idea(thesis=Thesis(instrument=symbol, direction=Direction.BUY))
    i.open_trades = [OpenTrade(
        ticket="88210912", symbol=symbol, direction=Direction.BUY,
        volume=Decimal("1"), open_time=datetime(2026, 7, 24, 10, 0),
        open_price=Decimal("71.40"), account_id="14124899")]
    return i


# ------------------------------------------------------------------ la courbe

def test_sans_soldes_du_broker_la_courbe_est_reconstituee_et_le_dit():
    eq = P.equity_series(REGLES, [_idee("500", 6), _idee("-200", 7)])
    assert not eq.measured
    assert eq.last == Decimal("100300")


def test_avec_les_soldes_du_broker_la_courbe_est_mesuree():
    deals = [Deal(deal_id="1", time=datetime(2026, 7, 6, 18, 0), symbol="BTCUSD",
                  deal_type="sell", entry="out", volume=Decimal("1"),
                  price=Decimal("59000"), order_id="1", commission=Decimal(0),
                  fee=Decimal(0), swap=Decimal(0), profit=Decimal("500"),
                  balance=Decimal("100500"))]
    eq = P.equity_series(REGLES, [_idee("500", 6)], deals)
    assert eq.measured
    assert eq.last == Decimal("100500")


# --------------------------------------------------- la perte journalière

def test_la_perte_du_jour_se_mesure_sur_la_base_du_JOUR():
    """
    Le piège qui coûte un challenge. Une perte de 4 000 $ sur un compte tombé à
    95 000 $ fait 4,21 %, pas 4,00 %. C'est ce 0,21 % qui fait la différence
    entre « il me reste de la marge » et « je viens de sauter ».
    """
    ideas = [_idee("-5000", 6), _idee("-4000", 7)]
    c = P.evaluate(REGLES, ideas, today=date(2026, 7, 7),
                   now=datetime(2026, 7, 7, 20, 0))
    assert float(c.daily_pct) == pytest.approx(-4.21, abs=0.01)
    assert not c.checks[0].breached      # 4.21 % < 5 %


def test_la_limite_journaliere_franchie_est_un_breach():
    ideas = [_idee("-5100", 7)]
    c = P.evaluate(REGLES, ideas, today=date(2026, 7, 7),
                   now=datetime(2026, 7, 7, 20, 0))
    daily = next(ch for ch in c.checks if ch.key == "daily")
    assert daily.breached
    assert c.tone == "loss"


def test_un_gain_ne_declenche_jamais_la_regle_de_perte():
    c = P.evaluate(REGLES, [_idee("3000", 7)], today=date(2026, 7, 7),
                   now=datetime(2026, 7, 7, 20, 0))
    daily = next(ch for ch in c.checks if ch.key == "daily")
    assert daily.ok and not daily.breached


# ---------------------------------------------------------------- drawdown

def test_le_drawdown_statique_ne_bouge_jamais_de_base():
    """
    FundedNext : plancher à 90 000 $, quoi qu'il arrive ensuite. Un compte monté
    à 120 000 $ garde le MÊME plancher — le croire trailing, c'est se croire à
    30 000 $ du gouffre quand on est à 30 000 $... du plafond.
    """
    ideas = [_idee("20000", 6), _idee("-5000", 7)]
    c = P.evaluate(REGLES, ideas, today=date(2026, 7, 8),
                   now=datetime(2026, 7, 8, 12, 0))
    assert c.floor == Decimal("90000")
    assert c.margin_to_floor == Decimal("25000")
    assert c.drawdown_pct == 0          # jamais passé sous 100 000


def test_le_drawdown_trailing_suit_le_plus_haut():
    regles = P.PropRules(start_balance=Decimal("100000"),
                         max_drawdown_pct=Decimal("10"), drawdown_static=False)
    ideas = [_idee("20000", 6), _idee("-5000", 7)]
    c = P.evaluate(regles, ideas, today=date(2026, 7, 8),
                   now=datetime(2026, 7, 8, 12, 0))
    assert c.floor == Decimal("108000")          # 90 % du plus-haut (120 000)
    assert c.margin_to_floor == Decimal("7000")  # bien moins confortable


def test_un_compte_jamais_en_perte_a_un_drawdown_nul_pas_negatif():
    c = P.evaluate(REGLES, [_idee("500", 6)], today=date(2026, 7, 7),
                   now=datetime(2026, 7, 7, 12, 0))
    dd = next(ch for ch in c.checks if ch.key == "drawdown")
    assert c.drawdown_pct == 0
    assert dd.value == "0.00 %", "un « -−0.00 % » à l'écran est une régression"


# ------------------------------------------------------------------ week-end
# La règle « position le week-end » a été retirée : plus aucun check `weekend`.

def test_plus_de_regle_week_end():
    c = P.evaluate(REGLES, [_idee_ouverte()], today=date(2026, 7, 25),
                   now=datetime(2026, 7, 25, 12, 0))     # 25/07/2026 = samedi
    assert not any(ch.key == "weekend" for ch in c.checks)


# ---------------------------------------------------------------- cohérence

def test_la_regle_de_coherence_mesure_le_poids_du_meilleur_jour():
    ideas = [_idee("1000", 6), _idee("1000", 7), _idee("8000", 8)]
    c = P.evaluate(REGLES, ideas, today=date(2026, 7, 9),
                   now=datetime(2026, 7, 9, 12, 0))
    coh = next(ch for ch in c.checks if ch.key == "consistency")
    assert float(c.best_day_share) == pytest.approx(80.0)
    assert not coh.ok
    assert not coh.breached, "aucune firme ne coupe le compte pour ça — elle bloque le retrait"


def test_les_jours_de_trading_se_comptent_sur_les_clotures():
    ideas = [_idee("100", 6), _idee("100", 6), _idee("100", 7)]
    c = P.evaluate(REGLES, ideas, today=date(2026, 7, 8),
                   now=datetime(2026, 7, 8, 12, 0))
    assert c.trading_days == 2
    jours = next(ch for ch in c.checks if ch.key == "days")
    assert not jours.ok          # 2 < 3 requis


# ---------------------------------------------- type de challenge, phase, devise

def test_le_symbole_de_devise_suit_le_compte():
    assert P.PropRules(currency="EUR").symbol == "€"
    assert P.PropRules(currency="GBP").symbol == "£"
    assert P.PropRules(currency="USD").symbol == "$"


def test_l_objectif_est_celui_de_la_phase_courante():
    r = P.PropRules(challenge_type="two_phase", phase="p1",
                    profit_target_pct=Decimal("8"),
                    profit_target_p2_pct=Decimal("5"))
    assert r.active_profit_target() == Decimal("8")
    r.phase = "p2"
    assert r.active_profit_target() == Decimal("5")


def test_instant_funding_et_finance_nont_aucun_objectif():
    assert P.PropRules(challenge_type="instant").active_profit_target() is None
    assert P.PropRules(challenge_type="instant").is_funded
    assert P.PropRules(phase="funded").active_profit_target() is None
    # → l'écran de compliance n'affiche alors PAS de check « objectif »
    c = P.evaluate(P.PropRules(account_id="X", challenge_type="instant"),
                   [_idee("500", 6)], today=date(2026, 7, 6),
                   now=datetime(2026, 7, 6, 18, 0))
    assert not any(ch.key == "target" for ch in c.checks)


def test_les_nouveaux_champs_font_l_aller_retour_json():
    r = P.PropRules(account_id="A", currency="GBP", challenge_type="two_phase",
                    phase="p2", profit_split_pct=Decimal("90"),
                    trading_day_rule="gain", trading_day_threshold_pct=Decimal("0.5"),
                    min_days_scope="always")
    assert P.PropRules.from_dict(r.to_dict()) == r


# ----------------------------------------------- compliance adaptée au type/phase

def test_la_marge_avant_plancher_ne_descend_jamais_sous_zero():
    r = P.PropRules(account_id="Z", start_balance=Decimal("100000"),
                    max_drawdown_pct=Decimal("10"))          # plancher 90 000
    c = P.evaluate(r, [_idee("-15000", 6)], today=date(2026, 7, 6),
                   now=datetime(2026, 7, 6, 18, 0))          # 85 000 < plancher
    assert c.margin_to_floor == Decimal("0")


def test_la_limite_du_jour_sindexe_sur_le_drawdown_restant():
    # marge avant plancher (1 000) plus petite que la limite du jour (5 000)
    r = P.PropRules(account_id="Z", start_balance=Decimal("100000"),
                    daily_loss_pct=Decimal("5"), max_drawdown_pct=Decimal("10"))
    c = P.evaluate(r, [_idee("-9000", 6)], today=date(2026, 7, 6),
                   now=datetime(2026, 7, 6, 18, 0))
    assert c.daily_allow_amount == Decimal("1000")   # borné par le plancher


def test_un_compte_finance_affiche_le_payout_indexe_du_split():
    r = P.PropRules(account_id="F", start_balance=Decimal("100000"),
                    challenge_type="instant", profit_split_pct=Decimal("80"))
    c = P.evaluate(r, [_idee("5000", 6)], today=date(2026, 7, 6),
                   now=datetime(2026, 7, 6, 18, 0))
    assert c.payout_amount == Decimal("4000")        # 5 000 × 80 %
    assert not any(ch.key == "target" for ch in c.checks)


def test_en_perte_le_finance_voit_son_gain_negatif_sans_split():
    r = P.PropRules(account_id="F", challenge_type="instant",
                    profit_split_pct=Decimal("80"))
    c = P.evaluate(r, [_idee("-2000", 6)], today=date(2026, 7, 6),
                   now=datetime(2026, 7, 6, 18, 0))
    assert c.payout_amount == Decimal("-2000")       # pas de split sur une perte


def test_un_jour_ne_compte_que_sil_atteint_le_seuil_de_gain():
    r = P.PropRules(account_id="D", start_balance=Decimal("100000"),
                    min_trading_days=2, trading_day_rule="gain",
                    trading_day_threshold_pct=Decimal("0.5"))   # ≥ 500 $
    c = P.evaluate(r, [_idee("600", 6), _idee("100", 7)], today=date(2026, 7, 8),
                   now=datetime(2026, 7, 8, 12, 0))
    assert c.trading_days == 1                        # seul le jour à +600 compte


def test_les_jours_de_trading_sont_plafonnes_a_la_cible():
    r = P.PropRules(account_id="D", start_balance=Decimal("100000"),
                    min_trading_days=2)
    c = P.evaluate(r, [_idee("100", 6), _idee("100", 7), _idee("100", 8)],
                   today=date(2026, 7, 9), now=datetime(2026, 7, 9, 12, 0))
    days = next(ch for ch in c.checks if ch.key == "days")
    assert days.value.startswith("2 / 2")            # plafonné, jamais 3/2


def test_un_compte_sans_limite_journaliere_ne_breach_jamais_dessus():
    # futures intraday (type Apex) : pas de limite du jour, seul le plancher borne
    r = P.PropRules(account_id="AP", start_balance=Decimal("100000"),
                    daily_loss_pct=Decimal("0"), max_drawdown_pct=Decimal("10"))
    c = P.evaluate(r, [_idee("-4000", 6)], today=date(2026, 7, 6),
                   now=datetime(2026, 7, 6, 18, 0))
    daily = next(ch for ch in c.checks if ch.key == "daily")
    assert not daily.breached and daily.value == "aucune limite"
    assert c.daily_allow_amount == c.margin_to_floor   # bornée par le plancher seul


def test_chaque_scenario_de_phase_ajuste_la_compliance():
    def _target(r):
        c = P.evaluate(r, [_idee("3000", 6)], today=date(2026, 7, 6),
                       now=datetime(2026, 7, 6, 18, 0))
        return next((ch for ch in c.checks if ch.key == "target"), None), c

    # 2 phases · phase 1 → objectif = P1 (+8)
    r = P.PropRules(account_id="X", challenge_type="two_phase", phase="p1",
                    profit_target_pct=Decimal("8"), profit_target_p2_pct=Decimal("5"))
    t, _ = _target(r)
    assert t is not None and "+8" in t.detail and "phase 2" not in t.detail

    # commence directement en phase 2 → objectif = P2 (+5)
    r.phase = "p2"
    t, _ = _target(r)
    assert t is not None and "+5" in t.detail and "phase 2" in t.detail

    # financé (après P2) → plus d'objectif, un payout à la place
    r.phase = "funded"
    t, c = _target(r)
    assert t is None and c.payout_amount is not None

    # directement financé (instant) → idem, aucun objectif
    inst = P.PropRules(account_id="I", challenge_type="instant")
    t, c = _target(inst)
    assert t is None and c.payout_amount is not None


def test_un_compte_personnel_persiste_son_statut():
    r = P.PropRules(account_id="P", is_prop=False)
    assert P.PropRules.from_dict(r.to_dict()).is_prop is False


# ------------------------------------------------------------ les réglages

def test_les_regles_font_l_aller_retour_json():
    r = P.PropRules(account_id="42", label="The5%ers",
                    start_balance=Decimal("50000"),
                    daily_loss_pct=Decimal("4"), drawdown_static=False,
                    profit_target_pct=Decimal("6"), consistency_pct=None)
    copie = P.PropRules.from_dict(r.to_dict())
    assert copie == r


def test_un_compte_absent_retombe_sur_le_premier(monkeypatch):
    monkeypatch.setattr(P, "accounts", lambda: [REGLES])
    assert P.rules_for("inconnu") is REGLES


# ---------------------------------------------------- cloisonnement des comptes

def test_deux_comptes_ne_partagent_pas_leurs_idees():
    a = Idea(account_id="14124899")
    b = Idea(account_id="55501")
    assert P.belongs_to(a, "14124899", "14124899")
    assert not P.belongs_to(b, "14124899", "14124899")
    assert P.belongs_to(b, "55501", "14124899")


def test_une_idee_sans_compte_reste_visible_sur_le_premier():
    """
    Tout le journal écrit avant l'existence des comptes multiples n'a pas de
    numéro. Le rattacher à « aucun compte » le ferait disparaître de l'écran —
    ce qui, vu de l'utilisateur, ressemble exactement à une perte de données.
    """
    ancienne = Idea()          # account_id == ""
    assert P.belongs_to(ancienne, "14124899", "14124899")
    assert not P.belongs_to(ancienne, "55501", "14124899")


def test_le_cloisonnement_vaut_aussi_pour_theses_et_transactions():
    """Chaque compte est INDÉPENDANT : idées, thèses ET transactions (soldes)."""
    from core.models import Campaign, Deal
    these = Campaign(name="Dollar fort", account_id="55501")
    deal = Deal(deal_id="1", time=datetime(2026, 7, 1, 18, 0), symbol="BTCUSD",
                deal_type="sell", entry="out", volume=Decimal("1"),
                price=Decimal("59000"), order_id="1", commission=Decimal(0),
                fee=Decimal(0), swap=Decimal(0), profit=Decimal("100"),
                balance=Decimal("100100"), account_id="55501")
    assert P.belongs_to(these, "55501", "14124899")
    assert not P.belongs_to(these, "14124899", "14124899")
    assert P.belongs_to(deal, "55501", "14124899")
    assert not P.belongs_to(deal, "14124899", "14124899")
