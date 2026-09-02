"""Composants partagés. Un composant fait une seule chose."""
from __future__ import annotations

import base64
from decimal import Decimal
from pathlib import Path
from typing import Optional

import streamlit as st

from core.models import Idea, IdeaStatus, Quadrant, RiskSource
from . import theme as T

STEPS = [
    (IdeaStatus.DRAFT, "brouillon"),
    (IdeaStatus.ARMED, "armée"),
    (IdeaStatus.RUNNING, "en cours"),
    (IdeaStatus.CLOSED, "clôturée"),
    (IdeaStatus.REVIEWED, "revue"),
]

# Le vocabulaire de la matrice décision × résultat, à un seul endroit.
QUADRANTS = {
    Quadrant.MASTERY: ("Maîtrise", "ok", "✓"),
    Quadrant.LUCK: ("Chance", "bad", "⚠"),
    Quadrant.ERROR: ("Erreur", "bad", "✗"),
    Quadrant.VARIANCE: ("Aléa OK", "sig", "↺"),
    Quadrant.PENDING: ("en attente", "sig", "⧖"),
}


def qmark(explication: str) -> str:
    """
    Un petit rond « ? » avec une explication au survol — pour tout endroit où un
    utilisateur peut arriver et se sentir perdu. Renvoie du HTML : il se glisse
    dans un titre (eyebrow), une étiquette, une phrase.
    """
    t = explication.replace('"', "&quot;").replace("\n", " ")
    return (f'<span title="{t}" style="display:inline-flex;width:15px;height:15px;'
            f'border-radius:50%;border:1px solid {T.RULE};color:{T.MUTED};'
            f'font-size:10px;line-height:1;align-items:center;justify-content:center;'
            f'cursor:help;margin-left:6px;vertical-align:middle;flex:0 0 auto">?</span>')


def eyebrow(text: str, bar: bool = True, aide: str = ""):
    cls = "eyebrow bar" if bar else "eyebrow"
    extra = qmark(aide) if aide else ""
    st.markdown(f'<div class="{cls}" style="display:inline-flex;align-items:center">'
                f'{text}{extra}</div>', unsafe_allow_html=True)


def title(text: str, subtitle: str = ""):
    """Le titre de page des maquettes : serif, puis une ligne d'explication."""
    html = f"# {text}"
    st.markdown(html)
    if subtitle:
        st.markdown(f'<div class="subtitle">{subtitle}</div>',
                    unsafe_allow_html=True)


def stat(label: str, value: str, tone: str = "", note: str = "", big: bool = False):
    cls = f"stat {tone}{' big' if big else ''}".strip()
    html = (f'<div class="eyebrow bar">{label}</div>'
            f'<div class="{cls}">{value}</div>')
    if note:
        html += f'<div class="note">{note}</div>'
    st.markdown(html, unsafe_allow_html=True)


def kpi(label: str, value: str, tone: str = "", note: str = ""):
    """Une tuile de chiffre, encadrée — les quatre du haut du tableau de bord."""
    st.markdown(
        f'<div class="card kpi">'
        f'<div class="eyebrow bar">{label}</div>'
        f'<div class="stat {tone}">{value}</div>'
        f'<div class="note">{note}</div>'
        f'</div>', unsafe_allow_html=True)


def gauge(part: Optional[float], tone: str = "gain",
          left: str = "", right: str = "") -> str:
    """
    Une jauge d'avancement vers une limite. `part` = 0..1 (borné).

    Renvoie du HTML : elle s'insère dans une carte plutôt que de créer son
    propre bloc — une jauge seule ne veut rien dire.
    """
    p = 0.0 if part is None else max(0.0, min(1.0, float(part)))
    return (f'<div class="gauge {tone}"><span style="width:{p * 100:.1f}%"></span></div>'
            f'<div class="gauge-ends"><span class="note">{left}</span>'
            f'<span class="note">{right}</span></div>')


def banner(tone: str, title_text: str, message: str, right_value: str = "",
           right_note: str = ""):
    """Le bandeau d'état en tête de page (dans les clous / alerte)."""
    right = ""
    if right_value:
        right = (f'<div class="right"><div class="stat {tone}">{right_value}</div>'
                 f'<div class="note">{right_note}</div></div>')
    st.markdown(
        f'<div class="banner {tone}">'
        f'<div><div class="title">{title_text}</div>'
        f'<div class="note">{message}</div></div>{right}</div>',
        unsafe_allow_html=True)


def rule():
    st.markdown('<hr class="rule">', unsafe_allow_html=True)


def fmt_r(r: Optional[Decimal | float]) -> str:
    if r is None:
        return "—"
    return f"{float(r):+.2f} R"


# La devise du COMPTE ACTIF, fixée une fois par run depuis main.py
# (ui.set_currency). Tout fmt_money sans devise explicite l'emploie — la matrice,
# les calendriers, les KPI, le détail : un seul point de vérité, aucune fmt_money
# à re-câbler ailleurs. $ par défaut tant que rien n'est fixé.
_CURRENCY = "$"


def set_currency(symbol: str):
    global _CURRENCY
    _CURRENCY = symbol or "$"


def fmt_money(x: Optional[Decimal | float], cur: Optional[str] = None) -> str:
    if x is None:
        return "—"
    sym = cur if cur is not None else _CURRENCY
    return f"{float(x):+,.2f} {sym}".replace(",", " ")


# Les mois en toutes lettres, en dur. `locale.setlocale(LC_TIME, "fr_FR")` échoue
# silencieusement sur une machine Windows anglophone et renvoie « July » : le
# tableau serait en français avec des dates en anglais.
MOIS = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet",
        "août", "septembre", "octobre", "novembre", "décembre"]
MOIS_COURT = ["", "janv", "févr", "mars", "avr", "mai", "juin", "juil",
              "août", "sept", "oct", "nov", "déc"]


def fmt_month(d) -> str:
    return f"{MOIS[d.month]} {d.year}" if d else "—"


def fmt_day(d) -> str:
    return f"{d.day} {MOIS_COURT[d.month]}" if d else "—"


def fmt_price(x) -> str:
    """Un prix, sans zéros inutiles : 71.40, 20140, 1.09105."""
    if x is None:
        return "—"
    s = f"{float(x):,.5f}".replace(",", " ").rstrip("0").rstrip(".")
    return s or "0"


def tone_of(x) -> str:
    if x is None:
        return "none"
    return "gain" if float(x) > 0 else ("loss" if float(x) < 0 else "none")


def stepper(status: IdeaStatus):
    """La séquence est réelle, donc la représenter comme une séquence a du sens."""
    order = [s for s, _ in STEPS]
    if status == IdeaStatus.ABANDONED:
        st.markdown('<div class="stepper"><span class="step on">abandonnée</span></div>',
                    unsafe_allow_html=True)
        return
    idx = order.index(status) if status in order else 0
    chunks = []
    for i, (_, name) in enumerate(STEPS):
        cls = "on" if i == idx else ("done" if i < idx else "")
        chunks.append(f'<span class="step {cls}">{name}</span>')
    st.markdown(f'<div class="stepper">{"".join(chunks)}</div>', unsafe_allow_html=True)


def provenance(idea: Idea) -> str:
    """
    La seule information qui reste : le R est-il calculable ?

    Plus de distinction « pré-engagé / reconstitué ». Une idée écrite le soir
    pour un trade du matin, ou un ticket dont l'export ne portait pas de stop,
    sont des trades comme les autres — les afficher autrement revenait à mettre
    un bandeau d'avertissement sur la majorité du journal.
    """
    if idea.risk_source == RiskSource.UNKNOWN:
        return (T.dot(False, T.MUTED) +
                '<span class="note">pas de stop — R non calculable</span>')
    return ""


def quadrant_chip(idea: Idea) -> str:
    """Le verdict décision × résultat, en une pastille."""
    label, cls, glyph = QUADRANTS[idea.quadrant]
    return f'<span class="chip {cls}">{glyph} {label}</span>'


def status_chip(idea: Idea) -> str:
    if idea.status == IdeaStatus.RUNNING:
        return f'<span class="chip acc">● en cours</span>'
    if idea.status == IdeaStatus.ABANDONED:
        return '<span class="chip">abandonnée</span>'
    if idea.is_executed:
        return '<span class="chip">clôturé</span>'
    return '<span class="chip sig">armée</span>'


def chips(idea: Idea, spec_book=None) -> str:
    out = []
    if idea.off_plan:
        out.append('<span class="chip warn">hors-plan</span>')
    # Plus de pastille « thèse tardive » : journaliser le soir un trade du matin
    # est le fonctionnement normal, pas une anomalie à signaler.
    if idea.review:
        s = idea.review.discipline_score
        cls = "ok" if s == 5 else ("bad" if s <= 3 else "")
        out.append(f'<span class="chip {cls}">plan {s}/5</span>')
    elif idea.is_executed and not idea.is_running:
        out.append('<span class="chip sig">review à faire</span>')
    if idea.adds:
        out.append(f'<span class="chip">{len(idea.adds)} add</span>')
    if idea.captures:
        out.append(f'<span class="chip">{len(idea.captures)} capture(s)</span>')
    if idea.thesis and idea.thesis.conviction:
        out.append(f'<span class="chip">conv {idea.thesis.conviction}/5</span>')
    return "".join(out)


def tags(idea: Idea) -> str:
    """
    Les étiquettes du journal : thème macro, catalyseur, setup.

    DEUX au maximum. Trois étiquettes repliaient chaque ligne du journal sur
    deux niveaux : le tableau passait de 20 lignes lisibles d'un coup d'œil à
    10, pour une information qui est de toute façon dans le détail de l'idée.
    """
    t = idea.thesis
    if not t:
        return ""
    mots = [w for w in (t.macro_theme, t.catalyst, t.setup) if w]
    if not mots:
        return ""
    return ('<div class="chips">' + "".join(
        f'<span class="chip acc">{w if len(w) <= 18 else w[:17] + "…"}</span>'
        for w in mots[:2]) + "</div>")


def idea_row(idea: Idea, spec_book=None) -> str:
    """Une ligne de tableau, dense."""
    r = idea.r_multiple(spec_book) if idea.is_executed else None
    tone = tone_of(r)
    return (
        f'<tr>'
        f'<td>{idea.display_name}</td>'
        f'<td>{idea.symbol}</td>'
        f'<td class="num {tone}">{fmt_r(r)}</td>'
        f'<td class="num {tone}">{fmt_money(idea.pnl_net) if idea.is_executed else "—"}</td>'
        f'<td>{chips(idea)}</td>'
        f'</tr>'
    )


def empty(message: str, action: str = ""):
    """Un écran vide est une invitation à agir, pas une déception."""
    html = f'<div class="card"><div class="eyebrow bar">rien ici</div><p>{message}</p>'
    if action:
        html += f'<p class="note">{action}</p>'
    st.markdown(html + "</div>", unsafe_allow_html=True)


# ------------------------------------------------------------------- captures

def _data_uri(path: Path) -> Optional[str]:
    """
    Une image en base64 DANS LA PAGE.

    Streamlit ne sert pas les fichiers de `data/` : passer un chemin à st.image
    fonctionne, mais nos captures doivent aussi apparaître à l'intérieur de
    blocs HTML (galeries, cartes). Le data-uri est le seul moyen d'y arriver
    sans exposer un serveur de fichiers — et l'outil reste hors-ligne.
    """
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    ext = path.suffix.lower().lstrip(".")
    mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png",
            "webp": "webp", "gif": "gif"}.get(ext, "png")
    return f"data:image/{mime};base64,{base64.b64encode(raw).decode()}"


# Alias public : une image redimensionnable (largeur en %) doit passer par une
# balise <img> dans du HTML pour garder ses proportions — d'où le data-uri.
def data_uri(path: Optional[Path]) -> Optional[str]:
    return _data_uri(path) if path is not None else None


