"""
Thèses macro.

Une conviction, exprimée sur PLUSIEURS instruments : « dollar fort » joué en
short EURUSD *et* en long USDJPY. Une seule décision, deux véhicules.

Entièrement facultatif. Une idée sans thèse macro fonctionne exactement comme
avant — c'est un chapeau, pas un passage obligé.

Pourquoi une couche à part, et pas une idée multi-symboles : le R, le pyramidage,
le breakeven et l'exposition simultanée reposent tous sur des tickets corrélés à
100 %, ce qui est vrai par construction sur un seul instrument et faux entre deux.
L'idée reste donc mono-symbole, et sa mécanique reste prouvée. La thèse macro
agrège par-dessus, en devise du compte.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Optional

import streamlit as st

from core.models import Campaign, Idea
from core.store import Store
from .. import blocks as B
from .. import theme as T
from .. import ui


THEMES = [
    "", "Fed / taux US", "BCE / zone euro", "BoJ / yen", "Inflation / CPI",
    "Emploi / NFP", "Risk-off géopolitique", "Flux COT / positionnement",
    "Énergie / matières premières", "Crypto — liquidité", "Autre",
]


def _form(store: Store, existing: Optional[Campaign] = None,
          account_id: str = "", data_dir=None):
    key = existing.id if existing else "new"
    # Pour une NOUVELLE thèse, on fige un id dès le départ : il sert de dossier
    # aux images insérées pendant la composition, avant même l'enregistrement.
    cid = existing.id if existing else st.session_state.setdefault(
        "new_camp_id", uuid.uuid4().hex[:12])

    if existing is None:
        st.markdown("## Écrire une thèse macro")
        st.markdown(
            '<div class="note">Le niveau au-dessus de l\'idée. À utiliser seulement '
            'quand une même conviction se joue sur <b>plusieurs instruments</b>. '
            'Pour un trade sur un seul symbole, l\'idée suffit.</div>',
            unsafe_allow_html=True)

    name = st.text_input("Nom", value=existing.name if existing else "",
                         key=f"camp_name_{key}",
                         placeholder="Dollar fort — Fed hawkish")

    c1, c2 = st.columns([2, 1])
    theme = c1.text_input(
        "Thème", value=existing.macro_theme if existing else "",
        key=f"camp_theme_{key}", placeholder="ex. Fed / taux US, dollar fort…",
        help="Écris-le librement — réutilise les mêmes mots d'une thèse à "
             "l'autre pour les regrouper.")
    conviction = c2.slider(
        "Conviction", 1, 5,
        existing.conviction if existing and existing.conviction else 3,
        key=f"camp_conv_{key}")

    catalyst = st.text_input(
        "Catalyseur attendu", value=existing.catalyst if existing else "",
        key=f"camp_cat_{key}", placeholder="FOMC du 30/07")

    # --- LE CORPS DE LA THÈSE, EN BLOCS (#184)
    ui.rule()
    ui.eyebrow("la thèse — écris, ajoute des visuels au fil",
               aide="Écris un paragraphe, insère une image à sa suite, continue. "
                    "Chaque bloc se déplace (↑↓) et se retire (✕).")
    bkey = f"camp_blocks_{key}"
    if bkey not in st.session_state:
        st.session_state[bkey] = B.init(
            existing.blocks if existing else [],
            existing.note if existing else "",
            existing.captures if existing else [])
    B.editor(bkey, "campaign", cid, data_dir)

    kill = st.text_area(
        "Ce qui tue la thèse", value=existing.kill_switch if existing else "",
        key=f"camp_kill_{key}", height=68,
        placeholder="Un pivot dovish. Un NFP qui s'effondre.",
        help="L'invalidation de la CONVICTION, pas d'un trade en particulier.")

    ui.rule()
    if not st.button("Enregistrer" if existing else "Créer la thèse macro",
                     type="primary", key=f"camp_save_{key}"):
        return
    if not name.strip():
        st.error("Un nom est nécessaire pour pouvoir y rattacher des idées.")
        return

    blocs = [dict(b) for b in st.session_state[bkey]]
    note = B.to_note(blocs)

    if existing:
        store.update_campaign(Campaign(
            id=existing.id, created_at=existing.created_at,
            name=name.strip(), macro_theme=theme, catalyst=catalyst,
            note=note, blocks=blocs, conviction=conviction, kill_switch=kill,
            closed=existing.closed, abandoned=existing.abandoned,
            abandon_correct=existing.abandon_correct,
            account_id=existing.account_id))
        st.success("Thèse modifiée.")
    else:
        store.create_campaign(Campaign(
            id=cid, name=name.strip(), macro_theme=theme, catalyst=catalyst,
            note=note, blocks=blocs, conviction=conviction, kill_switch=kill,
            account_id=account_id))
        st.success("Thèse macro créée. Rattache-lui des idées depuis leur détail.")
        # On repart d'une page vierge : les clés de composition sont libérées.
        for k in list(st.session_state):
            if k.endswith("_new") or k == "new_camp_id" or "_new_" in k \
                    or k == bkey:
                st.session_state.pop(k, None)
    st.rerun()


def _lecture(camp: Campaign, data_dir):
    """
    « Relire la thèse » — une page de LECTURE, pas un formulaire grisé.

    Le texte s'y lit comme un article : aucun widget désactivé (donc aucun
    curseur « interdit » sur le texte), les images intégrées à leur légende. On
    reprend l'ordre de l'écran d'écriture pour que l'œil retrouve ses repères,
    mais tout est du HTML — le curseur reste normal, sélectionnable.
    """
    st.markdown(f"## {camp.display_name}")
    conv = (f'<span class="chip">conviction {camp.conviction}/5</span>'
            if camp.conviction else "")
    st.markdown(
        f'<div class="note" style="margin-bottom:14px">'
        f'{camp.macro_theme or "thèse macro"}'
        f'{" · catalyseur : " + camp.catalyst if camp.catalyst else ""} {conv}'
        f'</div>', unsafe_allow_html=True)

    # La thèse se relit dans l'ordre où elle a été écrite : blocs texte et image
    # entremêlés (#184). Une ancienne thèse sans blocs retombe sur note+captures.
    ui.eyebrow("la thèse")
    B.render(camp.blocks or B.init([], camp.note, camp.captures), data_dir)

    if camp.kill_switch:
        st.markdown(
            f'<div class="card" style="margin-top:8px">'
            f'<div class="eyebrow">ce qui tue la thèse</div>'
            f'<p style="font-size:0.95rem;line-height:1.6;margin-top:8px;'
            f'white-space:pre-wrap">{camp.kill_switch}</p></div>',
            unsafe_allow_html=True)


def _menu_these(store: Store, c: Campaign):
    """
    Les 3 points verticaux du conteneur d'une thèse : relire / modifier /
    abandonner. Un popover natif (bien positionné, jamais un saut de page), pas
    trois accordéons empilés.
    """
    with st.popover("⋮", use_container_width=False):
        st.markdown('<div class="eyebrow bar">cette thèse</div>',
                    unsafe_allow_html=True)
        if st.button("Relire la thèse", key=f"read_{c.id}",
                     use_container_width=True):
            st.session_state["camp_view"] = (c.id, "read")
            st.rerun()
        if st.button("Modifier", key=f"editc_{c.id}", use_container_width=True):
            st.session_state["camp_view"] = (c.id, "edit")
            st.rerun()
        ui.rule()
        st.markdown(
            '<div class="note">L\'abandon sort la thèse des vues et des stats. '
            'Ses idées redeviennent autonomes. Rien n\'est effacé.</div>',
            unsafe_allow_html=True)
        ok = st.checkbox("Je confirme l'abandon", key=f"abdok_{c.id}")
        if st.button("Abandonner la thèse", key=f"abd_{c.id}",
                     disabled=not ok, use_container_width=True):
            store.abandon_campaign(c.id)
            st.session_state.pop("camp_view", None)
            st.rerun()


def _card(store: Store, c: Campaign, spec_book):
    executed = c.executed_ideas
    r_tot = c.r_total(spec_book) if executed else None
    r_w = c.r_weighted(spec_book) if executed else None
    tone = ui.tone_of(r_tot)

    instruments = " · ".join(c.instruments) if c.instruments else "aucune idée exécutée"

    # En-tête : le résumé à gauche, les 3 points alignés à droite dans le MÊME
    # conteneur (la conviction et le menu sur la même ligne, comme demandé).
    hg, hd = st.columns([8, 1])
    with hg:
        st.markdown(
            f'<div class="card" style="margin-bottom:0">'
            f'<div class="eyebrow">{c.macro_theme or "thèse macro"}</div>'
            f'<b style="font-size:1.05rem">{c.display_name}</b>'
            f'{" <span class=\'chip\'>conv " + str(c.conviction) + "/5</span>" if c.conviction else ""}'
            f'<div class="note mono">{len(c.ideas)} idée(s) · {instruments}</div>'
            f'</div>', unsafe_allow_html=True)
    with hd:
        _menu_these(store, c)

    # Une respiration entre l'en-tête (conviction, instruments) et les chiffres :
    # collés, le conteneur et son P&L se lisaient comme un seul bloc dense.
    st.markdown('<div style="height:16px"></div>', unsafe_allow_html=True)

    if not executed:
        st.markdown('<div class="note">Aucune idée exécutée pour l\'instant.</div>',
                    unsafe_allow_html=True)
        return

    c1, c2, c3 = st.columns(3)
    with c1:
        ui.stat("R de la thèse", ui.fmt_r(r_tot), tone,
                note="somme des R de chaque idée")
    with c2:
        ui.stat("Par unité de risque", ui.fmt_r(r_w), ui.tone_of(r_w),
                note="P&L total / risque total")
    with c3:
        ui.stat("P&L net", ui.fmt_money(c.pnl_net), ui.tone_of(c.pnl_net))

    # le détail par jambe : quel instrument a le mieux exprimé la thèse ?
    rows = []
    for i in sorted(executed, key=lambda x: x.opened_at):
        r = i.r_multiple(spec_book)
        t = ui.tone_of(r)
        rows.append(
            f'<tr><td>{i.symbol}</td>'
            f'<td>{i.thesis.direction.value if i.thesis else "—"}</td>'
            f'<td class="num {t}">{ui.fmt_r(r)}</td>'
            f'<td class="num {t}">{ui.fmt_money(i.pnl_net)}</td>'
            f'<td>{len(i.positions)} ticket(s)</td></tr>')

    st.markdown(
        '<table class="t"><tr><th>instrument</th><th>sens</th>'
        '<th style="text-align:right">R</th><th style="text-align:right">P&L net</th>'
        '<th>tickets</th></tr>' + "".join(rows) + "</table>",
        unsafe_allow_html=True)

    if r_tot is not None and len(executed) > 1:
        best = max(executed, key=lambda i: i.r_multiple(spec_book) or Decimal(-99))
        worst = min(executed, key=lambda i: i.r_multiple(spec_book) or Decimal(99))
        if best is not worst:
            st.markdown(
                f'<div class="note" style="margin-top:8px">'
                f'La même conviction a rapporté <b>{ui.fmt_r(best.r_multiple(spec_book))}</b> '
                f'sur {best.symbol} et <b>{ui.fmt_r(worst.r_multiple(spec_book))}</b> '
                f'sur {worst.symbol}. Sur plusieurs thèses, cet écart te dira quel '
                f'véhicule exprime le mieux tes convictions.</div>',
                unsafe_allow_html=True)


def render(store: Store, campaigns: dict, spec_book, data_dir=None,
           account_id: str = ""):
    ui.title("Thèses macro",
             "Une conviction jouée sur plusieurs instruments. Facultatif.")
    tab_list, tab_new = st.tabs(["Toutes les thèses macro", "Écrire une thèse macro"])

    with tab_new:
        _form(store, account_id=account_id, data_dir=data_dir)

    with tab_list:
        if not campaigns:
            ui.empty(
                "Aucune thèse macro.",
                "Elles sont facultatives : à créer seulement quand une même "
                "conviction se joue sur plusieurs instruments. Une idée sur un "
                "seul symbole n'en a pas besoin.")
            return

        vivantes = {cid: c for cid, c in campaigns.items()
                    if not getattr(c, "abandoned", False)}

        # --- sous-vue « relire » ou « modifier » (ouverte depuis les 3 points).
        # Une page à part entière, avec un retour — pas un accordéon qui pousse
        # le reste de la liste vers le bas.
        cv = st.session_state.get("camp_view")
        if cv and cv[0] in vivantes:
            cid, mode = cv
            camp = vivantes[cid]
            if st.button("← Retour", key="camp_back"):
                st.session_state.pop("camp_view", None)
                st.rerun()
            if mode == "edit":
                # Modifier = retour à l'écran de création, PRÉ-REMPLI. L'ajout
                # d'images se fait dans l'éditeur par blocs, au fil du texte
                # (#184/#189) — plus de gestion des visuels à part.
                _form(store, existing=camp, account_id=account_id,
                      data_dir=data_dir)
            else:
                _lecture(camp, data_dir)
            return

        for c in sorted(vivantes.values(), key=lambda x: x.created_at, reverse=True):
            _card(store, c, spec_book)
            ui.rule()

        abandonnees = [c for c in campaigns.values()
                       if getattr(c, "abandoned", False)]
        if abandonnees:
            st.markdown(
                f'<div class="note">{len(abandonnees)} thèse(s) abandonnée(s), '
                f'conservée(s) dans le journal.</div>', unsafe_allow_html=True)
