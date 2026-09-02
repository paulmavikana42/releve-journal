"""
Réglages : les comptes et leurs règles, la watchlist, l'horloge du broker.

Tout ce qui est ici vit dans `data/settings.json` — le fichier qui se retape en
deux minutes. Rien de ce qui est ici n'est irremplaçable.

Ce qui l'est, c'est `data/` : le journal `events.jsonl` et les captures. Il n'y
a plus de bouton de sauvegarde dans l'application — la sauvegarde est une COPIE
DU DOSSIER, faite hors de l'outil (le geste qui protège d'une machine morte, pas
d'un fichier corrompu). Le manuel le dit à la section « Tes données ».
"""
from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

import streamlit as st

from core import clock, migration, onboarding, paths, prop, symbols
from core.store import Store
from .. import theme as T
from .. import ui
from .account_form import rules_form


def _compte_form(rules: prop.PropRules, index: int, total: int):
    """
    Le formulaire d'un compte, entièrement éditable — c'est le MÊME que celui de
    l'onboarding (account_form.rules_form), pour que rien ne diverge. On ajoute
    juste, ici, le numéro de compte du broker (l'onboarding ne le connaît pas
    encore : il arrive au premier import).
    """
    titre = f"{rules.label or 'Compte'}"
    if rules.account_id:
        titre += f" · {rules.account_id}"
    with st.expander(titre, expanded=(total == 1 or index == 0)):
        acct = st.text_input(
            "N° de compte (broker)", value=rules.account_id, key=f"acc_{index}",
            help="Il rapproche les tickets d'un export multi-comptes. C'est le "
                 "numéro exact du broker. (Le cloisonnement, lui, ne dépend pas "
                 "de ce champ : il repose sur un identifiant interne stable.)")
        saisi = replace(rules_form(f"set{index}", existing=rules),
                        account_id=acct.strip())
        # Le bouton d'enregistrement vit DANS le conteneur du compte qu'on
        # modifie — pas dans une barre commune en bas (#203).
        clic = st.button("Enregistrer les règles", type="primary",
                         key=f"save_{index}")
        return saisi, clic


def render(store: Store, data_dir):
    ui.title("Réglages",
             "Les comptes et leurs règles, ta watchlist, l'horloge du broker. "
             "Rien d'irremplaçable ici — le dossier data/, si.")

    comptes = prop.accounts()

    ui.eyebrow("comptes et règles")
    st.markdown(
        '<div class="note">Les règles sont <b>contractuelles</b> : elles changent '
        'd\'une firme à l\'autre, et parfois d\'un challenge à l\'autre chez la même '
        'firme. Elles se paramètrent ici plutôt que d\'être codées en dur — un '
        'chiffre en dur qui ne correspond pas à ton contrat est pire que pas de '
        'chiffre du tout.</div>', unsafe_allow_html=True)

    resultats = [_compte_form(r, n, len(comptes)) for n, r in enumerate(comptes)]
    saisis = [x[0] for x in resultats]
    if any(x[1] for x in resultats):
        prop.save_accounts(saisis)
        st.success("Règles enregistrées.")
        st.rerun()

    # Ajouter / Supprimer restent SOUS les comptes, position inchangée (#203).
    if st.button("Ajouter un compte"):
        prop.save_accounts(list(saisis) + [prop.PropRules(label="Nouveau compte")])
        st.rerun()

    # --- supprimer un compte -------------------------------------------------
    # Retire ses RÈGLES de la configuration. Le journal (append-only) n'est PAS
    # touché : les idées de ce compte restent dans le fichier. Pour tout effacer,
    # c'est la remise à zéro plus bas. On garde toujours au moins un compte.
    if len(comptes) > 1:
        with st.expander("Supprimer un compte"):
            st.markdown(
                '<div class="note">Retire ce compte et ses règles de la '
                'configuration. <b>Le journal n\'est pas effacé</b> (il est '
                'append-only) — les idées de ce compte restent dans le fichier. '
                'Pour tout supprimer, utilise la remise à zéro plus bas.</div>',
                unsafe_allow_html=True)
            idx = st.selectbox(
                "Compte à supprimer", list(range(len(comptes))),
                index=None, placeholder="— choisir un compte —",
                format_func=lambda n: comptes[n].label
                + (f" · {comptes[n].account_id}" if comptes[n].account_id else ""),
                key="del_compte_pick")
            if idx is not None:
                nom = comptes[idx].label
                ok = st.checkbox(f"Je confirme la suppression de « {nom} »",
                                 key="del_compte_ok")
                if st.button("Supprimer ce compte", key="del_compte_btn",
                             type="primary", disabled=not ok):
                    restants = [r for n, r in enumerate(saisis) if n != idx]
                    prop.save_accounts(restants)
                    for cle in ("compte_pick", "del_compte_pick", "del_compte_ok"):
                        st.session_state.pop(cle, None)
                    st.success(f"Compte « {nom} » supprimé.")
                    st.rerun()

    ui.rule()

    # --- watchlist
    ui.eyebrow("watchlist")
    st.markdown(
        '<div class="note">Les symboles proposés à l\'écriture d\'une idée. '
        'Tu penses « BRENT », ton broker écrit « UKOUSD » : c\'est <b>son</b> nom '
        'qui doit être ici, sinon une idée planifiée part en hors-plan. Tout '
        'symbole importé s\'ajoute automatiquement.</div>', unsafe_allow_html=True)
    actuelle = ", ".join(symbols.watchlist())
    saisie = st.text_area("Symboles (séparés par des virgules)", value=actuelle,
                          height=68)
    if st.button("Enregistrer la watchlist"):
        symbols.set_watchlist(saisie.split(","))
        st.success("Watchlist enregistrée.")
        st.rerun()

    ui.rule()

    # --- où vivent les données, ce qu'on peut y reprendre, et la remise à zéro
    # Placé AVANT l'horloge : la page doit se terminer sur elle.
    _donnees(store)

    ui.rule()

    # --- horloge
    ui.eyebrow("horloge du serveur")
    st.markdown(
        '<div class="note">Tout le domaine vit en <b>heure serveur</b>, sans fuseau. '
        'Un décalage faux ferait paraître une idée écrite deux heures avant le trade '
        'comme <i>postérieure</i> — et l\'outil classerait en hors-plan un trade que '
        'tu avais planifié. FundedNext : UTC+3.</div>', unsafe_allow_html=True)
    offset = st.number_input("Décalage du serveur (heures vs UTC)",
                             min_value=-12, max_value=14,
                             value=clock.server_utc_offset())
    c1, c2 = st.columns([1, 2])
    if c1.button("Enregistrer l'horloge"):
        clock.set_server_utc_offset(int(offset))
        st.success(f"Heure serveur : UTC{int(offset):+d}.")
        st.rerun()
    c2.markdown(f'<div class="note">Il est actuellement '
                f'<b class="mono">{clock.server_now():%d/%m/%Y %H:%M}</b> '
                f'chez ton broker.</div>', unsafe_allow_html=True)

    ui.rule()


def _donnees(store: Store):
    """Où vivent les données, comment en reprendre un, comment tout refaire."""
    ui.eyebrow("tes données")
    st.markdown(
        '<div class="note">Sauvegarde régulièrement ton dossier de données '
        '(journal + captures) — sur une clé, un disque externe, ton cloud. '
        'Le logiciel, lui, se réinstalle ; tes idées annotées année après année, non.'
        + (' <b>Tu es en mode démonstration :</b> ces données seront supprimées à ton premier import.' if onboarding.demo_mode() else '')
        + '</div>', unsafe_allow_html=True)

    with st.expander("Reprendre un journal existant"):
        st.markdown(
            '<div class="note">Tu as déjà un <code>events.jsonl</code> écrit par '
            'une version précédente ? Dépose-le ici. <b>Il n\'y a rien à '
            'convertir</b> : le format n\'a jamais changé, il a grandi. Un champ '
            'absent prend sa valeur par défaut, un événement inconnu est ignoré '
            'sans faire tomber le reste.</div>', unsafe_allow_html=True)

        fichier = st.file_uploader("Journal (.jsonl)", type=["jsonl", "json", "txt"],
                                   key="mig_file")
        if fichier is not None:
            try:
                ap = migration.inspect(fichier.getvalue())
            except migration.MigrationError as e:
                st.error(str(e))
            else:
                c1, c2, c3, c4 = st.columns(4)
                with c1:
                    ui.stat("Événements", str(ap.evenements),
                            note=f"{ap.illisibles} ligne(s) illisible(s)"
                                 if ap.illisibles else "toutes lisibles")
                with c2:
                    ui.stat("Idées", str(ap.idees), note=f"{ap.reviews} review(s)")
                with c3:
                    ui.stat("Tickets", str(ap.tickets), note="positions importées")
                with c4:
                    periode = "—"
                    if ap.premiere and ap.derniere:
                        periode = (f"{ap.premiere:%d/%m/%y} → "
                                   f"{ap.derniere:%d/%m/%y}")
                    ui.stat("Période", periode, note="d'après les horodatages")

                if ap.types_inconnus:
                    st.warning(
                        "Types d'événements que cette version ne connaît pas : "
                        + ", ".join(sorted(ap.types_inconnus))
                        + ". Ils seront conservés dans le fichier mais ignorés à "
                          "la lecture — ils viennent probablement d'une version "
                          "plus récente.")
                if ap.demo:
                    st.warning(
                        f"{ap.demo} événement(s) de ce fichier sont marqués "
                        f"« démonstration ». Ils seront repris tels quels : "
                        f"vérifie que c'est bien ton journal.")

                actuel = migration.inspect_actuel_count(store)
                st.markdown(
                    f'<div class="note">Ton journal actuel contient '
                    f'<b>{actuel} événement(s)</b>.</div>',
                    unsafe_allow_html=True)

                mode = st.radio(
                    "Que faire ?",
                    ["Remplacer mon journal actuel par ce fichier",
                     "Ajouter ce fichier à mon journal actuel"],
                    key="mig_mode")
                st.markdown(
                    '<div class="note">Remplacer est le cas normal (« voilà mon '
                    'vrai journal »). Ajouter sert quand deux machines ont chacune '
                    'une moitié de l\'histoire : les lignes identiques ne sont pas '
                    'reprises deux fois. <b>Dans les deux cas, ton journal actuel '
                    'est sauvegardé à côté avant d\'être touché.</b></div>',
                    unsafe_allow_html=True)

                if st.button("Installer ce journal", type="primary", key="mig_go"):
                    ap2, ecrites, sauvegarde = migration.install(
                        fichier.getvalue(),
                        mode="remplacer" if mode.startswith("Remplacer") else "ajouter")
                    message = f"{ecrites} ligne(s) installée(s)."
                    if sauvegarde:
                        message += f" Ancien journal conservé : {sauvegarde.name}."
                    st.success(message)
                    for cle in ("nav", "idea_id", "view_idea", "view_origin",
                                "period_label"):
                        st.session_state.pop(cle, None)
                    st.rerun()

    with st.expander("Tout recommencer à zéro"):
        st.markdown(
            f'<div class="note">Remet l\'outil dans l\'état du premier '
            f'lancement : journal, réglages et compte. Ton journal actuel n\'est '
            f'<b>pas supprimé</b> — il est renommé et laissé dans le dossier, '
            f'daté. Quelqu\'un qui clique ça à 2 h du matin ne mérite pas de '
            f'perdre trois ans d\'idées sur un malentendu.</div>',
            unsafe_allow_html=True)
        confirme = st.checkbox("J'ai compris, je veux tout recommencer",
                               key="reset_ok")
        if st.button("Tout recommencer", disabled=not confirme, key="reset_btn"):
            onboarding.reset_all(backup=True)
            for cle in list(st.session_state.keys()):
                del st.session_state[cle]
            st.rerun()
