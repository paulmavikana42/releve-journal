"""
Point d'entrée.

    streamlit run app/main.py

Tourne en local, dans ton navigateur. Aucune donnée ne quitte ta machine :
pas d'API, pas de cloud, pas de compte. Tu peux couper le Wi-Fi.
"""
from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.specs import SpecBook               # noqa: E402
from core.store import Store                  # noqa: E402
from core import challenge as C               # noqa: E402
from core import onboarding as O              # noqa: E402
from core import paths                        # noqa: E402
from core import prop as P                    # noqa: E402
from app import theme as T                    # noqa: E402
from app import ui                            # noqa: E402
from app.views import (                       # noqa: E402
    campaigns, compliance, dashboard, detail, ideas, importer, settings, welcome,
)

# Le dossier de données n'est PAS celui du programme : voir core/paths.py. Un
# .exe installé dans Program Files n'a pas le droit d'écrire à côté de lui.
DATA = paths.data_dir()

st.set_page_config(page_title="Relevé", layout="wide",
                   initial_sidebar_state="expanded")
st.markdown(T.CSS, unsafe_allow_html=True)

# --- LA CAUSE DES « NotFoundError : removeChild » ------------------------
# Chrome prenait la page pour de l'anglais et la TRADUISAIT automatiquement —
# « Compliance prop » devenait « Hélice de conformité », « conviction »
# devenait « Condamnation ». Le traducteur remplace les nœuds de texte dans le
# DOM ; React, qui croit encore les tenir, échoue ensuite à les retirer et lève
# « Le nœud à supprimer n'est pas un enfant de ce nœud ».
#
# Aucune correction côté Streamlit ne pouvait y faire quoi que ce soit : le
# coupable était le navigateur. On déclare donc la langue et on interdit la
# traduction. Le composant tourne dans une iframe de même origine, d'où l'accès
# au document parent — c'est le seul moyen d'atteindre <html> depuis Streamlit.
components.html(
    """<script>
    const d = window.parent.document;
    d.documentElement.lang = 'fr';
    d.documentElement.classList.add('notranslate');
    d.documentElement.setAttribute('translate', 'no');
    if (!d.querySelector('meta[name="google"][content="notranslate"]')) {
        const m = d.createElement('meta');
        m.name = 'google'; m.content = 'notranslate';
        d.head.appendChild(m);
    }
    </script>""", height=0, width=0)

# --- premier lancement --------------------------------------------------
# Tant que le choix « vierge ou démonstration » n'a pas été fait, l'application
# ne montre RIEN d'autre : un écran d'accueil à moitié rempli de données qu'on
# n'a pas demandées est la meilleure façon de perdre quelqu'un dès la première
# minute.
if not O.configured():
    if welcome.render():
        st.rerun()
    st.stop()

# --- navigation différée -----------------------------------------------
# Un st.rerun() appelé au milieu d'un rendu (typiquement après la sélection
# d'un point Plotly, qui rerun déjà) casse le DOM : NotFoundError removeChild.
# Les demandes de navigation sont donc déposées dans l'état, et consommées ICI,
# avant que le moindre élément ne soit dessiné.
_pending = st.session_state.pop("pending_nav", None)
if _pending:
    _page, _idea = _pending
    st.session_state["nav"] = _page
    if _idea:
        st.session_state["idea_id"] = _idea

# Le journal courant : celui de démonstration tant qu'on n'a pas importé de
# vrais trades, le vrai ensuite. Deux fichiers distincts, jamais mélangés.
DEMO = O.demo_mode()
store = Store(O.current_journal(), demo=DEMO)
ideas_map, positions_map, deals = store.load()
campaigns_all = store.campaigns()
all_positions = list(positions_map.values())
spec_book = SpecBook(all_positions)

comptes = P.accounts()

# --- le compte actif ------------------------------------------------------
# Deux challenges ne partagent ni leurs règles ni leurs statistiques. Le compte
# est donc lu AVANT tout le reste : il conditionne le filtrage des idées, les
# règles de compliance et le capital de référence.
#
# Le sélecteur, lui, est rendu tout en BAS du rail (bloc « compte »). On lit
# donc ici la valeur laissée par le passage précédent : changer de compte
# déclenche un rerun, et ce rerun repasse par cette ligne avec la bonne valeur.
_libelles = {f"{c.label}" + (f" · {c.account_id}" if c.account_id else ""): c
             for c in comptes}
# Un compte renommé ou supprimé dans les Réglages laisserait dans l'état une
# valeur qui n'est plus une option — Streamlit lève alors une exception au
# rendu du menu. On nettoie AVANT que le menu n'existe.
if st.session_state.get("compte_pick") not in _libelles:
    st.session_state.pop("compte_pick", None)
compte = _libelles.get(st.session_state.get("compte_pick"), comptes[0])
st.session_state["account_id"] = compte.account_id

# --- cloisonnement par compte (règle testée : core.prop.belongs_to)
# Idées ET thèses : deux challenges ne partagent RIEN. Une thèse sans compte
# (journal d'avant le multi-comptes) reste rattachée au premier, comme les idées.
_defaut = comptes[0].account_id
all_ideas = sorted(
    (i for i in ideas_map.values()
     if len(comptes) == 1 or P.belongs_to(i, compte.account_id, _defaut)),
    key=lambda i: i.created_at, reverse=True)
campaigns_map = {
    cid: c for cid, c in campaigns_all.items()
    if len(comptes) == 1 or P.belongs_to(c, compte.account_id, _defaut)}
# Les transactions du broker (courbe de solde MESURÉE, Sharpe, calendrier) : elles
# aussi cloisonnées, sinon la compliance d'un compte lirait le solde d'un autre.
deals_view = [d for d in deals
              if len(comptes) == 1 or P.belongs_to(d, compte.account_id, _defaut)]

# Version affichée dans le rail : quand un testeur remonte un bug, elle dit sur
# QUELLE build il était. À incrémenter à chaque envoi.
VERSION = "27 juillet 2026"

# ------------------------------------------------------------------- sidebar

with st.sidebar:
    st.markdown(
        f'<div style="display:flex;align-items:center;gap:10px;margin-bottom:2px">'
        f'<div style="width:30px;height:30px;border-radius:8px;background:{T.ACCENT};'
        f'color:{T.ACCENT_INK};font-family:{T.FONT_TITLE};font-weight:700;'
        f'display:flex;align-items:center;justify-content:center">R</div>'
        f'<div style="font-family:{T.FONT_TITLE};font-weight:600;font-size:1.25rem;'
        f'color:{T.RAIL_TEXT}">Relev<span style="color:{T.ACCENT}">é</span></div></div>'
        f'<div class="note">Journal d\'idées</div>',
        unsafe_allow_html=True)

    ui.rule()

    # La fiche d'une idée n'est PAS une entrée du rail : on y entre en cliquant
    # une idée (liste ou histogramme), et le bouton « retour » ramène à la
    # section d'origine. Le rail reste donc stable, six sections, toujours les
    # mêmes — plus de point « Idée » qui apparaît en bas quand on manipule.
    pages = ["Tableau de bord", "Idée", "Thèses", "Compliance prop",
             "Import", "Réglages"]

    # key="nav" : la valeur du widget EST st.session_state["nav"]. Toute
    # navigation programmatique (pending_nav, bouton retour, onboarding) écrit
    # cette clé TOUT EN HAUT du script, avant que le widget n'existe, et le rail
    # suit du premier coup. L'ancienne version recalculait `index` à chaque run :
    # l'identité du widget changeait, Streamlit le réinitialisait, et il fallait
    # parfois cliquer deux fois. Un radio à clé stable ne saute plus.
    if st.session_state.get("nav") not in pages:
        st.session_state["nav"] = "Tableau de bord"
    nav = st.radio("Navigation", pages, key="nav", label_visibility="collapsed")

    ui.rule()

    orphans = [p for p in store.orphans()
               if len(comptes) == 1 or P.belongs_to(p, compte.account_id, _defaut)]
    running = [i for i in all_ideas if i.is_running]
    to_review = [i for i in all_ideas
                 if i.is_executed and not i.is_running and i.review is None]
    missing_stops = [i for i in all_ideas if i.is_executed and i.tickets_needing_stop()]

    # UN SEUL bloc de markdown : une boucle produit N éléments distincts, et
    # quand N change React échoue à réconcilier la liste (NotFoundError
    # « removeChild »). Un élément unique dont le contenu varie ne pose jamais
    # ce problème.
    alertes = []
    if running:
        alertes.append(f'<div class="chip acc">{len(running)} trade(s) en cours</div>')
    if orphans:
        alertes.append(f'<div class="chip warn">{len(orphans)} ticket(s) à rattacher</div>')
    if missing_stops:
        alertes.append(f'<div class="chip bad">{len(missing_stops)} idée(s) sans R</div>')
    if to_review:
        alertes.append(f'<div class="chip sig">{len(to_review)} review(s) à faire</div>')
    if alertes:
        st.markdown("".join(alertes), unsafe_allow_html=True)
        ui.rule()

    # --- la période d'analyse : une lentille posée sur le journal, pas un
    # stockage séparé. Elle vit dans le rail parce qu'elle vaut pour toutes les
    # pages, pas seulement pour le tableau de bord.
    periods = C.available_periods(all_ideas)
    if len(periods) > 1:
        labels = [p.label for p in periods]
        defaut = st.session_state.get("period_label", labels[0])
        choix = st.selectbox("Période", labels,
                             index=labels.index(defaut) if defaut in labels else 0,
                             key="period_select")
        st.session_state["period_label"] = choix
        periode = next(p for p in periods if p.label == choix)
    else:
        periode = periods[0] if periods else C.Period()
    ui.rule()

    # --- LE PIED DU RAIL : le compte actif, et le moyen d'en changer.
    #
    # Il n'y a PAS de déconnexion à offrir : l'outil tourne en local, sans
    # compte utilisateur, sans serveur et sans mot de passe. Il n'y a rien à
    # quitter — et un bouton « Déconnexion » qui ne déconnecte de rien serait un
    # mensonge d'interface. Ce qui existe vraiment, c'est le compte de TRADING :
    # c'est lui qu'on change ici.
    #
    # (Le chemin du journal et son compteur d'événements ont déménagé sur la
    # page Réglages, section Sauvegarde, où ils sont actionnables.)
    initiales = "".join(m[0] for m in compte.label.split()[:2]).upper() or "R"
    st.markdown(
        f'<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
        f'<div style="width:34px;height:34px;border-radius:50%;'
        f'background:{T.rgba(T.ACCENT, 0.18)};color:{T.ACCENT};'
        f'font-family:{T.FONT_MONO};font-weight:700;font-size:0.78rem;'
        f'display:flex;align-items:center;justify-content:center;flex:0 0 auto">'
        f'{initiales}</div>'
        f'<div style="min-width:0">'
        f'<div style="font-weight:600;color:{T.RAIL_TEXT}">{compte.label}</div>'
        f'<div class="note">'
        f'{compte.broker or "compte de trading"}'
        f'{" · " + compte.account_id if compte.account_id else ""}</div>'
        f'</div></div>', unsafe_allow_html=True)

    if DEMO:
        st.markdown(
            f'<div class="chip acc" style="display:block;text-align:center;'
            f'margin-bottom:8px">démonstration</div>'
            f'<div class="note" style="margin-bottom:10px">Ces données sont '
            f'fabriquées. Elles seront <b>supprimées</b> à ton premier import — '
            f'ton vrai journal ne les contiendra jamais.</div>',
            unsafe_allow_html=True)

    if len(comptes) > 1:
        st.selectbox("Changer de compte", list(_libelles), key="compte_pick",
                     label_visibility="collapsed",
                     help="Chaque compte a ses propres règles, ses propres "
                          "statistiques et son propre journal d'idées. Rien ne "
                          "se mélange.")
    if st.button("Gérer les comptes", key="go_reglages",
                 use_container_width=True):
        st.session_state["pending_nav"] = ("Réglages", None)
        st.rerun()

    st.markdown(
        f'<div class="note" style="margin-top:14px;text-align:center;'
        f'opacity:.55;font-size:0.78rem">Relevé · version {VERSION}</div>',
        unsafe_allow_html=True)

# ---------------------------------------------------------------------- pages

EQUITY_REF = compte.start_balance    # capital de référence du compte actif

# --- overlay « fiche d'une idée » ----------------------------------------
# On y entre en cliquant une idée (liste ou histogramme). Le bouton retour
# ramène EXACTEMENT à la section d'où l'on vient — dashboard, liste… — et jamais
# vers la fiche elle-même. C'est la logique « petite section ouverte depuis une
# grande » : on ressort par la grande.
_view = st.session_state.get("view_idea")
_idea_obj = ideas_map.get(_view) if _view else None

if _idea_obj is not None:
    _origin = st.session_state.get("view_origin", "Tableau de bord")
    if st.button("← Retour", key="back_from_idea"):
        st.session_state.pop("view_idea", None)
        # On mémorise l'ancre de la section d'où l'on venait, pour re-scroller
        # EXACTEMENT là (ex. « tes idées, une par barre » du dashboard).
        st.session_state["scroll_anchor"] = st.session_state.pop("view_anchor", None)
        st.session_state["pending_nav"] = (_origin, None)
        st.rerun()
    detail.render(store, _idea_obj, spec_book, EQUITY_REF, campaigns_map,
                  data_dir=DATA)

elif nav == "Tableau de bord":
    dashboard.render(all_ideas, deals_view, spec_book, EQUITY_REF,
                     period=periode, orphans=orphans,
                     to_review=to_review, missing_stops=missing_stops,
                     campaigns=campaigns_map, account_label=compte.label)

elif nav == "Idée":
    ideas.render(store, all_ideas, spec_book, data_dir=DATA,
                 account_id=compte.account_id, campaigns=campaigns_map)

elif nav == "Thèses":
    campaigns.render(store, campaigns_map, spec_book, data_dir=DATA,
                     account_id=compte.account_id)

elif nav == "Compliance prop":
    compliance.render(all_ideas, deals_view, compte, spec_book)

elif nav == "Import":
    importer.render(store, all_ideas, account_id=compte.account_id)

elif nav == "Réglages":
    settings.render(store, DATA)

# --- restauration de la position de défilement ---------------------------
# Au retour d'une fiche d'idée, on re-scrolle EXACTEMENT à la section d'où l'on
# venait (l'histogramme du dashboard, la liste des idées…). La page vient d'être
# rendue : l'ancre existe, on la rejoint sans animation pour que ce soit
# instantané et invisible.
_anchor = st.session_state.pop("scroll_anchor", None)
_changed = (not _idea_obj) and (nav != st.session_state.get("_last_nav"))
if _anchor:
    # retour depuis une fiche : on rejoint la section exacte d'origine
    components.html(
        f"""<script>
        const d = window.parent.document;
        const el = d.getElementById('{_anchor}');
        if (el) el.scrollIntoView({{behavior: 'instant', block: 'start'}});
        </script>""", height=0, width=0)
elif _changed:
    # changement de section : on repart du HAUT, sinon on atterrit au milieu de
    # la nouvelle page — c'est ça, la saccade.
    components.html(
        """<script>window.parent.scrollTo({top: 0, behavior: 'instant'});</script>""",
        height=0, width=0)
if not _idea_obj:
    st.session_state["_last_nav"] = nav
