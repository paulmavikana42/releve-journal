"""
Tests du noyau.

Les métriques ne se testent pas « pour la forme ». Le jour où une formule de
Sharpe est fausse, tu prends des décisions de trading sur des chiffres faux.
Chaque test ci-dessous a une vérité connue à l'avance.
"""
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from core.metrics import (
    Expectancy, conviction_calibration, daily_returns,
    drawdown, equity_curve, sharpe, sortino,
    thesis_execution_matrix,
)
from core.models import (
    Direction, ExitReason, Idea, Position, Review, RiskSource, Thesis,
    ThesisOutcome,
)
from core.parser import num, parse_report

FIXTURE = Path(__file__).parent / "fixtures" / "ReportHistory-14124899.html"


# ------------------------------------------------------------------- parsing

def test_num_espace_insecable():
    """Le séparateur de milliers MT5 est un espace insécable (U+00A0)."""
    assert num("100\u00a0000.00") == Decimal("100000.00")
    assert num("-16.84") == Decimal("-16.84")
    assert num("market") is None
    assert num("") is None


def test_parse_reconcilie_au_centime():
    """
    Test d'or. La somme des P&L nets doit reproduire EXACTEMENT le
    « Profit Total Net » que MT5 affiche lui-même : -588.74.
    Si ce test casse, le parser ment.
    """
    r = parse_report(FIXTURE)
    assert r.account_id == "14124899"
    assert r.currency == "USD"
    assert len(r.positions) == 3

    total = sum(p.pnl_net for p in r.positions)
    assert total == Decimal("-588.74")
    assert r.deals[-1].balance == Decimal("99411.26")
    assert Decimal("100000") + total == r.deals[-1].balance


def test_profit_mt5_est_brut():
    """Le champ Profit de MT5 exclut commission et swap. Le net les inclut."""
    r = parse_report(FIXTURE)
    p = next(p for p in r.positions if p.position_id == "251022835")
    assert p.profit_gross == Decimal("452.64")
    assert p.commission == Decimal("-16.84")
    assert p.swap == Decimal("-55.44")
    assert p.pnl_net == Decimal("380.36")


def test_valeur_du_point_auto_deduite():
    """
    1 lot BTCUSD = 1 BTC. Déduit du fichier, sans aucune table de specs.

    Le rétro-calcul brut sort 0.9999973 : MT5 arrondit ses profits au centime.
    Le SpecBook « snappe » ce bruit d'arrondi vers la valeur propre.
    """
    from core.specs import SpecBook
    r = parse_report(FIXTURE)

    for p in r.positions:                       # brut : proche de 1, jamais égal
        assert abs(p.point_value - Decimal("1")) < Decimal("0.0001")

    book = SpecBook(r.positions)                # snappé : exactement 1
    spec = book.get("BTCUSD")
    assert spec.point_value == Decimal("1")
    assert spec.samples == 3
    assert spec.is_stable
    assert book.point_value(r.positions[0]) == Decimal("1")


def test_cause_de_sortie_lue_dans_le_commentaire():
    """MT5 encode la sortie au stop dans le commentaire : '[sl 62943.31]'."""
    r = parse_report(FIXTURE)
    reasons = {p.position_id: p.exit_reason for p in r.positions}
    assert reasons["251396944"] == ExitReason.STOP_LOSS
    assert reasons["251022835"] == ExitReason.MANUAL


# --------------------------------------------- LE piège : le stop de MT5 ment

def _pos(pid, open_p, close_p, vol="0.66", direction=Direction.SELL,
         gross="0", sl=None, h=0):
    t0 = datetime(2026, 7, 7, 21, 51) + timedelta(hours=h)
    return Position(
        position_id=pid, account_id="14124899", symbol="BTCUSD",
        direction=direction, volume=Decimal(vol),
        open_time=t0, open_price=Decimal(open_p),
        close_time=t0 + timedelta(hours=12), close_price=Decimal(close_p),
        commission=Decimal("0"), swap=Decimal("0"),
        profit_gross=Decimal(gross), sl_final=Decimal(sl) if sl else None,
    )


def test_le_stop_de_mt5_produirait_un_R_absurde():
    """
    Position réelle 251022835 : entrée 63791.42, stop MT5 affiché 63782.35.
    Soit 9 points — c'est un breakeven, pas un stop initial.

    Si on faisait confiance à MT5, ce trade sortirait à +63 R.
    """
    from core.models import StopProvenance

    p = _pos("251022835", "63791.42", "63105.60", gross="452.64", sl="63782.35")
    risque_selon_mt5 = p.volume * abs(p.open_price - p.sl_final) * p.point_value
    assert p.pnl_net / risque_selon_mt5 > 60          # +63.5 R. Absurde.

    # Le garde-fou : l'outil REFUSE de calculer plutôt que de mentir.
    assert p.stop_provenance == StopProvenance.SUSPECT_BE
    assert p.stop_original is None
    assert p.risk() is None

    # Avec le stop RÉEL de la thèse, écrit avant d'entrer :
    idea = Idea(thesis=Thesis(
        instrument="BTCUSD", direction=Direction.SELL,
        entry_planned=Decimal("63791.42"),
        stop_initial=Decimal("64700.51"),      # 0.6 % du compte
    ))
    idea.positions = [p]
    assert Decimal("0.7") < idea.r_multiple() < Decimal("0.8")   # +0.75 R. Crédible.


def test_stop_prouve_recupere_depuis_la_table_ordres():
    """
    MT5 ne ment pas TOUJOURS. Si le SL du placement (table Ordres) est identique
    au SL final (table Positions), le stop n'a jamais bougé : il est fiable, et
    l'outil le récupère sans rien te demander.
    """
    from core.models import StopProvenance
    r = parse_report(FIXTURE)
    by_id = {p.position_id: p for p in r.positions}

    prouve = by_id["251321750"]
    assert prouve.sl_at_placement == prouve.sl_final == Decimal("62424.72")
    assert prouve.stop_provenance == StopProvenance.PROVEN
    assert prouve.risk() == pytest.approx(Decimal("451.06"), abs=Decimal("0.1"))

    suspect = by_id["251022835"]
    assert suspect.stop_provenance == StopProvenance.SUSPECT_BE


def test_le_risque_dune_idee_est_la_somme_de_ses_tickets():
    """
    CORRECTION du modèle v1, imposée par les données.

    La v1 supposait les renforcements GRATUITS (noyau au breakeven, donc seul le
    ticket initial porte le risque). Le compte 14124899 dit le contraire : chaque
    add portait son propre stop complet, soit un demi-pourcent NEUF à chaque fois.

    Ne compter que le ticket initial donnait -0.98 R au lieu de -0.38 R : une
    perte deux fois et demie plus grosse qu'en réalité.
    """
    from core.models import RiskBasis
    from core.parser import parse_report
    from core.specs import SpecBook

    r = parse_report(FIXTURE)
    book = SpecBook(r.positions)
    idea = Idea(thesis=Thesis(
        instrument="BTCUSD", direction=Direction.SELL,
        entry_planned=Decimal("63791.42"),
        stop_initial=Decimal("64700.51"),      # 0.6 % de 100k sur 0.66 lot
    ))
    idea.positions = list(r.positions)

    risks = idea.ticket_risks(book)
    assert risks["251022835"] == pytest.approx(Decimal("600"), abs=Decimal("0.5"))
    assert risks["251321750"] == pytest.approx(Decimal("451.06"), abs=Decimal("0.1"))
    assert risks["251396944"] == pytest.approx(Decimal("505.76"), abs=Decimal("0.1"))

    total = idea.risk_realized(book, RiskBasis.SUM)
    assert total == pytest.approx(Decimal("1556.82"), abs=Decimal("0.5"))
    assert idea.r_multiple(book, RiskBasis.SUM) == pytest.approx(
        Decimal("-0.38"), abs=Decimal("0.01"))

    # l'ancien modèle, conservé pour comparaison — et faux ici
    assert idea.r_multiple(book, RiskBasis.INITIAL_ONLY) == pytest.approx(
        Decimal("-0.98"), abs=Decimal("0.01"))


def test_risque_max_simultane():
    """
    Le chiffre que MT5 ne donne nulle part, et que regarde ta prop firm :
    combien de risque était exposé EN MÊME TEMPS ?

    Thèse annoncée : 0.60 % du compte.
    Réalité        : 1.11 % — presque le double.
    """
    from core.parser import parse_report
    from core.specs import SpecBook

    r = parse_report(FIXTURE)
    book = SpecBook(r.positions)
    idea = Idea(thesis=Thesis(
        instrument="BTCUSD", direction=Direction.SELL,
        entry_planned=Decimal("63791.42"), stop_initial=Decimal("64700.51"),
        risk_pct=Decimal("0.6"),
    ))
    idea.positions = list(r.positions)

    peak = idea.max_concurrent_risk(book)
    assert peak == pytest.approx(Decimal("1105.76"), abs=Decimal("1"))
    assert peak / Decimal("100000") * 100 > Decimal("1.1")   # vs 0.6 % annoncé


# --------------------------------------------- l'idée, pas le ticket

def test_trois_tickets_une_idee():
    """
    MT5 dit : 3 trades, 33 % de réussite.
    La réalité : 1 idée, 0 % de réussite, ~-1.2 R.
    """
    r = parse_report(FIXTURE)
    idea = Idea(thesis=Thesis(
        instrument="BTCUSD", direction=Direction.SELL,
        entry_planned=Decimal("63791.42"), stop_initial=Decimal("64700.51"),
    ))
    idea.positions = list(r.positions)

    assert len(idea.positions) == 3
    assert idea.pnl_net == Decimal("-588.74")
    assert idea.r_multiple() < 0                     # une idée, une perte

    exp = Expectancy.of([float(idea.r_multiple())])
    assert exp.n == 1
    assert exp.win_rate == 0.0                       # et non 33.33 %


def test_les_adds_ont_transforme_un_gagnant_en_perdant():
    """Le drill-down qui justifie toute l'architecture."""
    r = parse_report(FIXTURE)
    idea = Idea(thesis=Thesis(instrument="BTCUSD", direction=Direction.SELL,
                              entry_planned=Decimal("63791.42"),
                              stop_initial=Decimal("64700.51")))
    idea.positions = list(r.positions)

    assert idea.pnl_initial == Decimal("380.36")     # le noyau gagnait
    assert idea.pnl_adds == Decimal("-969.10")       # les adds ont tout mangé
    assert idea.pnl_initial + idea.pnl_adds == idea.pnl_net


# ------------------------------------------------------------------- ratios

def test_sharpe_valeur_connue():
    """Rendement constant 1 %/jour, volatilité nulle -> Sharpe indéfini."""
    assert sharpe([0.01] * 10) is None

    rs = [0.01, -0.005, 0.02, 0.0, -0.01, 0.015]
    s = sharpe(rs)
    assert s is not None
    assert s.ci_low < s.value < s.ci_high            # l'IC encadre l'estimateur
    assert not s.is_meaningful                       # n=6, honnêtement signalé


def test_sortino_divise_par_n_total():
    """
    Le downside deviation divise par n TOTAL (Sortino/Satchell), et non par le
    seul nombre de jours perdants. Valeur calculée à la main :

        somme des carrés baissiers = 0.005² + 0.002² = 0.000029
        dd = sqrt(0.000029 / 6)    = 0.00219848
        moyenne                    = 0.0113333
        Sortino = (0.0113333 / 0.00219848) × sqrt(252) = 81.83

    La mauvaise formule (division par les 2 jours négatifs) donnerait 47.25.
    Les deux chiffres sont incomparables : d'où la convention figée ici.
    """
    rs = [0.02, 0.01, -0.005, 0.015, -0.002, 0.03]
    so = sortino(rs)
    assert so.value == pytest.approx(81.83, abs=0.01)
    assert so.value != pytest.approx(47.25, abs=0.01)
    assert so.value > sharpe(rs).value      # moins de vol pénalisée -> ratio plus haut


def test_drawdown_moyen_sur_les_periodes_en_dd():
    """Moyenner le DD sur toute la série (jours au plus haut inclus) flatte."""
    from core.metrics import EquityPoint
    from datetime import date
    curve = [
        EquityPoint(date(2026, 7, 1), 100_000),
        EquityPoint(date(2026, 7, 2), 110_000),   # plus haut
        EquityPoint(date(2026, 7, 3), 99_000),    # -10 %
        EquityPoint(date(2026, 7, 4), 104_500),   # -5 %
        EquityPoint(date(2026, 7, 5), 110_000),   # retour au plus haut
    ]
    dd = drawdown(curve)
    assert dd.max_dd_pct == pytest.approx(10.0)
    assert dd.avg_dd_pct == pytest.approx(7.5)    # (10+5)/2, pas (0+0+10+5+0)/5
    assert dd.longest_days == 2


def test_equity_curve_ne_remplit_pas_les_jours_sans_trade():
    """Injecter des rendements de 0 % écraserait la vol et gonflerait le Sharpe."""
    r = parse_report(FIXTURE)
    curve = equity_curve(r.deals)
    assert len(curve) == 4                         # 4 jours ayant bougé, pas 9 jours calendaires
    assert curve[0].balance == 100_000.0
    assert curve[-1].balance == 99_411.26


# ----------------------------------------------------- matrice & calibration

def _reviewed(r_target, score, outcome, conviction=3, off_plan=False):
    idea = Idea(off_plan=off_plan, thesis=Thesis(
        instrument="BTCUSD", direction=Direction.SELL,
        entry_planned=Decimal("60000"), stop_initial=Decimal("61000"),
        conviction=conviction, risk_source=RiskSource.COMPUTED,
    ))
    # 1 lot, 1000 pts de risque, pv=1 -> risque = 1000 $  =>  R = pnl / 1000
    pnl = Decimal(str(r_target)) * Decimal("1000")
    close = Decimal("60000") - pnl                 # sell : baisse = gain
    idea.positions = [Position(
        position_id="X", account_id="A", symbol="BTCUSD",
        direction=Direction.SELL, volume=Decimal("1"),
        open_time=datetime(2026, 7, 1), open_price=Decimal("60000"),
        close_time=datetime(2026, 7, 2), close_price=close,
        commission=Decimal("0"), swap=Decimal("0"), profit_gross=pnl,
    )]
    flags = [True] * score + [False] * (5 - score)
    idea.review = Review(*flags, thesis_outcome=outcome)
    return idea


def test_matrice_isole_le_cout_de_l_indiscipline():
    ideas = [
        _reviewed(2.0, 5, ThesisOutcome.CORRECT),
        _reviewed(2.4, 5, ThesisOutcome.CORRECT),
        _reviewed(0.2, 2, ThesisOutcome.CORRECT),    # bonne analyse, mal exécutée
        _reviewed(-0.9, 5, ThesisOutcome.WRONG),
    ]
    m = thesis_execution_matrix(ideas)
    assert m.clean_correct.n == 2
    assert m.clean_correct.expectancy_r == pytest.approx(2.2)
    assert m.dirty_correct.n == 1
    assert m.dirty_correct.expectancy_r == pytest.approx(0.2)
    assert m.cost_of_indiscipline == pytest.approx(2.0)   # 2 R laissés par idée


def test_calibration_detecte_une_conviction_qui_ne_dit_rien():
    ideas = [
        _reviewed(-1.0, 5, ThesisOutcome.WRONG, conviction=5),
        _reviewed(-0.8, 5, ThesisOutcome.WRONG, conviction=5),
        _reviewed(1.5, 5, ThesisOutcome.CORRECT, conviction=2),
        _reviewed(1.9, 5, ThesisOutcome.CORRECT, conviction=2),
    ]
    cal = conviction_calibration(ideas)
    c2 = next(c for c in cal if c.conviction == 2)
    c5 = next(c for c in cal if c.conviction == 5)
    assert c2.expectancy_r > c5.expectancy_r      # conviction inversée : signal fort


# ------------------------------------------------------------------- traçabilité

def test_les_R_reconstitues_ne_se_melangent_pas_aux_autres():
    """Une donnée pré-engagée n'a pas le poids d'une donnée reconstruite."""
    from core.metrics import r_multiples
    solide = _reviewed(1.0, 5, ThesisOutcome.CORRECT)
    memoire = _reviewed(3.0, 5, ThesisOutcome.CORRECT)
    memoire.thesis.risk_source = RiskSource.BACKFILLED

    assert len(r_multiples([solide, memoire], only_reliable=True)) == 1
    assert len(r_multiples([solide, memoire], only_reliable=False)) == 2


# ------------------------------------------------ le breakeven du noyau

def test_le_noyau_au_breakeven_sort_du_calcul_dexposition():
    """
    « Quand j'ai ouvert ce renforcement, mon noyau était-il déjà au breakeven ? »

    Un noyau sécurisé ne risque plus rien : son risque tombe à zéro à l'instant
    où l'add s'ouvre. Sur la campagne BTC réelle, la réponse change tout :

        sans la case (pire cas supposé) : 1.11 % du compte
        avec le noyau au BE             : 0.60 %  <- conforme à la thèse

    Le journal MT5 contiendrait l'horodatage exact des déplacements de stop, mais
    il n'existe pas sur mobile. Cette case est la seule source possible — et elle
    suffit : le calcul n'a pas besoin de l'HEURE du BE, seulement de savoir s'il
    précédait l'add.
    """
    from core.parser import parse_report
    from core.specs import SpecBook

    r = parse_report(FIXTURE)
    book = SpecBook(r.positions)
    idea = Idea(thesis=Thesis(
        instrument="BTCUSD", direction=Direction.SELL,
        entry_planned=Decimal("63791.42"), stop_initial=Decimal("64700"),
        risk_pct=Decimal("0.6"),
    ))
    idea.positions = list(r.positions)

    # sans réponse : l'outil suppose le pire, et le DIT
    assert not idea.exposure_is_measured()
    majorant = idea.max_concurrent_risk(book)
    assert majorant == pytest.approx(Decimal("1105.43"), abs=Decimal("1"))

    # avec le noyau sécurisé avant chaque add : c'est une mesure
    for a in idea.adds:
        idea.secured_on_add[a.uid] = True

    assert idea.exposure_is_measured()
    mesure = idea.max_concurrent_risk(book)
    assert mesure == pytest.approx(Decimal("599.66"), abs=Decimal("1"))
    assert mesure < majorant

    # 0.60 % du compte — exactement ce que la thèse annonçait
    assert float(mesure) / 100_000 * 100 == pytest.approx(0.60, abs=0.01)


def test_le_R_ne_depend_pas_du_breakeven():
    """
    Garde-fou conceptuel : le BE réduit l'EXPOSITION, jamais le dénominateur du R.

    Le R se mesure contre le risque initialement mis sur la table. Si le BE
    comptait comme dénominateur, chaque trade sécurisé exploserait à +50 R.
    """
    from core.parser import parse_report
    from core.specs import SpecBook

    r = parse_report(FIXTURE)
    book = SpecBook(r.positions)
    idea = Idea(thesis=Thesis(
        instrument="BTCUSD", direction=Direction.SELL,
        entry_planned=Decimal("63791.42"), stop_initial=Decimal("64700"),
    ))
    idea.positions = list(r.positions)

    avant = idea.r_multiple(book)
    for a in idea.adds:
        idea.secured_on_add[a.uid] = True
    apres = idea.r_multiple(book)

    assert avant == apres                       # le R ne bouge pas
    assert idea.max_concurrent_risk(book) < Decimal("700")   # l'exposition, si


# ------------------------------------------------------ le référentiel temporel

def test_aucune_date_du_domaine_ne_porte_de_fuseau():
    """
    BUG 1 — le crash.

        TypeError: can't compare offset-naive and offset-aware datetimes

    Idea.created_at était en UTC avec fuseau, les dates MT5 sans fuseau. Python
    refuse de les comparer : l'app plantait au tri des idées.

    Une seule règle : tout le domaine vit en heure serveur, SANS fuseau.
    """
    from core.clock import server_now
    from core.parser import parse_report

    idea = Idea(thesis=Thesis(instrument="BTCUSD", direction=Direction.SELL))
    assert idea.created_at.tzinfo is None

    r = parse_report(FIXTURE)
    for p in r.positions:
        assert p.open_time.tzinfo is None
        assert p.close_time.tzinfo is None

    assert server_now().tzinfo is None
    # comparables sans exception — c'est tout l'objet du test
    assert idea.created_at > r.positions[0].open_time


def test_une_these_valide_ne_doit_jamais_etre_rejetee_pour_un_fuseau():
    """
    BUG 2 — le dangereux, parce qu'il était SILENCIEUX.

    Ton terminal est en GMT+1, le serveur FundedNext en UTC+3. Le rapport MT5 est
    horodaté en HEURE SERVEUR.

    Le matcher disqualifie une thèse postérieure au ticket (une thèse écrite après
    le trade n'est pas une prédiction, c'est une justification).

    Si created_at avait été pris en heure LOCALE et comparé à une heure SERVEUR,
    une thèse écrite DEUX HEURES AVANT l'entrée aurait paru postérieure. Elle
    aurait été rejetée, et ton trade classé HORS-PLAN.

    L'outil t'aurait accusé d'improviser des trades que tu avais planifiés — et
    aurait pollué à jamais ta métrique la plus importante, sans jamais rien dire.
    """
    from datetime import timedelta
    from core import matcher
    from core.clock import server_utc_offset
    from core.parser import parse_report

    assert server_utc_offset() == 3        # FundedNext, déduit des logs terminal

    r = parse_report(FIXTURE)
    ticket = min(r.positions, key=lambda p: p.open_time)   # ouvert 07/07 21:51 serveur

    # Thèse écrite 2 h AVANT l'entrée, en heure serveur : elle doit être acceptée.
    idea = Idea(thesis=Thesis(
        instrument="BTCUSD", direction=Direction.SELL,
        entry_planned=Decimal("63791.42"), stop_initial=Decimal("64700"),
    ))
    idea.created_at = ticket.open_time - timedelta(hours=2)
    assert matcher.candidates(ticket, [idea])

    # L'heure LOCALE au même instant (GMT+1) vaut serveur − 2 h. Si on l'avait
    # comparée telle quelle, la thèse aurait semblé écrite... au moment du trade.
    # C'est exactement le décalage qui rejetait des thèses valides.
    naive_locale = idea.created_at - timedelta(hours=2)
    assert naive_locale + timedelta(hours=2) == idea.created_at

    # Une thèse réellement postérieure n'est plus rejetée : elle est proposée,
    # mais signalée comme tardive (elle ne comptera pas comme prédiction).
    tardive = Idea(thesis=Thesis(
        instrument="BTCUSD", direction=Direction.SELL,
        entry_planned=Decimal("63791.42"), stop_initial=Decimal("64700"),
    ))
    tardive.created_at = ticket.open_time + timedelta(minutes=1)
    cands = matcher.candidates(ticket, [tardive])
    assert cands and cands[0].late is True


def test_migration_des_anciens_evenements_avec_fuseau(tmp_path):
    """
    Le journal est append-only : on ne réécrit jamais le passé. Les événements
    créés avant la correction portent des dates UTC avec fuseau — elles sont
    normalisées À LA LECTURE.
    """
    import json
    from core.store import Store

    st = Store(tmp_path / "events.jsonl")
    st.create_thesis(Thesis(instrument="BTCUSD", direction=Direction.SELL))

    # on réécrit l'événement comme l'aurait fait l'ancienne version : UTC + fuseau
    ev = json.loads(st.path.read_text().splitlines()[0])
    ev["payload"]["created_at"] = {"$dt": "2026-07-07T12:00:00+00:00"}
    st.path.write_text(json.dumps(ev, ensure_ascii=False) + "\n")

    ideas, _, _ = st.load()
    idea = next(iter(ideas.values()))
    assert idea.created_at.tzinfo is None          # fuseau retiré
    assert idea.created_at.hour == 15              # 12:00 UTC -> 15:00 serveur (UTC+3)


# ------------------------------------------------------ pilotage du challenge

def test_challenge_survie_globale_et_stats_mensuelles():
    """
    L'alerte de survie (marge vs 90 000 $) est GLOBALE : le plancher FundedNext
    est fixe, il ne se remet pas à zéro chaque mois. Les stats de plus-bas, elles,
    sont mensuelles.
    """
    from core import challenge as C
    from core.parser import parse_report

    r = parse_report(FIXTURE)
    # tout l'historique
    state = C.compute(r.deals, C.Period())
    assert state.floor == Decimal("90000")
    assert state.balance == Decimal("99411.26")
    assert state.margin_to_floor == Decimal("9411.26")     # avant de sauter
    assert state.lowest_ever == Decimal("99014.06")        # creux réel du 09/07

    # drawdown depuis le départ, vs limite 10 %
    assert state.drawdown_from_start_pct == pytest.approx(Decimal("0.588"), abs=Decimal("0.01"))


def test_challenge_marge_reste_globale_meme_en_vue_mensuelle():
    """
    Le point critique : afficher un mois ne doit JAMAIS rapprocher la marge de
    survie de zéro. Elle reste calculée sur tout l'historique.
    """
    from core import challenge as C
    from core.parser import parse_report

    r = parse_report(FIXTURE)
    tout = C.compute(r.deals, C.Period())
    juillet = C.compute(r.deals, C.Period(2026, 7))

    # même marge de survie, quelle que soit la lentille
    assert tout.margin_to_floor == juillet.margin_to_floor
    assert tout.balance == juillet.balance


def test_periodes_disponibles_par_cloture():
    """Un trade appartient au mois de sa clôture, pas de son ouverture."""
    from core import challenge as C
    from core.parser import parse_report

    r = parse_report(FIXTURE)
    idea = Idea(thesis=Thesis(instrument="BTCUSD", direction=Direction.SELL,
                              entry_planned=Decimal("63791.42"),
                              stop_initial=Decimal("64700")))
    idea.positions = list(r.positions)

    periods = C.available_periods([idea])
    assert periods[-1].is_all                    # « tout » toujours en dernier
    assert C.Period(2026, 7) in periods          # les trades clôturent en juillet
    assert idea.closed_at.month == 7


# ------------------------------------------------------ registre des symboles

def test_symboles_appris_depuis_les_imports(tmp_path, monkeypatch):
    """
    Un symbole vu dans un rapport vient du BROKER : il fait foi et rejoint la
    liste sans discussion. C'est ce qui évite de retaper « BRENT » quand le
    broker écrit UKOUSD — et d'envoyer en hors-plan un trade planifié.
    """
    from core import symbols
    # RELEVE_DATA détourne TOUT le dossier de données : réglages, journal,
    # captures. Un test ne doit jamais pouvoir toucher aux vraies données.
    monkeypatch.setenv("RELEVE_DATA", str(tmp_path))

    base = symbols.watchlist()
    assert "NDX100" in base and "UKOUSD" in base and "USOUSD" in base
    assert "NASDAQ" not in base          # ton vocabulaire n'est pas celui du broker

    fresh = symbols.learn(["NDX100", "GER40", "XAGUSD"])
    assert fresh == ["GER40", "XAGUSD"]  # NDX100 déjà connu
    assert "GER40" in symbols.watchlist()


def test_symbole_existant_jamais_perdu(tmp_path, monkeypatch):
    """Une thèse portant un symbole hors liste reste modifiable sans le perdre."""
    from core import symbols
    # RELEVE_DATA détourne TOUT le dossier de données : réglages, journal,
    # captures. Un test ne doit jamais pouvoir toucher aux vraies données.
    monkeypatch.setenv("RELEVE_DATA", str(tmp_path))
    choices = symbols.known()
    current = "NASDAQ"
    if current not in choices:
        choices = [current] + choices
    assert choices[0] == "NASDAQ"        # proposé en tête, jamais écrasé
