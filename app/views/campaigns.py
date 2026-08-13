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

from decimal import Decimal
from typing import Optional

import streamlit as st

from core import captures as CAP
from core.models import Campaign, CaptureKind, Idea
from core.store import Store
from .. import theme as T
from .. import ui


THEMES = [
    "", "Fed / taux US", "BCE / zone euro", "BoJ / yen", "Inflation / CPI",
    "Emploi / NFP", "Risk-off géopolitique", "Flux COT / positionnement",
    "Énergie / matières premières", "Crypto — liquidité", "Autre",
]


def _form(store: Store, existing: Optional[Campaign] = None,
          account_id: str = ""):
    if existing is None:
        st.markdown("## Écrire une thèse macro")
        st.markdown(
            '<div class="note">Le niveau au-dessus de l\'idée. À utiliser seulement '
            'quand une même conviction se joue sur <b>plusieurs instruments</b>. '
            'Pour un trade sur un seul symbole, l\'idée suffit.</div>',
            unsafe_allow_html=True)

    with st.form(f"campaign_{existing.id if existing else 'new'}",
                 clear_on_submit=not existing):
        name = st.text_input("Nom", value=existing.name if existing else "",
                             placeholder="Dollar fort — Fed hawkish")

        c1, c2 = st.columns([2, 1])
        theme = c1.text_input("Thème", value=existing.macro_theme if existing else "",
                              placeholder="ex. Fed / taux US, dollar fort…",
                              help="Écris-le librement — réutilise les mêmes mots d'une "
                                   "thèse à l'autre pour les regrouper.")
        conviction = c2.slider("Conviction", 1, 5,
                               existing.conviction if existing and existing.conviction else 3)

        catalyst = st.text_input("Catalyseur attendu",
                                 value=existing.catalyst if existing else "",
                                 placeholder="FOMC du 30/07")
        note = st.text_area("La thèse", value=existing.note if existing else "",
                            height=90, placeholder="Pourquoi le marché a tort.")
        kill = st.text_area(
            "Ce qui tue la thèse", value=existing.kill_switch if existing else "",
            height=68, placeholder="Un pivot dovish. Un NFP qui s'effondre.",
            help="L'invalidation de la CONVICTION, pas d'un trade en particulier.")

        submit = st.form_submit_button(
            "Enregistrer" if existing else "Créer la thèse macro", type="primary")

    if not submit:
        return
    if not name.strip():
        st.error("Un nom est nécessaire pour pouvoir y rattacher des idées.")
        return

    if existing:
        store.update_campaign(Campaign(
            id=existing.id, created_at=existing.created_at,
            name=name.strip(), macro_theme=theme, catalyst=catalyst,
            note=note, conviction=conviction, kill_switch=kill,
            closed=existing.closed, abandoned=existing.abandoned,
            abandon_correct=existing.abandon_correct,
            account_id=existing.account_id))
        st.success("Thèse modifiée.")
    else:
        store.create_campaign(Campaign(
            name=name.strip(), macro_theme=theme, catalyst=catalyst,
            note=note, conviction=conviction, kill_switch=kill,
            account_id=account_id))
        st.success("Thèse macro créée. Rattache-lui des idées depuis leur détail.")
    st.rerun()


# Les captures reviennent au niveau THÈSE, mais sous une forme structurée : des
# « blocs visuels » (image + légende), pas une galerie décorative. Une thèse
# macro a ses propres pièces — un diagramme du dollar, un COT, une structure
# macro — qui ne sont pas celles d'une jambe précise. Voir _blocs_visuels.


def _blocs_visuels(store: Store, camp: Campaign, data_dir):
    """
    Les blocs visuels d'une thèse : une image (diagramme, graphique, COT…) avec
    sa légende à gauche, empilables. Donnée STRUCTURÉE — le journal ne stocke que
    le chemin et la légende, jamais du HTML libre : la thèse reste auditable et
    exportable, comme le reste de l'outil.
    """
    if data_dir is None:
        return
    n = len(camp.captures)
    with st.expander(f"Blocs visuels — {n} bloc(s)"):
        st.markdown(
            '<div class="note">Une image + sa légende. Un diagramme de ta thèse, '
            'un graphique macro, une capture du COT — chacun décrit par un mot. '
            'Empile-en autant que tu veux.</div>', unsafe_allow_html=True)

        for a in camp.captures:
            ui.rule()
            g, d = st.columns([1, 1])
            with g:
                st.markdown(
                    f'<div class="eyebrow bar">légende</div>'
                    f'<div class="note">{a.caption or "—"}</div>'
                    + (f'<div class="note mono" style="opacity:.6;margin-top:6px">'
                       f'joint le {a.added_at:%d/%m %H:%M}</div>' if a.added_at else ""),
                    unsafe_allow_html=True)
                if st.button("Retirer ce bloc", key=f"rmbloc_{camp.id}_{a.id}"):
                    store.remove_capture(a.id)
                    st.rerun()
            with d:
                p = CAP.resolve(data_dir, a)
                if p is not None:
                    st.image(str(p), use_container_width=True)
                else:
                    st.markdown('<div class="note">image introuvable sur le disque</div>',
                                unsafe_allow_html=True)

        ui.rule()
        ui.eyebrow("＋ nouveau bloc")
        legende = st.text_area("Légende", key=f"leg_{camp.id}", height=68,
                               placeholder="Ce que cette image montre, en une phrase.")
        img = st.file_uploader("Image (PNG, JPG, WEBP)", key=f"img_{camp.id}",
                               type=["png", "jpg", "jpeg", "webp", "gif"])
        if st.button("Ajouter ce bloc", key=f"addbloc_{camp.id}", type="primary"):
            if img is None:
                st.error("Choisis une image d'abord.")
            else:
                try:
                    att = CAP.save(data_dir, "campaign", camp.id, img.name,
                                   img.getvalue(), kind=CaptureKind.THESIS,
                                   caption=legende.strip())
                    store.add_capture(att)
                    st.rerun()
                except CAP.CaptureError as e:
                    st.error(str(e))


def _card(c: Campaign, spec_book):
    executed = c.executed_ideas
    r_tot = c.r_total(spec_book) if executed else None
    r_w = c.r_weighted(spec_book) if executed else None
    tone = ui.tone_of(r_tot)

    instruments = " · ".join(c.instruments) if c.instruments else "aucune idée exécutée"

    st.markdown(
        f'<div class="card">'
        f'<div class="eyebrow">{c.macro_theme or "thèse macro"}</div>'
        f'<b style="font-size:1.05rem">{c.display_name}</b>'
        f'{" <span class=\'chip\'>conv " + str(c.conviction) + "/5</span>" if c.conviction else ""}'
        f'<div class="note mono">{len(c.ideas)} idée(s) · {instruments}</div>'
        f'</div>', unsafe_allow_html=True)

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
        _form(store, account_id=account_id)

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

        for c in sorted(vivantes.values(), key=lambda x: x.created_at, reverse=True):
            _card(c, spec_book)
            _blocs_visuels(store, c, data_dir)
            ui.rule()

        # --- modifier une thèse (modification totale, sans marquage)
        if vivantes:
            with st.expander("Modifier une thèse"):
                noms = {c.display_name: cid for cid, c in vivantes.items()}
                cible = st.selectbox("Thèse à modifier", ["— aucune —"] + list(noms),
                                     key="edit_camp_pick")
                if cible != "— aucune —":
                    _form(store, existing=vivantes[noms[cible]])

        # --- abandonner une thèse
        # Marquée, jamais effacée : le journal est append-only. Une thèse
        # abandonnée disparaît des vues et des statistiques, mais la donnée reste.
        if vivantes:
            with st.expander("Abandonner une thèse"):
                st.markdown(
                    '<div class="note">La thèse sort des vues et des statistiques. '
                    'Ses idées, elles, ne sont pas touchées : elles redeviennent '
                    'simplement autonomes et comptent pour elles-mêmes.</div>',
                    unsafe_allow_html=True)
                noms = {c.display_name: cid for cid, c in vivantes.items()}
                cible = st.selectbox("Thèse à abandonner",
                                     ["— aucune —"] + list(noms),
                                     key="abandon_camp_pick")
                if cible != "— aucune —":
                    ok = st.checkbox(f"Je confirme l'abandon de « {cible} »",
                                     key="abandon_camp_ok")
                    if st.button("Abandonner", key="abandon_camp_btn",
                                 disabled=not ok):
                        store.abandon_campaign(noms[cible])
                        st.rerun()

        abandonnees = [c for c in campaigns.values()
                       if getattr(c, "abandoned", False)]
        if abandonnees:
            st.markdown(
                f'<div class="note">{len(abandonnees)} thèse(s) abandonnée(s), '
                f'conservée(s) dans le journal.</div>', unsafe_allow_html=True)
