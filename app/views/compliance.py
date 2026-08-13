"""
Compliance prop : les règles du challenge, adaptées à TON compte.

Chaque compte est indépendant (idées, thèses, transactions filtrées en amont).
L'écran se plie au type de challenge et à la phase : en challenge il montre les
objectifs et les limites ; une fois financé, il montre ce que tu vas réellement
toucher (ton payout, gain × profit split).

Le code couleur des conteneurs est le même partout : plus on s'approche d'une
limite, plus on vire au rouge ; plus on est à l'aise, plus on vire au vert. Le
neutre, c'est le fond de carte par défaut.

Chaque chiffre porte sa provenance : un solde reconstitué depuis les clôtures ne
vaut pas un solde relevé après chaque transaction, et l'écran le dit.
"""
from __future__ import annotations

from decimal import Decimal

import streamlit as st

from core import prop as P
from core.models import Idea
from .. import theme as T
from .. import ui
from .dashboard import _calendrier

ZERO = Decimal(0)


# --------------------------------------------------------- helpers d'affichage

def _money(x, sym: str) -> str:
    return f"{float(x):,.0f} {sym}".replace(",", " ")


def _q(texte: str) -> str:
    """Un petit rond « ? » avec une explication au survol, pour un non-initié."""
    t = texte.replace('"', "&quot;")
    return (f'<span title="{t}" style="display:inline-flex;width:16px;height:16px;'
            f'border-radius:50%;border:1px solid {T.RULE};color:{T.MUTED};'
            f'font-size:11px;line-height:1;align-items:center;justify-content:center;'
            f'cursor:help;margin-left:6px;vertical-align:middle">?</span>')


# 5 niveaux, du sain au critique. Tints translucides SUR la carte (qui a déjà son
# fond) — pas de grille derrière, donc pas le piège du compositing de la matrice.
def _niveau_bg(level: int) -> str:
    if level == 0:
        return f"background:{T.rgba(T.GAIN, 0.22)}"
    if level == 1:
        return f"background:{T.rgba(T.GAIN, 0.10)}"
    if level == 3:
        return f"background:{T.rgba(T.LOSS, 0.11)}"
    if level == 4:
        return f"background:{T.rgba(T.LOSS, 0.26)}"
    return ""      # 2 = neutre, fond de carte par défaut


def _niveau_limite(pct, breached: bool) -> int:
    """Pour une LIMITE : loin = vert, proche = rouge, franchie = rouge vif."""
    if breached:
        return 4
    if pct is None:
        return 2
    if pct >= 0.85:
        return 4
    if pct >= 0.6:
        return 3
    if pct >= 0.35:
        return 2
    if pct >= 0.15:
        return 1
    return 0


def _niveau_objectif(pct) -> int:
    """Pour un OBJECTIF : atteint = vert. Ne pas l'atteindre n'est pas un breach."""
    if pct is None:
        return 2
    if pct >= 1.0:
        return 0
    if pct >= 0.66:
        return 1
    if pct >= 0.33:
        return 2
    return 3


def _phase_libelle(r: P.PropRules) -> str:
    if r.challenge_type == "instant":
        return "instant funding · financé"
    if r.phase == "funded":
        return "financé"
    if r.challenge_type == "one_phase":
        return "1 phase"
    return "2 phases · phase " + ("2" if r.phase == "p2" else "1")


def _carte(titre: str, grande: str, tone: str, level: int, gauge_pct,
           sous: str, extra: str, aide: str):
    st.markdown(
        f'<div class="card" style="{_niveau_bg(level)}">'
        f'<div style="display:flex;justify-content:space-between;align-items:baseline">'
        f'<div class="eyebrow bar">{titre}{_q(aide)}</div>'
        f'<div class="note">{sous}</div></div>'
        f'<div class="stat {tone} big">{grande}</div>'
        f'{ui.gauge(gauge_pct, tone, "0 %", sous) if gauge_pct is not None else ""}'
        f'{extra}</div>', unsafe_allow_html=True)


# --------------------------------------------------------------------- l'écran

def _verrou(titre: str):
    st.markdown(
        f'<div class="card" style="opacity:.45;text-align:center;padding:24px">'
        f'<div style="font-size:1.4rem;line-height:1">🔒</div>'
        f'<div class="eyebrow bar" style="justify-content:center;margin-top:6px">'
        f'{titre}</div>'
        f'<div class="note">verrouillé — compte personnel</div></div>',
        unsafe_allow_html=True)


def _ecran_verrouille(rules: P.PropRules):
    """Compte personnel : aucune règle de challenge ne s'applique."""
    ui.title("🔒 Compte personnel — pas de suivi prop firm",
             f"{rules.label} · tu trades pour ton propre compte")
    st.markdown(
        f'<div class="card" style="border-left:3px solid {T.WARN}">'
        f'<div class="note">Tu as indiqué que ce compte <b>n\'est pas</b> un compte '
        f'prop firm. Les règles d\'un challenge — drawdown, objectif de profit, '
        f'jours de trading minimum, cohérence — ne s\'appliquent donc pas à toi, et '
        f'ces métriques restent <b>verrouillées</b> ici. Ton journal, tes idées et '
        f'tes statistiques de trading fonctionnent, eux, tout à fait normalement.'
        f'<br>Tu passes en prop firm un jour ? Bascule ce compte dans '
        f'<b>Réglages</b>.</div></div>', unsafe_allow_html=True)
    ui.rule()
    g, d = st.columns(2)
    with g:
        _verrou("Perte journalière")
    with d:
        _verrou("Drawdown max")
    cols = st.columns(3)
    for col, titre in zip(cols, ("Objectif de profit", "Jours de trading",
                                 "Cohérence")):
        with col:
            _verrou(titre)


def render(ideas: list[Idea], deals, rules: P.PropRules, spec_book=None):
    if not rules.is_prop:
        _ecran_verrouille(rules)
        return
    sym = rules.symbol
    ui.title("Compliance prop",
             f"{rules.label} · {_phase_libelle(rules)} · drawdown "
             f"{'statique' if rules.drawdown_static else 'trailing'} · "
             f"mise à jour à chaque import")

    c = P.evaluate(rules, ideas, deals)
    par_cle = {ch.key: ch for ch in c.checks}

    # --- le bandeau : une phrase qui tranche
    if c.breached:
        ui.banner("loss", "Règle enfreinte",
                  " · ".join(f"{b.label} : {b.value}" for b in c.breached),
                  f"{float(c.daily_pct):+.1f} %", "P&L du jour")
    elif c.warnings:
        ui.banner("warn", "À surveiller",
                  " · ".join(f"{w.label} : {w.value}" for w in c.warnings),
                  f"{float(c.daily_pct):+.1f} %", "P&L du jour")
    else:
        ui.banner("gain", "Dans les clous",
                  "Aucune règle enfreinte · marge confortable sur les deux limites",
                  f"{float(c.daily_pct):+.1f} %", "P&L du jour")

    # --- les deux limites qui tuent -------------------------------------
    g, d = st.columns(2)
    with g:
        ch = par_cle["daily"]
        _sous_j = ("aucune limite journalière" if c.daily_limit_pct == 0
                   else f"limite {float(c.daily_limit_pct):.0f} %")
        _carte(
            "Perte journalière", f"{float(c.daily_pct):+.2f} %", ch.tone,
            _niveau_limite(ch.pct, ch.breached), ch.pct,
            _sous_j,
            extra=(f'<div class="note" style="margin-top:10px">'
                   f'Tu peux encore risquer aujourd\'hui '
                   f'<b class="txt-{ch.tone}">{float(c.daily_allow_pct):.2f} %</b> '
                   f'≈ <b>{_money(c.daily_allow_amount, sym)}</b> · base du jour '
                   f'{_money(P.equity_series(rules, ideas, deals).before(c.day) or rules.start_balance, sym)}'
                   f'</div>'),
            aide="La perte que tu ne dois pas dépasser en une seule journée. La "
                 "base est le solde d'HIER, pas le capital de départ. Si le "
                 "plancher fatal est plus proche que cette limite, c'est lui qui "
                 "borne ta journée — le montant affiché en tient compte.")
    with d:
        ch = par_cle["drawdown"]
        _carte(
            "Drawdown max", ch.value, ch.tone,
            _niveau_limite(ch.pct, ch.breached), ch.pct,
            f"limite {float(c.drawdown_limit_pct):.0f} % · "
            f"{'statique' if rules.drawdown_static else 'trailing'}",
            extra=(f'<div class="note" style="margin-top:10px">'
                   f'Plancher fatal <b>{_money(c.floor, sym)}</b> · il te reste '
                   f'<b class="txt-{ch.tone}">{_money(c.margin_to_floor, sym)}</b>'
                   f'</div>'),
            aide="La perte totale maximale depuis le début. En statique, le "
                 "plancher ne bouge jamais. En trailing, il suit ton plus-haut. "
                 "Touché = compte perdu ; « il te reste » tombe alors à 0.")

    # --- le calendrier, imbriqué au-dessus des règles -------------------
    ui.rule()
    ui.eyebrow("le mois, jour par jour")
    st.markdown(
        '<div class="note">Le P&L réellement tombé sur le compte, jour par jour — '
        'c\'est ce que ta prop firm regarde. Un jour sans sortie n\'est pas un jour '
        'à zéro : c\'est un jour où rien n\'a été tranché.</div>',
        unsafe_allow_html=True)
    _calendrier(ideas, rules.start_balance, "argent", deals)

    ui.rule()

    # --- objectif de profit OU payout (une fois financé) ----------------
    ui.eyebrow("où tu en es")
    cols = st.columns(2)
    with cols[0]:
        if rules.is_funded:
            # Plus d'objectif : ce qui compte, c'est ce que tu vas TOUCHER.
            gain_net = c.balance - rules.start_balance
            positif = c.payout_amount is not None and c.payout_amount > 0
            if positif:
                _carte(
                    "Payout estimé", _money(c.payout_amount, sym), "gain", 0, None,
                    f"profit split {float(rules.profit_split_pct):.0f} %",
                    extra=(f'<div class="note" style="margin-top:8px">'
                           f'gain net <b>{_money(gain_net, sym)}</b> × '
                           f'{float(rules.profit_split_pct):.0f} % = ta part réelle '
                           f'au prochain retrait.</div>'),
                    aide="Tu es financé : plus d'objectif de profit. Ce conteneur "
                         "montre ce que tu toucheras vraiment — ton gain multiplié "
                         "par ton profit split.")
            else:
                _carte(
                    "Profit — négatif", _money(gain_net, sym), "loss", 4, None,
                    "rien à toucher pour l'instant",
                    extra='<div class="note" style="margin-top:8px">Tu es sous ton '
                          'capital de départ : il faut d\'abord y revenir avant tout '
                          'payout.</div>',
                    aide="Financé mais en perte : ton profit est négatif, il n'y a "
                         "rien à retirer tant que tu n'es pas repassé au-dessus du "
                         "capital de départ.")
        else:
            ch = par_cle.get("target")
            if ch:
                _carte(
                    "Objectif de profit", f"{float(c.profit_pct):+.2f} %", ch.tone,
                    _niveau_objectif(ch.pct), ch.pct, ch.detail,
                    extra='', aide="Le gain à atteindre pour valider cette phase. "
                                   "Ne pas l'atteindre n'est PAS une infraction — "
                                   "c'est juste la phase pas encore franchie.")
            else:
                _carte("Profit", f"{float(c.profit_pct):+.2f} %",
                       ui.tone_of(c.profit_pct), 2, None, "compte sans objectif",
                       extra='', aide="Ce compte n'a pas d'objectif de profit "
                                      "déclaré.")
    with cols[1]:
        ch = par_cle.get("days")
        if ch:
            _carte(
                "Jours de trading", ch.value, ch.tone, _niveau_objectif(ch.pct),
                ch.pct, ch.detail, extra='',
                aide="Le nombre de jours minimum exigés. Un jour compte selon la "
                     "définition de ta firme (une position, ou un gain/perte au-delà "
                     "d'un seuil). Le compteur ne dépasse jamais la cible.")
        else:
            st.markdown('<div class="note">Aucun minimum de jours de trading sur '
                        'ce compte à ce stade.</div>', unsafe_allow_html=True)

    # --- la règle de cohérence mérite une phrase, pas une pastille
    coh = par_cle.get("consistency")
    if coh:
        st.markdown(
            f'<div class="card" style="{_niveau_bg(3 if not coh.ok else 1)};'
            f'margin-top:2px">'
            f'<b class="txt-{coh.tone}">Cohérence (consistency){_q("Part maximale du profit total quun seul jour a le droit de peser. La plupart des firmes la vérifient au retrait — un gros trade isolé peut bloquer la validation même objectif atteint.")} :</b> '
            f'<span class="note">{coh.detail}.</span></div>', unsafe_allow_html=True)

    ui.rule()

    # --- l'honnêteté sur la source
    src = ("relevés après chaque transaction — c'est ainsi que ta firme mesure"
           if c.equity.measured else
           "RECONSTITUÉS depuis tes clôtures : justes en fin de trade, aveugles "
           "aux creux intrajournaliers. Importe un rapport HTML MT5 (ou un CSV "
           "avec colonne solde) pour mesurer comme le fait ta firme")
    st.markdown(
        f'<div class="note">Solde <b>{_money(c.balance, sym)}</b> · '
        f'{c.trading_days} jour(s) de trading valides · soldes {src}.<br>'
        f'Une position ouverte ne bouge ce solde que par le cours que tu as '
        f'saisi : l\'outil n\'a pas de flux de prix, et ne prétend pas en avoir.'
        f'</div>', unsafe_allow_html=True)
