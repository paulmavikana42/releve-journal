"""
Le formulaire d'UN compte prop — partagé par l'onboarding et les Réglages.

Tout ce qui est saisi à la création reste éditable ensuite : c'est la MÊME
fonction qui sert dans les deux écrans, en création (existing=None) comme en
modification (existing=<PropRules>). Une seule source, donc aucun risque que les
deux divergent.

Widgets DIRECTS (pas de st.form) : le type de challenge fait apparaître ou
disparaître des champs (objectif phase 2, seuil de jour de trading…), et ça
n'aurait aucun sens si l'écran ne réagissait qu'à la validation.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Optional

import streamlit as st

from core import prop
from .. import ui

_DEVISES = {"Dollar ($)": "USD", "Euro (€)": "EUR", "Livre (£)": "GBP"}
_TYPES = {"1 phase": "one_phase", "2 phases": "two_phase",
          "Instant funding": "instant"}
_MODES = {"Statique — plancher fixe": True, "Trailing — sur le plus-haut": False}
_REGLE_JOUR = {"une position ouverte": "position",
               "un gain ≥ seuil": "gain", "une perte ≥ seuil": "loss"}
_PORTEE = {"En challenge seulement": "challenge", "Aussi une fois financé": "always"}


def _index(mapping: dict, valeur, defaut) -> int:
    vals = list(mapping.values())
    return vals.index(valeur) if valeur in vals else vals.index(defaut)


def _f(x, defaut=0.0) -> float:
    return float(x) if x is not None else defaut


def rules_form(prefix: str, existing: Optional[prop.PropRules] = None
               ) -> prop.PropRules:
    """Dessine le formulaire et renvoie les règles saisies (non persistées)."""
    r = existing
    k = lambda s: f"{prefix}_{s}"      # noqa: E731 — clés de widgets uniques

    # --- prop firm ou personnel (le tout premier choix) ------------------
    _type0 = st.radio(
        "Ce compte est…",
        ["Un compte prop firm (challenge)", "Un compte personnel (pas de prop firm)"],
        horizontal=True, key=k("isprop"),
        index=0 if (r.is_prop if r else True) else 1,
        help="En personnel, aucune règle de challenge ne s'applique : l'écran "
             "Compliance reste verrouillé, et les options ci-dessous sont sans "
             "objet (grisées).")
    is_prop = _type0.startswith("Un compte prop")
    dis = not is_prop      # grise toutes les options liées à la prop firm

    # --- identité ---------------------------------------------------------
    c1, c2 = st.columns([1.4, 1])
    label = c1.text_input("Nom du compte", value=r.label if r else "Mon compte",
                          key=k("label"), placeholder="FundedNext Stellar")
    broker = c2.text_input("Broker / prop firm", value=r.broker if r else "",
                           key=k("broker"), placeholder="FundedNext, The5%ers…")

    c1, c2 = st.columns([1, 1.4])
    dev_lib = c1.selectbox(
        "Devise", list(_DEVISES), key=k("dev"),
        index=_index(_DEVISES, r.currency if r else "USD", "USD"),
        help="Pilote le symbole affiché partout sur ce compte ($, €, £).")
    currency = _DEVISES[dev_lib]
    sym = prop._CURRENCY_SYMBOLS[currency]
    capital = c2.number_input(f"Capital de départ ({sym})", min_value=0.0,
                              value=_f(r.start_balance if r else None, 100000.0),
                              step=1000.0, key=k("cap"))

    if dis:
        st.markdown(
            '<div class="note">Compte personnel : les règles de challenge '
            'ci-dessous sont <b>grisées</b> et sans effet. L\'écran Compliance '
            'restera verrouillé pour ce compte.</div>', unsafe_allow_html=True)

    # --- type de challenge et phase --------------------------------------
    ui.rule()
    ui.eyebrow("type de challenge")
    type_lib = st.radio(
        "Type", list(_TYPES), horizontal=True, key=k("type"), disabled=dis,
        index=_index(_TYPES, r.challenge_type if r else "two_phase", "two_phase"),
        help="1 phase : un seul objectif. 2 phases : un objectif par phase. "
             "Instant funding : financé d'emblée, aucun objectif de profit.")
    challenge_type = _TYPES[type_lib]

    phase = "p1"
    p1_target: Optional[Decimal] = None
    p2_target: Optional[Decimal] = None

    if challenge_type == "instant":
        st.markdown(
            '<div class="note">Instant funding : tu es financé dès le départ. '
            'Aucun objectif de profit à afficher — le suivi montrera directement '
            'ton profit et ta part au payout.</div>', unsafe_allow_html=True)
        phase = "funded"

    elif challenge_type == "one_phase":
        c1, c2 = st.columns([1, 1])
        etat = c1.radio("Où en es-tu ?", ["En challenge", "Déjà financé"],
                        horizontal=True, key=k("etat1"), disabled=dis,
                        index=1 if r and r.phase == "funded" else 0)
        phase = "funded" if etat == "Déjà financé" else "p1"
        if phase == "p1":
            p1_target = Decimal(str(c2.number_input(
                "Objectif de profit (%)", min_value=0.0, disabled=dis,
                value=_f(r.profit_target_pct if r else None, 8.0),
                step=0.5, key=k("t1"))))

    else:   # two_phase
        etats = {"Phase 1": "p1", "Phase 2": "p2", "Déjà financé": "funded"}
        c1, c2, c3 = st.columns([1.1, 1, 1])
        etat = c1.selectbox(
            "Phase de départ", list(etats), key=k("etat2"), disabled=dis,
            index=_index(etats, r.phase if r else "p1", "p1"),
            help="Tu peux commencer directement en phase 2 si ta firme le permet.")
        phase = etats[etat]
        # les deux objectifs restent saisissables même en phase 2 : ils
        # décrivent le challenge, pas seulement l'instant présent.
        p1_target = Decimal(str(c2.number_input(
            "Objectif phase 1 (%)", min_value=0.0, disabled=dis,
            value=_f(r.profit_target_pct if r else None, 8.0),
            step=0.5, key=k("t1b"))))
        p2_target = Decimal(str(c3.number_input(
            "Objectif phase 2 (%)", min_value=0.0, disabled=dis,
            value=_f(r.profit_target_p2_pct if r else None, 5.0),
            step=0.5, key=k("t2"))))

    split = st.number_input(
        "Profit split — ta part au payout (%)", min_value=0.0, max_value=100.0,
        value=_f(r.profit_split_pct if r else None, 80.0), step=5.0, key=k("split"),
        disabled=dis,
        help="Ce que tu touches réellement sur les gains une fois financé. "
             "Sert à afficher ton payout estimé.")

    # --- limites de risque ------------------------------------------------
    ui.rule()
    ui.eyebrow("les limites de risque")
    c1, c2, c3 = st.columns(3)
    daily = c1.number_input("Perte / jour (%)", min_value=0.0, max_value=100.0,
                            value=_f(r.daily_loss_pct if r else None, 5.0),
                            step=0.5, key=k("daily"), disabled=dis)
    maxdd = c2.number_input("Drawdown max (%)", min_value=0.0, max_value=100.0,
                            value=_f(r.max_drawdown_pct if r else None, 10.0),
                            step=0.5, key=k("dd"), disabled=dis)
    mode_lib = c3.selectbox(
        "Mode de drawdown", list(_MODES), key=k("mode"), disabled=dis,
        index=_index(_MODES, r.drawdown_static if r else True, True),
        help="Statique : le plancher ne bouge jamais (FundedNext base fixe). "
             "Trailing : il suit ton plus-haut.")
    static = _MODES[mode_lib]

    # --- jours de trading minimum ----------------------------------------
    ui.rule()
    ui.eyebrow("jours de trading minimum")
    c1, c2 = st.columns([1, 1.7])
    ndays = c1.number_input("Nombre requis", min_value=0, step=1, disabled=dis,
                            value=int(r.min_trading_days) if r and r.min_trading_days
                            else 3, key=k("ndays"))
    regle_lib = c2.radio(
        "Un « jour de trading » compte quand il y a…", list(_REGLE_JOUR),
        key=k("regle"), disabled=dis,
        index=_index(_REGLE_JOUR, r.trading_day_rule if r else "position", "position"),
        help="Beaucoup de firmes exigent un gain (ou une perte) minimal pour "
             "qu'un jour compte — pas juste une position ouverte.")
    regle = _REGLE_JOUR[regle_lib]

    seuil = Decimal("0")
    if regle != "position":
        seuil = Decimal(str(st.number_input(
            "Seuil (% du compte)", min_value=0.0, step=0.1, format="%.2f",
            value=_f(r.trading_day_threshold_pct if r else None, 0.5),
            key=k("seuil"), disabled=dis,
            help="Le gain (ou la perte) minimal du jour pour qu'il soit compté.")))

    portee_lib = st.radio(
        "Ces jours minimum s'appliquent…", list(_PORTEE), horizontal=True,
        key=k("portee"), disabled=dis,
        index=_index(_PORTEE, r.min_days_scope if r else "challenge", "challenge"))
    portee = _PORTEE[portee_lib]

    # --- cohérence (facultative) -----------------------------------------
    ui.rule()
    coh = st.number_input(
        "Cohérence max (%) — 0 = règle absente", min_value=0.0, max_value=100.0,
        value=_f(r.consistency_pct if r else None, 30.0), step=1.0, key=k("coh"),
        disabled=dis,
        help="Part maximale du profit total qu'un seul jour a le droit de peser. "
             "La plupart des firmes la vérifient au moment du retrait.")

    return prop.PropRules(
        account_id=r.account_id if r else "", is_prop=is_prop,
        label=label.strip() or "Mon compte", broker=broker.strip(),
        currency=currency, start_balance=Decimal(str(capital)),
        challenge_type=challenge_type, phase=phase,
        daily_loss_pct=Decimal(str(daily)), max_drawdown_pct=Decimal(str(maxdd)),
        drawdown_static=static,
        profit_target_pct=p1_target, profit_target_p2_pct=p2_target,
        profit_split_pct=Decimal(str(split)),
        min_trading_days=int(ndays) or None,
        trading_day_rule=regle, trading_day_threshold_pct=seuil,
        min_days_scope=portee,
        consistency_pct=Decimal(str(coh)) if coh else None,
        warn_at=r.warn_at if r else Decimal("75"),
    )
