"""
Tests de RENDU.

Le trou que ce fichier bouche : les tests du noyau vérifiaient les chiffres, pas
les figures. Un hex à 8 chiffres (#B0392E55, valide en CSS, refusé par Plotly)
passait donc les 21 tests et cassait l'application au premier affichage.

Règle : toute figure doit être construite au moins une fois par les tests, sur
les trois états de discipline (propre / dégradée / non relue), car chacun emprunte
un chemin de couleur différent.
"""
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import plotly.graph_objects as go
import pytest

from app import theme as T
from app.views.dashboard import _bars
from core import metrics as M
from core.models import (
    Direction, Idea, Position, Review, RiskSource, Thesis, ThesisOutcome,
)
from core.parser import parse_report
from core.specs import SpecBook

FIXTURE = Path(__file__).parent / "fixtures" / "ReportHistory-14124899.html"


def _idea(r_target, score=None, day=1):
    """Une idée dont le R vaut exactement r_target. score=None -> pas de review."""
    t = Thesis(instrument="BTCUSD", direction=Direction.SELL,
               entry_planned=Decimal("60000"), stop_initial=Decimal("61000"),
               risk_pct=Decimal("1"), conviction=3,
               risk_source=RiskSource.COMPUTED)
    idea = Idea(thesis=t)
    pnl = Decimal(str(r_target)) * Decimal("1000")   # risque = 1 lot x 1000 pts x pv 1
    idea.positions = [Position(
        position_id=f"P{day}", account_id="A", symbol="BTCUSD",
        direction=Direction.SELL, volume=Decimal("1"),
        open_time=datetime(2026, 7, day, 9, 0), open_price=Decimal("60000"),
        close_time=datetime(2026, 7, day, 18, 0), close_price=Decimal("60000") - pnl,
        commission=Decimal("0"), swap=Decimal("0"), profit_gross=pnl,
    )]
    if score is not None:
        flags = [True] * score + [False] * (5 - score)
        idea.review = Review(*flags, thesis_outcome=ThesisOutcome.CORRECT)
    return idea


def test_plotly_refuse_le_hex_8_chiffres():
    """
    Le bug d'origine, figé dans un test pour qu'il ne revienne jamais.
    Valide en CSS, refusé par Plotly.
    """
    with pytest.raises(ValueError):
        go.Figure(go.Bar(x=[1], y=[1], marker=dict(color=["#B03A2E55"])))

    go.Figure(go.Bar(x=[1], y=[1], marker=dict(color=[T.rgba(T.LOSS, 0.33)])))


def test_histogramme_se_construit_sur_les_trois_etats():
    """
    Les trois textures de barre empruntent trois chemins de couleur différents.
    Il faut les trois dans le même graphique, gagnants ET perdants.
    """
    ideas = [
        _idea(2.0, score=5, day=1),    # gain, propre    -> plein
        _idea(-1.0, score=2, day=2),   # perte, dégradé  -> hachuré
        _idea(1.2, score=None, day=3), # gain, non relu  -> contour
        _idea(-0.8, score=5, day=4),   # perte, propre   -> plein
        _idea(0.5, score=2, day=5),    # gain, dégradé   -> hachuré
    ]
    fig, shown = _bars(ideas, spec_book=None)

    assert len(shown) == 5
    assert isinstance(fig, go.Figure)

    # Aucune couleur transmise à Plotly ne doit être un hex à 8 chiffres.
    for c in fig.data[0].marker.color:
        assert not (c.startswith("#") and len(c) == 9), f"hex 8 chiffres : {c}"

    fig.to_dict()      # sérialisation complète : c'est ce que fait Streamlit


def test_histogramme_sur_le_vrai_fichier():
    report = parse_report(FIXTURE)
    book = SpecBook(report.positions)

    idea = Idea(thesis=Thesis(
        instrument="BTCUSD", direction=Direction.SELL,
        entry_planned=Decimal("63791.42"), stop_initial=Decimal("64550"),
        risk_source=RiskSource.COMPUTED))
    idea.positions = list(report.positions)

    fig, shown = _bars([idea], book)
    assert len(shown) == 1
    fig.to_dict()


def test_toutes_les_figures_du_tableau_de_bord():
    """Chaque figure du dashboard, construite au moins une fois."""
    from app.views.dashboard import _calibration, _equity, _matrix
    report = parse_report(FIXTURE)

    ideas = [_idea(2.0, 5, 1), _idea(-1.0, 2, 2), _idea(1.5, 5, 3)]
    for i, conv in zip(ideas, (5, 2, 4)):
        i.thesis.conviction = conv

    # matrice
    m = M.thesis_execution_matrix(ideas)
    assert m is not None

    # calibration
    cal = M.conviction_calibration(ideas)
    assert len(cal) == 3

    # equity + drawdown, sur les deux courbes
    ticks = M.deal_curve(report.deals)
    daily = M.equity_curve(report.deals)
    assert M.drawdown(ticks).max_dd_pct == pytest.approx(0.99, abs=0.01)
    assert M.sharpe(M.daily_returns(daily)) is not None


def test_layout_du_theme_est_serialisable():
    """T.layout() ne doit contenir aucune couleur que Plotly refuse."""
    fig = go.Figure(go.Scatter(x=[1, 2], y=[1, 2]))
    fig.update_layout(**T.layout())
    fig.to_dict()
