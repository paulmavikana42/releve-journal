"""
Tableau de bord.

Ordre volontaire : les chiffres qui te concernent d'abord (edge, discipline,
hors-plan, adds), les ratios institutionnels ensuite. Ce n'est pas l'ordre
habituel d'un journal de trading, et c'est le but : ton Sharpe sur 20 trades ne
te dit rien, ton coût d'indiscipline te dit tout.
"""
from __future__ import annotations

import calendar as _cal
from datetime import date
from decimal import Decimal

import plotly.graph_objects as go
import streamlit as st

from core import metrics as M
from core.models import Idea, Quadrant, RiskSource
from .. import theme as T
from .. import ui

# Explications « pour un débutant » des ratios — glissées dans un rond « ? ».
_AIDE_SHARPE = ("Ton rendement rapporté à sa RÉGULARITÉ : gagner tranquillement "
                "vaut mieux que gagner en dents de scie. Plus il est haut, plus ta "
                "courbe est lisse. Il ne veut presque rien dire sous ~30 jours.")
_AIDE_SORTINO = ("Un Sharpe qui ne compte QUE le risque de perte : monter fort n'est "
                 "pas pénalisé, seule la volatilité à la baisse l'est. Plus il est "
                 "haut, mieux c'est.")
_AIDE_DD = ("Drawdown : le pire repli depuis un sommet. « max » = le plus profond "
            "trou vécu ; « moyen » = la profondeur habituelle de tes creux. Mesuré "
            "après chaque transaction, comme le fait ta prop firm.")


def _bars(ideas: list[Idea], spec_book) -> tuple[go.Figure, list[Idea]]:
    """
    L'histogramme chronologique. Une barre = une idée.

    SIGNATURE : la texture de la barre encode ta discipline.
      plein    = plan respecté (5/5)
      hachuré  = plan dégradé
      contour  = pas encore relu

    Tu vois si tes gains sont propres avant même de lire un chiffre.
    """
    shown = [i for i in ideas if i.is_executed and i.r_multiple(spec_book) is not None]
    shown.sort(key=lambda i: i.opened_at)

    xs, ys, colors, patterns, lines, texts = [], [], [], [], [], []
    for i in shown:
        r = float(i.r_multiple(spec_book))
        base = T.GAIN if r > 0 else T.LOSS
        score = i.discipline_score

        # Plotly n'accepte pas le hex à 8 chiffres : toute transparence en rgba().
        if score is None:
            fill, pattern, lw = T.TRANSPARENT, "", 1.5         # pas relu : contour seul
        elif score == 5:
            fill, pattern, lw = base, "", 0                    # propre : plein
        else:
            fill, pattern, lw = T.rgba(base, 0.33), "/", 1     # dégradé : hachuré

        xs.append(i.opened_at.strftime("%d/%m"))
        ys.append(r)
        colors.append(fill)
        patterns.append(pattern)
        lines.append(lw)
        texts.append(
            f"<b>{i.display_name}</b><br>"
            f"{ui.fmt_r(r)}   {ui.fmt_money(i.pnl_net)}<br>"
            f"plan : {score}/5" if score is not None else
            f"<b>{i.display_name}</b><br>{ui.fmt_r(r)}   {ui.fmt_money(i.pnl_net)}<br>review à faire"
        )

    fig = go.Figure(go.Bar(
        x=list(range(len(shown))), y=ys, customdata=texts,
        marker=dict(
            color=colors,
            line=dict(color=[T.GAIN if y > 0 else T.LOSS for y in ys], width=lines),
            pattern=dict(shape=patterns, fgcolor=[T.GAIN if y > 0 else T.LOSS for y in ys],
                         size=4, solidity=0.25),
        ),
        hovertemplate="%{customdata}<extra></extra>",
        width=0.62,
    ))
    fig.update_layout(**T.layout(
        height=280,
        xaxis=dict(tickmode="array", tickvals=list(range(len(shown))), ticktext=xs,
                   showgrid=False, zeroline=False, linecolor=T.RULE_SOFT,
                   tickfont=dict(size=9, color=T.MUTED)),
        yaxis=dict(title=dict(text="R", font=dict(size=10, color=T.MUTED)),
                   gridcolor=T.rgba(T.RULE_SOFT, 0.9), zeroline=True,
                   zerolinecolor=T.RULE, zerolinewidth=1,
                   tickfont=dict(size=10, color=T.MUTED)),
        clickmode="event+select",
    ))
    return fig, shown


def _couper_a_zero(xs, ys):
    """
    Découpe une polyligne en deux séries : au-dessus de zéro, en dessous.

    Le point de CROISEMENT est calculé et inséré dans les deux séries. Sans
    lui, le changement de couleur se produirait au point suivant : la courbe
    resterait verte jusqu'au bout du segment qui plonge, et l'œil daterait le
    passage en négatif d'un trade trop tard.

    Les `None` créent les trous : Plotly interrompt le tracé, ce qui permet aux
    deux séries de se relayer exactement au zéro.
    """
    px, hauts, bas = [], [], []

    def _ajouter(x, y):
        px.append(x)
        hauts.append(y if y >= 0 else None)
        bas.append(y if y <= 0 else None)

    _ajouter(xs[0], ys[0])
    for (x0, y0), (x1, y1) in zip(zip(xs, ys), zip(xs[1:], ys[1:])):
        if (y0 > 0 > y1) or (y0 < 0 < y1):
            # interpolation linéaire de l'instant où le cumul vaut zéro
            t = y0 / (y0 - y1)
            xc = x0 + (x1 - x0) * t
            px.append(xc)
            hauts.append(0.0)
            bas.append(0.0)
        _ajouter(x1, y1)
    return px, hauts, bas


def _r_curve(ideas: list[Idea], spec_book, campaigns=None, unit=None,
             mesure: str = "R", equity_ref=None) -> go.Figure | None:
    """
    Le R CUMULÉ, unité d'analyse après unité d'analyse.

    Pourquoi le R plutôt que le solde : le solde mélange ton edge et ta taille
    de position. Doubler la taille double la courbe sans que tu sois meilleur.
    Le R cumulé neutralise le sizing — c'est la courbe de ta compétence, et
    c'est celle qui doit monter.

    VERT au-dessus de zéro, ROUGE en dessous : la couleur dit l'état du cumul à
    cet instant, pas son état final.
    """
    unit = unit or M.Unit.THESIS
    base = float(equity_ref) if equity_ref else 0.0

    # En R, une unité sans R calculable ne peut pas figurer sur la courbe. En
    # argent ou en pourcentage, si : le P&L est toujours connu. La courbe montre
    # donc PLUS de points dans ces deux modes — c'est voulu, et c'est la raison
    # pour laquelle elles ne se superposent pas.
    toutes = [l for l in M.analysis_rows(ideas, campaigns, unit, spec_book)
              if l.closed_at]
    rows = [l for l in toutes if l.r is not None] if mesure == "R" else toutes
    if not rows:
        return None

    def _valeur(l):
        if mesure == "R":
            return l.r
        if mesure == "%":
            return (l.pnl / base * 100) if base else 0.0
        return l.pnl

    def _fmt(v):
        if mesure == "R":
            return f"{v:+.2f} R"
        return f"{v:+.2f} %" if mesure == "%" else ui.fmt_money(v)

    # LE POINT D'ORIGINE. Une courbe tracée sur les seules clôtures a besoin de
    # DEUX trades pour exister — et l'écran restait vide pendant toute la
    # première semaine, au moment précis où on regarde le plus. Or l'origine est
    # connue : avant le premier trade, le cumul vaut ZÉRO.
    xs = [rows[0].closed_at]
    ys = [0.0]
    infos = ["avant le premier trade"]

    total = 0.0
    for l in rows:
        total += _valeur(l)
        xs.append(l.closed_at)
        ys.append(total)
        infos.append(f"{l.label}<br>{_fmt(_valeur(l))}")

    px, hauts, bas = _couper_a_zero(xs, ys)

    # Le PAS des graduations, choisi d'après la durée couverte. Sans lui, Plotly
    # gradue à l'heure sur un historique de deux jours — et comme le format est
    # jour/mois, l'axe affiche « 08/07 » six fois de suite.
    jours = max(1, (xs[-1] - xs[0]).days)
    dtick = 86_400_000 if jours <= 10 else ("D7" if jours <= 60 else "M1")

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=px, y=hauts, mode="lines", line=dict(color=T.GAIN, width=2),
        fill="tozeroy", fillcolor=T.rgba(T.GAIN, 0.10),
        connectgaps=False, hoverinfo="skip", showlegend=False))
    fig.add_trace(go.Scatter(
        x=px, y=bas, mode="lines", line=dict(color=T.LOSS, width=2),
        fill="tozeroy", fillcolor=T.rgba(T.LOSS, 0.10),
        connectgaps=False, hoverinfo="skip", showlegend=False))
    # Les points, eux, portent l'infobulle — et leur couleur suit leur signe.
    fig.add_trace(go.Scatter(
        x=xs, y=ys, mode="markers",
        marker=dict(size=6, color=[T.GAIN if y >= 0 else T.LOSS for y in ys]),
        customdata=infos,
        hovertemplate="%{customdata}<br>cumul %{y:+.2f}<extra></extra>",
        showlegend=False))

    marge = max(abs(min(ys)), abs(max(ys)), 0.5) * 0.35
    fig.update_layout(**T.layout(
        height=300,
        # `%d/%m` plutôt que la date par défaut : Plotly écrit ses mois en
        # anglais (« Jul 8, 2026 ») et n'a pas de locale française côté client.
        xaxis=dict(tickformat="%d/%m", dtick=dtick, showgrid=False, zeroline=False,
                   linecolor=T.RULE_SOFT, ticks="outside",
                   tickcolor=T.RULE_SOFT,
                   tickfont=dict(size=10, color=T.MUTED)),
        yaxis=dict(range=[min(ys) - marge, max(ys) + marge],
                   gridcolor=T.rgba(T.RULE_SOFT, 0.9), zeroline=True,
                   zerolinecolor=T.RULE, zerolinewidth=1.2,
                   tickfont=dict(size=10, color=T.MUTED)),
    ))
    return fig


# Les 4 quadrants, façon maquette : fond, couleur, tag et verdict fixes par case
# (le sens de la case, pas le signe du R). Code couleur cohérent avec compliance.
_QUAD = {
    "edge": (T.rgba(T.GAIN, 0.16), T.GAIN, "ton vrai edge",
             "analyse juste, exécution nette — c'est ça qu'il faut scaler"),
    "leak": (T.rgba(T.WARN, 0.14), T.WARN, "ce que tu laisses sur la table",
             "l'analyse était bonne, l'indiscipline a mangé le gain"),
    "cost": ("", T.MUTED, "coût normal du métier",
             "process propre, marché contraire — rien à corriger ici"),
    "red":  (T.rgba(T.LOSS, 0.18), T.LOSS, "zone rouge",
             "mauvaise lecture ET mauvaise exécution — le vrai signal d'alarme"),
}


def _quad_card(cell, kind: str):
    bg, col, tag, verdict = _QUAD[kind]
    if cell.n == 0:
        r_html = '<div class="stat none big">—</div>'
        sub = "aucune donnée sur cette portée"
    else:
        r_html = (f'<div class="stat big" style="color:{col}">'
                  f'{cell.expectancy_r:+.2f} R</div>')
        sub = f'n = {cell.n} idée(s) · {verdict}'
    st.markdown(
        f'<div class="card" style="background:{bg};min-height:152px">'
        f'<div class="eyebrow" style="margin:0;color:{col}">{tag}</div>'
        f'{r_html}<div class="note" style="margin-top:6px">{sub}</div></div>',
        unsafe_allow_html=True)


def _matrix(m: M.Matrix):
    """La matrice thèse × exécution, façon maquette : 4 quadrants lisibles d'un
    coup d'œil. La seule question qui vaille : est-ce mon analyse, ou moi ?"""
    h0, h1, h2 = st.columns([0.5, 1, 1])
    h1.markdown('<div class="eyebrow bar" style="justify-content:center">'
                'exécution propre · 5/5</div>', unsafe_allow_html=True)
    h2.markdown('<div class="eyebrow bar" style="justify-content:center">'
                'exécution dégradée · ≤3/5</div>', unsafe_allow_html=True)

    lignes = [("idée<br>correcte", ("clean_correct", "edge"), ("dirty_correct", "leak")),
              ("idée<br>fausse", ("clean_wrong", "cost"), ("dirty_wrong", "red"))]
    for label, gauche, droite in lignes:
        c0, c1, c2 = st.columns([0.5, 1, 1])
        c0.markdown(f'<div class="eyebrow" style="margin-top:34px;color:{T.INK}">'
                    f'{label}</div>', unsafe_allow_html=True)
        with c1:
            _quad_card(getattr(m, gauche[0]), gauche[1])
        with c2:
            _quad_card(getattr(m, droite[0]), droite[1])

    if m.cost_of_indiscipline is not None:
        st.markdown(
            f'<div class="note" style="margin-top:4px">'
            f'<b>Le coût d\'indiscipline</b> — sur tes idées <b>correctes</b>, passer '
            f'd\'une exécution propre à dégradée te coûte '
            f'<b class="mono txt-loss">{m.cost_of_indiscipline:.2f} R par idée</b>. '
            f'Ce n\'est pas ton analyse qui te ruine, c\'est ta discipline.</div>',
            unsafe_allow_html=True)
    st.markdown(
        '<div class="note" style="margin-top:6px">'
        '<b>La question que ça règle</b> : si la colonne « dégradée » est toujours '
        'pire que « propre », ton problème est ta <b>discipline</b>. Si c\'est la '
        'ligne « fausse » qui domine, révise ta <b>lecture</b> du marché — ton '
        'exécution, elle, est déjà bonne.</div>', unsafe_allow_html=True)


def _decision_matrix(dm: M.DecisionMatrix, chiffre: str = "argent",
                     mot_unite: str = "idée(s)"):
    """
    Décision × résultat : les quatre cases des maquettes.

    Elle se lit d'un coup d'œil et elle est brutale : la case « gain / mauvais
    process » est celle qui te ruinera, parce que c'est celle qu'on répète.

    Sous le compte, ce que chaque case a COÛTÉ ou RAPPORTÉ — en argent, en
    pourcentage du compte ou en R, au choix. Un simple compte ne dit pas si les
    trois « erreurs » ont coûté 200 $ ou 12 000 $.
    """
    ui.eyebrow("décision × résultat")
    cases = [
        (Quadrant.LUCK, "luck", "Gain / mauvais process"),
        (Quadrant.MASTERY, "mastery", "Gain / bon process"),
        (Quadrant.ERROR, "error", "Perte / mauvais process"),
        (Quadrant.VARIANCE, "variance", "Perte / bon process"),
    ]

    def _valeur(cell) -> str:
        if cell.n == 0:
            return "—"
        if chiffre == "pourcentage":
            return f"{cell.pct:+.2f} %" if cell.pct is not None else "—"
        if chiffre == "R":
            return ui.fmt_r(cell.total_r)
        return ui.fmt_money(cell.pnl)

    html = ['<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">']
    for q, cls, label in cases:
        cell = dm.get(q)
        html.append(
            f'<div class="quad {cls}"><div class="lab">{label}</div>'
            f'<div class="n">{cell.n}</div>'
            f'<div class="mono" style="font-size:0.82rem;opacity:.85">'
            f'{_valeur(cell)}</div></div>')
    html.append("</div>")
    st.markdown("".join(html), unsafe_allow_html=True)

    part = dm.good_process_share
    if part is not None:
        st.markdown(
            f'<div class="note" style="margin-top:8px">'
            f'← process discipliné sur <b>{part * 100:.0f} %</b> de tes '
            f'{mot_unite} relues'
            f'{f" · {dm.n_pending} en attente de review" if dm.n_pending else ""}.'
            f'</div>', unsafe_allow_html=True)
    else:
        st.markdown(
            f'<div class="note" style="margin-top:8px">Aucune review : les '
            f'quatre cases restent vides tant que le process n\'est pas jugé. '
            f'{dm.n_pending} {mot_unite} en attente.</div>',
            unsafe_allow_html=True)


# ------------------------------------------------------------- le calendrier

_JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"]


def _calendrier(ideas: list, equity_ref, unite_montant: str = "argent",
                deals=()):
    """
    Le mois, jour par jour. Seuls les JOURS DE CLÔTURE sont colorés.

    Un jour sans clôture n'est pas un jour à zéro : c'est un jour où rien n'a
    été tranché. Les laisser neutres les distingue des jours à l'équilibre,
    qui sont, eux, une information.

    Le découpage se fait TICKET par ticket, pas idée par idée : une sortie
    partielle tombe au jour où elle a eu lieu, le solde au jour de la clôture
    totale. C'est ce qui s'est réellement passé sur le compte.
    """
    par_jour = M.daily_pnl_realise(ideas, deals)
    if not par_jour:
        st.markdown('<div class="note">Aucune clôture sur la période.</div>',
                    unsafe_allow_html=True)
        return

    mois_dispo = sorted({(d.year, d.month) for d in par_jour}, reverse=True)
    libelles = [f"{ui.MOIS[m]} {a}" for a, m in mois_dispo]
    choix = st.selectbox("Mois", libelles, key="cal_mois",
                         label_visibility="collapsed")
    an, mois = mois_dispo[libelles.index(choix)]

    base = float(equity_ref) or 1.0
    _cal.setfirstweekday(_cal.MONDAY)
    semaines = _cal.monthcalendar(an, mois)

    cellules = []
    total, jours_verts, jours_rouges = 0.0, 0, 0
    for semaine in semaines:
        for jour in semaine:
            if jour == 0:
                cellules.append('<div class="cal-day vide"></div>')
                continue
            d = date(an, mois, jour)
            pnl = par_jour.get(d)
            if pnl is None:
                cellules.append(
                    f'<div class="cal-day"><span class="num">{jour}</span></div>')
                continue
            total += pnl
            if pnl > 0:
                jours_verts += 1
                cls = "gain"
            elif pnl < 0:
                jours_rouges += 1
                cls = "loss"
            else:
                cls = "flat"
            montant = (f"{pnl / base * 100:+.2f} %" if unite_montant == "pourcentage"
                       else ui.fmt_money(pnl))
            cellules.append(
                f'<div class="cal-day {cls}"><span class="num">{jour}</span>'
                f'<span class="pnl">{montant}</span></div>')

    entete = "".join(f'<div class="cal-head">{j}</div>' for j in _JOURS)
    st.markdown(
        f'<div class="cal">{entete}{"".join(cellules)}</div>',
        unsafe_allow_html=True)

    ton = "gain" if total > 0 else ("loss" if total < 0 else "")
    st.markdown(
        f'<div class="note" style="margin-top:8px">'
        f'<b class="txt-{ton or "sig"}">{ui.fmt_money(total)}</b> sur le mois · '
        f'<span class="txt-gain">{jours_verts} jour(s) vert(s)</span> · '
        f'<span class="txt-loss">{jours_rouges} rouge(s)</span>. '
        f'Seuls les jours où de l\'argent est réellement tombé sont colorés : un '
        f'jour sans sortie n\'est pas un jour à zéro, c\'est un jour où rien n\'a '
        f'été tranché. Une sortie partielle compte le jour où elle a lieu ; la '
        f'clôture finale porte le <b>reste</b>.</div>', unsafe_allow_html=True)


def _calibration(points: list[M.CalibrationPoint]):
    """Tes convictions 5 surperforment-elles vraiment tes convictions 2 ?"""
    fig = go.Figure(go.Bar(
        x=[p.conviction for p in points],
        y=[p.expectancy_r for p in points],
        marker=dict(color=[T.GAIN if p.expectancy_r > 0 else T.LOSS for p in points]),
        text=[f"n={p.n}" for p in points],
        textposition="outside",
        textfont=dict(size=9, color=T.MUTED),
        width=0.55,
        hovertemplate="conviction %{x}/5<br>%{y:+.2f} R<extra></extra>",
    ))
    fig.update_layout(**T.layout(
        height=230,
        xaxis=dict(title=dict(text="conviction déclarée avant le trade",
                              font=dict(size=10, color=T.MUTED)),
                   tickmode="linear", showgrid=False, linecolor=T.RULE_SOFT,
                   tickfont=dict(size=10, color=T.MUTED)),
    ))
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})

    if len(points) >= 2:
        lo, hi = points[0], points[-1]
        if hi.expectancy_r <= lo.expectancy_r:
            st.markdown(
                f'<div class="note">Tes idées à conviction {hi.conviction} ne '
                f'surperforment pas tes idées à conviction {lo.conviction}. '
                f'Si tu sizes sur ta conviction, tu sizes sur du bruit.</div>',
                unsafe_allow_html=True)


def _equity(curve, dd=None):
    """La courbe de SOLDE — celle du compte, en devise. Sert au challenge."""
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=[p.d for p in curve], y=[p.balance for p in curve],
        mode="lines", line=dict(color=T.ACCENT, width=1.8),
        fill="tozeroy", fillcolor=T.rgba(T.ACCENT, 0.08),
        hovertemplate="%{x|%d/%m}<br>%{y:,.2f}<extra></extra>",
    ))
    lo = min(p.balance for p in curve)
    hi = max(p.balance for p in curve)
    pad = (hi - lo) * 0.35 or 100
    fig.update_layout(**T.layout(
        height=200,
        xaxis=dict(tickformat="%d/%m", showgrid=False, zeroline=False,
                   linecolor=T.RULE_SOFT, tickfont=dict(size=10, color=T.MUTED)),
        yaxis=dict(range=[lo - pad, hi + pad],
                   gridcolor=T.rgba(T.RULE_SOFT, 0.9),
                   tickfont=dict(size=10, color=T.MUTED), zeroline=False)))
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})


# seuil au-dessous duquel les métriques d'échantillon ne veulent rien dire
MIN_SAMPLE = 30


def _kpis(rows, equity_ref, deals, mot_unite="idée(s)", en_pct=False):
    """
    Les tuiles du haut : ce qu'on regarde en premier, tous les jours.

    Tout part des UNITÉS D'ANALYSE (thèses agrégées ou idées seules), jamais
    d'un mélange des deux — c'est ce qui garantit que le nombre affiché sous
    « n= » est bien le nombre de décisions prises.
    """
    clotures = [l for l in rows if l.closed_at]
    exp = M.expectancy_of(clotures)
    pnl = sum(l.pnl for l in clotures)
    base = float(equity_ref) or 1.0
    pcts = M.pct_results(clotures, equity_ref)

    def _res(valeur_r, valeur_pct) -> str:
        return f"{valeur_pct:+.2f} %" if en_pct else f"{valeur_r:+.2f} R"

    c1, c2, c3, c4 = st.columns(4)
    with c1:
        ui.kpi("Gain net", ui.fmt_money(pnl), ui.tone_of(pnl),
               f"{len(clotures)} clôturée(s) · {pnl / base * 100:+.2f} %")
    with c2:
        if exp:
            pf = exp.profit_factor
            ui.kpi("Profit factor", "∞" if pf == float("inf") else f"{pf:.2f}",
                   "gain" if pf > 1.5 else ("loss" if pf < 1 else "warn"),
                   "sain · > 1.5" if pf > 1.5 else "sous 1.5")
        else:
            ui.kpi("Profit factor", "—", note="aucun R calculable")
    with c3:
        if exp:
            ui.kpi("Win rate", f"{exp.win_rate * 100:.0f} %", "",
                   f"n={exp.n} · payoff {exp.payoff:.2f}")
        else:
            gagnantes = sum(1 for l in clotures if l.won)
            taux = gagnantes / len(clotures) * 100 if clotures else 0
            ui.kpi("Win rate", f"{taux:.0f} %", "",
                   f"n={len(clotures)} · sur le P&L (pas de R)")
    with c4:
        if exp:
            moy_pct = (sum(pcts) / len(pcts)) if pcts else 0.0
            ui.kpi("Espérance", _res(exp.expectancy_r, moy_pct),
                   ui.tone_of(exp.expectancy_r if not en_pct else moy_pct),
                   f"par {mot_unite.rstrip('(s)')}")
        else:
            ui.kpi("Espérance", "—", note="aucun stop pré-engagé")

    # --- seconde ligne : gain moyen / perte moyenne, Sharpe, Sortino
    gains_pct = [p for p in pcts if p > 0]
    pertes_pct = [p for p in pcts if p <= 0]
    rets = (M.daily_returns(M.equity_curve(deals)) if deals
            else M.daily_returns_from_rows(clotures, equity_ref))
    sh, so = M.sharpe(rets), M.sortino(rets)
    source = "soldes broker" if deals else "reconstitué"

    d1, d2, d3, d4 = st.columns(4)
    with d1:
        if exp:
            moy = (sum(gains_pct) / len(gains_pct)) if gains_pct else 0.0
            ui.kpi("Gain moyen", _res(exp.avg_win_r, moy), "gain",
                   f"sur {len(gains_pct)} {mot_unite} gagnante(s)")
        else:
            ui.kpi("Gain moyen", "—", note="—")
    with d2:
        if exp:
            moy = (sum(pertes_pct) / len(pertes_pct)) if pertes_pct else 0.0
            ui.kpi("Perte moyenne", _res(exp.avg_loss_r, moy), "loss",
                   f"sur {len(pertes_pct)} {mot_unite} perdante(s)")
        else:
            ui.kpi("Perte moyenne", "—", note="—")
    with d3:
        _lab = "Sharpe" + ui.qmark(_AIDE_SHARPE)
        if sh:
            note = (f"n={sh.n} j · {source}" if sh.is_meaningful
                    else f"n={sh.n} j · pas fiable · {source}")
            ui.kpi(_lab, f"{sh.value:.2f}", ui.tone_of(sh.value), note)
        else:
            ui.kpi(_lab, "—", note="moins de 2 jours de résultats")
    with d4:
        _lab = "Sortino" + ui.qmark(_AIDE_SORTINO)
        if so:
            ui.kpi(_lab, f"{so.value:.2f}", ui.tone_of(so.value),
                   f"n={so.n} j · {source}")
        else:
            ui.kpi(_lab, "—", note="moins de 2 jours de résultats")


def _challenge_block(state):
    """État du challenge — survie globale, performance mensuelle."""
    ui.eyebrow("état du challenge")

    c1, c2, c3, c4 = st.columns(4)
    with c1:
        d = f"au {state.balance_date:%d/%m}" if state.balance_date else ""
        ui.stat("Solde", ui.fmt_money(state.balance).lstrip("+"),
                note=f"{d} · dernier trade clos")
    with c2:
        # LA jauge de survie : marge avant le plancher fatal. TOUJOURS globale.
        ui.stat("Marge avant échec", ui.fmt_money(state.margin_to_floor).lstrip("+"),
                state.survival_tone,
                note=f"plancher {float(state.floor):,.0f} $ · "
                     f"{float(state.margin_pct):.1f} % du compte".replace(",", " "))
    with c3:
        ui.stat("Drawdown total", f"-{float(state.drawdown_from_start_pct):.2f} %",
                "loss" if state.drawdown_from_start_pct > 0 else "",
                note="depuis 100 000 $ · limite 10 %")
    with c4:
        if state.period_low is not None:
            dd = f"-{float(state.peak_drawdown_pct):.2f} %"
            ui.stat(f"Plus bas — {state.period_label.split()[0]}",
                    ui.fmt_money(state.period_low).lstrip("+"),
                    note=f"pic de repli {dd}")

    if state.balance_date:
        st.markdown(
            '<div class="note" style="margin-top:4px">'
            'Ce solde date de ta dernière clôture — pas de ton solde live. '
            'En swing, une position ouverte peut l\'avoir fait bouger depuis.</div>',
            unsafe_allow_html=True)

    if state.survival_tone == "loss":
        st.markdown(
            f'<div class="card" style="border-left:3px solid {T.LOSS}">'
            f'<div class="eyebrow">alerte</div>'
            f'<div class="note">Il te reste <b>{ui.fmt_money(state.margin_to_floor).lstrip("+")}</b> '
            f'avant le plancher de {float(state.floor):,.0f} $. '
            f'Un seul trade mal dimensionné peut suffire.</div></div>'.replace(",", " "),
            unsafe_allow_html=True)


def _running_block(running, spec_book):
    """Les trades EN COURS : ce que le journal seul ne montrait pas."""
    if not running:
        return
    ui.eyebrow(f"{len(running)} trade(s) en cours")
    rows = []
    for i in running:
        for o in i.open_trades:
            fr = i.floating_r(spec_book)
            rows.append(
                f'<tr><td><b>{o.symbol}</b></td>'
                f'<td><span class="chip {"ok" if o.direction.value == "buy" else "bad"}">'
                f'{"long" if o.direction.value == "buy" else "short"}</span></td>'
                f'<td class="note">#{o.ticket}</td>'
                f'<td class="num">{ui.fmt_price(o.open_price)}</td>'
                f'<td class="num">{ui.fmt_price(o.stop)}</td>'
                f'<td>{o.open_time:%d/%m %H:%M}</td>'
                f'<td class="num warn">{ui.fmt_r(fr) if fr is not None else "—"}</td></tr>')
    st.markdown(
        '<table class="t"><tr><th>symbole</th><th>sens</th><th>ticket</th>'
        '<th style="text-align:right">entrée</th><th style="text-align:right">stop</th>'
        '<th>ouvert</th><th style="text-align:right">flottant</th></tr>'
        + "".join(rows) + "</table>", unsafe_allow_html=True)
    st.markdown(
        '<div class="note" style="margin-top:6px">Le flottant vient des cours que '
        '<b>tu</b> as saisis, pas d\'un flux de prix. Il n\'entre dans aucune '
        'statistique.</div>', unsafe_allow_html=True)


def _recent_block(ideas, spec_book, equity_ref):
    """Les 5 dernières idées : R ponctuel + R normalisé (impact compte)."""
    ui.eyebrow("trades récents")
    recent = sorted([i for i in ideas if i.is_executed],
                    key=lambda x: x.closed_at or x.opened_at, reverse=True)[:5]
    if not recent:
        st.markdown('<div class="note">Aucune idée sur la période.</div>',
                    unsafe_allow_html=True)
        return

    rows = []
    for i in recent:
        r = i.r_multiple(spec_book)
        rn = i.r_normalized(equity_ref)
        tone = ui.tone_of(r)
        rows.append(
            f'<tr><td><b>{i.symbol}</b></td>'
            f'<td>{ui.quadrant_chip(i)}</td>'
            f'<td>Clôturé · {ui.fmt_day(i.closed_at)}</td>'
            f'<td class="num {tone}">{ui.fmt_r(r)}</td>'
            f'<td class="num {ui.tone_of(rn)}">{ui.fmt_r(rn)}</td>'
            f'<td class="num {ui.tone_of(i.pnl_net)}">{ui.fmt_money(i.pnl_net)}</td></tr>')

    st.markdown(
        '<table class="t"><tr><th>symbole</th><th>décision</th><th>statut</th>'
        '<th style="text-align:right">R engagé</th>'
        '<th style="text-align:right">R compte</th>'
        '<th style="text-align:right">P&L net</th></tr>'
        + "".join(rows) + "</table>", unsafe_allow_html=True)
    st.markdown(
        '<div class="note" style="margin-top:6px">'
        '<b>R engagé</b> : résultat / risque réel du trade — mesure ton edge. '
        '<b>R compte</b> : résultat / risque déclaré en % — mesure l\'impact sur '
        'le compte.</div>', unsafe_allow_html=True)


def _justesse_block(ideas):
    """
    La JUSTESSE : le marché t'a-t-il donné raison ? Indépendant du P&L.

    Sur tes idées exécutées et relues, la ventilation du verdict du marché :
    correcte / fausse / non testée. Ça juge ta LECTURE, pas ton gain — une idée
    correcte mal exécutée reste correcte, une idée fausse qui a payé reste fausse.
    """
    b = M.outcome_breakdown(ideas)
    total = b.correct + b.wrong + b.untested
    if total == 0:
        return

    ui.eyebrow("justesse — le marché t'a-t-il donné raison ?")
    taux = b.correct_rate
    c1, c2, c3 = st.columns(3)
    with c1:
        ui.stat("Idées correctes",
                f"{taux * 100:.0f} %" if taux is not None else "—",
                ("gain" if taux >= 0.5 else "loss") if taux is not None else "",
                note=(f"{b.correct}/{b.judged} idée(s) tranchée(s) par le marché"
                      if b.judged else "aucune idée encore tranchée"))
    with c2:
        ui.stat("Idées fausses", str(b.wrong),
                "loss" if b.wrong else "",
                note="le marché est parti contre ta lecture")
    with c3:
        ui.stat("Idées non testées", str(b.untested),
                note="sorti avant que le marché tranche — ni raison, ni tort")

    st.markdown(
        '<div class="note" style="margin-top:6px">'
        'On juge ta <b>lecture</b>, pas ton P&L : une idée juste mal exécutée '
        'reste juste. « <b>Non testée</b> » (sortie au breakeven, stop de bruit, '
        'gains pris tôt) ne compte pas dans le taux — le marché n\'a pas eu '
        'l\'occasion de te répondre.</div>', unsafe_allow_html=True)


def _theses_block(ideas, campaigns, spec_book):
    """
    Le niveau THÈSE : combien rapporte chaque conviction.

    Une idée non rattachée à une thèse compte pour elle-même — sinon la somme
    des lignes ne ferait pas le total du compte, et la section mentirait par
    omission.
    """
    from core.challenge import thesis_lines

    ui.eyebrow("tes thèses")
    lignes = thesis_lines(ideas, campaigns, spec_book)
    if not lignes:
        st.markdown('<div class="note">Aucune thèse sur la période.</div>',
                    unsafe_allow_html=True)
        return

    rows = []
    for l in lignes:
        tone = ui.tone_of(l.r_total)
        genre = ('<span class="chip sig">thèse</span>' if l.is_campaign
                 else '<span class="chip">idée seule</span>')
        rows.append(
            f'<tr><td>{l.label}</td>'
            f'<td>{genre}</td>'
            f'<td>{" · ".join(l.instruments)}</td>'
            f'<td class="num">{l.n_ideas}</td>'
            f'<td class="num {tone}">{ui.fmt_r(l.r_total)}</td>'
            f'<td class="num {ui.tone_of(l.pnl_net)}">{ui.fmt_money(l.pnl_net)}</td>'
            f'</tr>')

    st.markdown(
        '<table class="t"><tr><th>thèse</th><th></th><th>instruments</th>'
        '<th style="text-align:right">idées</th>'
        '<th style="text-align:right">R</th>'
        '<th style="text-align:right">P&L net</th></tr>'
        + "".join(rows) + "</table>", unsafe_allow_html=True)

    total = sum((l.pnl_net for l in lignes), Decimal(0))
    st.markdown(
        f'<div class="note" style="margin-top:6px">'
        f'Total : <b>{ui.fmt_money(total)}</b>. '
        f'Le R d\'une thèse est la <b>somme</b> des R de ses idées. '
        f'Une idée sans thèse compte pour elle-même.</div>',
        unsafe_allow_html=True)


def _performance_block(ideas, spec_book, deals=None):
    """
    La qualité du DRAWDOWN, mesurée sur les soldes du broker.

    Sharpe et Sortino vivent déjà dans les tuiles du haut : les répéter ici
    n'apportait rien qu'un écran plus chargé. On garde donc, à leur place, ce
    qu'ils ne montrent pas — la profondeur des creux.
    """
    if not deals:
        return
    ui.eyebrow("qualité du drawdown", aide=_AIDE_DD)

    dd = M.drawdown(M.deal_curve(deals))     # transaction par transaction
    if not dd:
        st.markdown('<div class="note">Pas encore de repli mesuré.</div>',
                    unsafe_allow_html=True)
        return

    d1, d2 = st.columns(2)
    with d1:
        ui.kpi("Drawdown max", f"-{dd.max_dd_pct:.2f} %",
               "loss" if dd.max_dd_pct else "",
               note=f"{dd.max_dd_abs:,.0f} $ · mesuré après chaque transaction"
                    .replace(",", " "))
    with d2:
        ui.kpi("Drawdown moyen", f"-{dd.avg_dd_pct:.2f} %", "",
               note="profondeur habituelle de tes creux")


def _todo_block(store_orphans, to_review, missing_stops):
    """À traiter — compact, en bas."""
    if not (store_orphans or to_review or missing_stops):
        return
    ui.eyebrow("à traiter")
    bits = []
    if store_orphans:
        bits.append(f'<span class="chip warn">{len(store_orphans)} ticket(s) à apparier</span>')
    if missing_stops:
        bits.append(f'<span class="chip bad">{len(missing_stops)} stop(s) manquant(s)</span>')
    if to_review:
        bits.append(f'<span class="chip sig">{len(to_review)} review(s) à faire</span>')
    st.markdown("<div>" + " ".join(bits) + "</div>", unsafe_allow_html=True)


def _analysis_block(ideas, spec_book, portee: str = ""):
    """
    Les 3 lectures d'analyse, sur la PORTÉE choisie en haut (un mois, ou tout
    l'historique). Plus de verrou à 30 idées : la matrice s'affiche dès qu'il y a
    une idée revue, avec un simple avertissement tant que l'échantillon est mince.
    """
    reviewed = [i for i in ideas if i.review is not None]
    n = len(reviewed)

    ui.eyebrow("analyse" + (f" — {portee.lower()}" if portee else ""),
               aide="Matrice thèse × exécution, plan vs hors-plan et calibration de "
                    "conviction. Cloisonné à ce compte, sur la portée choisie en "
                    "haut : ce mois précis, ou tout l'historique du compte.")
    if n == 0:
        st.markdown(
            '<div class="note">Aucune idée revue sur cette portée. Relis tes trades '
            '(ou passe la portée sur « Tout l\'historique ») pour faire apparaître '
            'la matrice.</div>', unsafe_allow_html=True)
        return
    if n < MIN_SAMPLE:
        st.markdown(
            f'<div class="note" style="margin-bottom:8px">Échantillon encore mince '
            f'— <b>{n}</b> idée(s) revue(s) sur cette portée. Les cases sont '
            f'affichées, mais lis-les avec prudence : il faut du recul pour qu\'une '
            f'matrice dise quelque chose de fiable.</div>', unsafe_allow_html=True)

    left, right = st.columns([1.25, 1])
    with left:
        st.markdown("### Ton analyse, ou toi ?")
        m = M.thesis_execution_matrix(ideas)
        if m:
            _matrix(m)
        st.markdown("### Plan vs hors-plan")
        pc = M.plan_vs_offplan(ideas)
        if pc.planned and pc.off_plan:
            a, b = st.columns(2)
            with a:
                ui.stat("Planifiées", f"{pc.planned.expectancy_r:+.2f} R",
                        ui.tone_of(pc.planned.expectancy_r), note=f"n={pc.planned.n}")
            with b:
                ui.stat("Hors-plan", f"{pc.off_plan.expectancy_r:+.2f} R",
                        ui.tone_of(pc.off_plan.expectancy_r),
                        note=f"n={pc.off_plan.n} · {pc.off_plan_ratio*100:.0f} %")
    with right:
        st.markdown("### Calibration")
        cal = M.conviction_calibration(ideas)
        if len(cal) >= 2:
            _calibration(cal)


def render(all_ideas, all_deals, spec_book, equity_ref,
           period=None, orphans=None, to_review=None, missing_stops=None,
           campaigns=None, account_label=""):
    from core import challenge as C

    period = period or C.Period()
    ui.title("Tableau de bord",
             f"{account_label + ' · ' if account_label else ''}{period.label}")

    running = [i for i in all_ideas if i.is_running]
    executed_all = [i for i in all_ideas if i.is_executed]
    if not executed_all and not running:
        ui.empty("Aucun trade pour l'instant.",
                 "Écris une idée dans « Journal », déclare son ticket à l'entrée, "
                 "puis dépose ton export à la clôture.")
        return

    ideas_p = C.ideas_in(all_ideas, period)
    campagnes = campaigns or {}

    # --- COMMENT ON COMPTE. Trois choix, annoncés, jamais devinés.
    o1, o2, o3 = st.columns([1.3, 1, 1])
    unite_lbl = o1.radio(
        "Unité d'analyse",
        ["Par thèse (recommandé)", "Par idée"],
        horizontal=True, key="unite_analyse",
        help="Une thèse macro jouée sur trois instruments est UNE décision. La "
             "compter trois fois triplerait ton échantillon et ferait passer un "
             "seul pari pour trois confirmations.")
    unit = M.Unit.THESIS if unite_lbl.startswith("Par thèse") else M.Unit.IDEA
    # « décision » plutôt que « thèse/idée » : en mode thèse, l'unité comptée
    # n'est ni l'une ni l'autre, c'est le PARI — une thèse macro ou une idée
    # autonome. Le mot doit dire ce qu'on compte, pas énumérer les cas.
    mot = "décision(s)" if unit == M.Unit.THESIS else "idée(s)"

    mesure = o2.radio("Mesure", ["En R", "En %"], horizontal=True, key="mesure_kpi",
                      help="Le R mesure ton edge en neutralisant la taille. Le "
                           "pourcentage mesure ce que ça a fait au compte. Les "
                           "deux sont vrais, ils ne répondent pas à la même question.")
    en_pct = mesure == "En %"

    chiffre = o3.radio("Matrice en", ["Argent", "%", "R"], horizontal=True,
                       key="matrice_chiffre",
                       help="Sous le nombre de trades de chaque case : ce qu'elle "
                            "t'a coûté ou rapporté.")
    chiffre = {"Argent": "argent", "%": "pourcentage", "R": "R"}[chiffre]

    rows = M.analysis_rows(ideas_p, campagnes, unit, spec_book)
    n_groupes = sum(1 for l in rows if l.is_campaign)
    st.markdown(
        f'<div class="note" style="margin:2px 0 14px 0">'
        + ((f'Les chiffres ci-dessous comptent <b>une thèse macro comme une '
            f'seule décision</b> : {n_groupes} thèse(s) regroupant plusieurs '
            f'idées, plus les idées autonomes. Le R d\'une thèse est la somme '
            f'des R de ses jambes.' if n_groupes else
            'Les chiffres ci-dessous comptent <b>une thèse macro comme une seule '
            'décision</b>. Tu n\'en as aucune pour l\'instant : chaque idée '
            'compte donc pour elle-même, et les deux modes donnent le même '
            'résultat.') if unit == M.Unit.THESIS else
           'Les chiffres ci-dessous comptent <b>chaque idée séparément</b>, y '
           'compris les jambes d\'une même thèse macro. Utile pour juger '
           'l\'exécution instrument par instrument ; trompeur pour juger ton edge, '
           'puisqu\'un seul pari joué sur trois instruments compte alors trois fois.')
        + '</div>', unsafe_allow_html=True)

    # 1. LES CHIFFRES
    _kpis(rows, equity_ref, all_deals, mot_unite=mot, en_pct=en_pct)

    # 2. COURBE DE R CUMULÉ + MATRICE DÉCISION × RÉSULTAT
    gauche, droite = st.columns([1.6, 1])
    with gauche:
        t1, t2 = st.columns([1.3, 1])
        with t1:
            ui.eyebrow("courbe d'équité · cumul")
        courbe_en = t2.radio("Courbe en", ["R", "%", "Argent"], horizontal=True,
                             key="courbe_mesure", label_visibility="collapsed",
                             help="En R : ta compétence, sizing neutralisé. En % "
                                  "ou en argent : l'effet réel sur le compte. "
                                  "Les deux derniers affichent aussi les trades "
                                  "dont le R n'est pas calculable.")
        fig = _r_curve(ideas_p, spec_book, campagnes, unit,
                       mesure={"R": "R", "%": "%", "Argent": "argent"}[courbe_en],
                       equity_ref=equity_ref)
        if fig is not None:
            st.plotly_chart(fig, use_container_width=True,
                            config={"displayModeBar": False})
            # Le R et le % ne se superposent PAS, et c'est le but : sans cette
            # ligne, on croit à un bug (le R finit à 0, le % à −1 %). L'écart EST
            # l'information — il mesure l'irrégularité du sizing.
            st.markdown(
                '<div class="note" style="margin-top:2px">'
                '<b>R</b> et <b>%</b> ne montent pas pareil, et c\'est voulu : le '
                '<b>R</b> enlève ta taille de position (il mesure ton edge), le '
                '<b>%</b> la garde (l\'impact réel sur le compte). Ils ne '
                'coïncident que si tu risques autant à chaque trade — un gros pari '
                'perdant creuse le % bien plus que le R. La hauteur d\'un point est '
                'un <b>cumul</b>, pas le résultat du seul trade du jour.</div>',
                unsafe_allow_html=True)
        else:
            st.markdown(
                '<div class="note">La courbe apparaîtra dès ta première idée '
                'clôturée dont le R est calculable. Le R cumulé neutralise ta '
                'taille de position : c\'est la courbe de ta compétence, pas de '
                'ton levier.</div>', unsafe_allow_html=True)
    with droite:
        _decision_matrix(
            M.decision_matrix(ideas_p, campagnes, unit, spec_book, equity_ref),
            chiffre=chiffre, mot_unite=mot)

    ui.rule()

    # 2 bis. LE CALENDRIER — ticket par ticket, donc les sorties partielles
    # tombent au jour où elles ont eu lieu.
    ui.eyebrow("le mois, jour par jour")
    _calendrier(ideas_p, equity_ref,
                unite_montant="pourcentage" if en_pct else "argent",
                deals=C.deals_in(all_deals, period))

    ui.rule()

    # 3. LES TRADES EN COURS
    if running:
        _running_block(running, spec_book)
        ui.rule()

    # 4. ÉTAT DU CHALLENGE — survie globale
    state = C.compute(all_deals, period)
    if state:
        _challenge_block(state)
        ui.rule()

    # 5. TRADES RÉCENTS
    _recent_block(ideas_p, spec_book, equity_ref)
    ui.rule()

    # 5 bis. JUSTESSE — le marché t'a-t-il donné raison ? Global : la justesse se
    # lit sur tout l'historique du compte, pas au mois.
    # Justesse : elle suit la portée elle aussi, pour rester cohérente avec le
    # reste du tableau de bord (ce mois, ou tout l'historique).
    _justesse_block(ideas_p)
    _b = M.outcome_breakdown(ideas_p)
    if (_b.correct + _b.wrong + _b.untested) > 0:
        ui.rule()

    # 6. TES THÈSES
    _theses_block(ideas_p, campaigns or {}, spec_book)
    ui.rule()

    # 7. QUALITÉ DE LA COURBE — le drawdown, mesuré comme le mesure ta firme.
    # Sharpe et Sortino sont montés dans les tuiles du haut : ils répondent à
    # « est-ce que ça vaut le risque ? », qui n'est pas une question de bas de page.
    _performance_block(ideas_p, spec_book, C.deals_in(all_deals, period))

    # 8. À TRAITER
    _todo_block(orphans or [], to_review or [], missing_stops or [])
    if orphans or to_review or missing_stops:
        ui.rule()

    # histogramme cliquable (sur la période). L'ancre sert au RETOUR depuis une
    # fiche d'idée : on re-scrolle exactement ici.
    st.markdown('<div id="anchor-bars"></div>', unsafe_allow_html=True)
    ui.eyebrow("tes idées, une par barre")
    st.markdown(
        '<div class="note">Une barre = une idée. <b>Pleine</b> = plan respecté · '
        '<b>hachurée</b> = plan dégradé · <b>contour</b> = review à faire. '
        'Clique une barre pour l\'ouvrir.</div>', unsafe_allow_html=True)
    fig, shown = _bars(ideas_p, spec_book)
    sel = st.plotly_chart(fig, use_container_width=True, on_select="rerun",
                          key="hist", config={"displayModeBar": False})

    # Clic sur une barre → on ouvre la fiche de l'idée en OVERLAY, et le retour
    # ramènera ici, dans « tes idées, une par barre ». On applique tout de suite
    # (un seul rerun) : déposer l'état sans rerun laissait la navigation à la
    # traîne — il fallait cliquer deux fois. Le removeChild d'origine venait de
    # la traduction auto du navigateur, désormais bloquée, pas de ce rerun.
    if sel and sel.get("selection", {}).get("points"):
        idx = sel["selection"]["points"][0].get("point_index")
        if idx is not None and idx < len(shown):
            if st.session_state.get("view_idea") != shown[idx].id:
                st.session_state["view_idea"] = shown[idx].id
                st.session_state["view_origin"] = "Tableau de bord"
                st.session_state["view_anchor"] = "anchor-bars"
                st.rerun()
    ui.rule()

    # métriques d'analyse — verrouillées sous 30 idées revues (sur la période)
    # L'analyse suit la PORTÉE choisie en haut (ce mois, ou tout l'historique),
    # comme toutes les autres métriques — cloisonnée à ce compte.
    _analysis_block(ideas_p, spec_book, portee=period.label)
