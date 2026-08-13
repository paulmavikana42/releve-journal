"""
Le premier lancement.

Un écran, deux questions, et on n'y revient jamais. C'est le seul moment où
l'outil a le droit de demander quoi que ce soit avant de servir à quelque chose.

Ce qu'il ne fait PAS, volontairement :
  - il ne suppose pas que tu es chez FundedNext avec 100 000 $. Coder ces
    chiffres en dur produisait des jauges fausses dès le second utilisateur, et
    une jauge fausse est pire qu'une jauge absente ;
  - il ne remplit pas ton journal en douce. La démonstration, si tu la choisis,
    vit dans son PROPRE fichier et disparaît à ton premier import réel.
"""
from __future__ import annotations

from decimal import Decimal

import streamlit as st

from core import onboarding, prop
from core.store import Store
from .. import theme as T
from .. import ui
from .account_form import rules_form


def render():
    """Renvoie True si l'écran a fait son travail et qu'il faut recharger."""
    st.markdown(
        f'<div style="display:flex;align-items:center;gap:14px;margin-bottom:6px">'
        f'<div style="width:44px;height:44px;border-radius:12px;background:{T.ACCENT};'
        f'color:{T.ACCENT_INK};font-family:{T.FONT_TITLE};font-weight:700;'
        f'font-size:1.4rem;display:flex;align-items:center;justify-content:center">R</div>'
        f'<div><div style="font-family:{T.FONT_TITLE};font-weight:600;'
        f'font-size:2rem;line-height:1">Bienvenue dans Relev'
        f'<span style="color:{T.ACCENT}">é</span></div></div></div>',
        unsafe_allow_html=True)
    st.markdown(
        '<div class="subtitle">Un journal de trading qui peut te contredire. '
        'Deux réponses et c\'est parti — ça ne se redemande jamais.</div>',
        unsafe_allow_html=True)

    st.markdown(
        f'<div class="card" style="border-left:3px solid {T.ACCENT}">'
        f'<div class="eyebrow">comment ça marche, en une phrase</div>'
        f'<div class="note">Tu écris ton idée <b>avant</b> d\'entrer, tu déclares '
        f'le numéro de ticket au moment où tu entres, et à la sortie tu déposes '
        f'l\'export de ton terminal : l\'outil retrouve ce ticket et referme le '
        f'trade tout seul. Rien ne part sur internet, tout reste sur cet '
        f'ordinateur.</div></div>', unsafe_allow_html=True)

    ui.rule()
    ui.eyebrow("1 · ton compte")
    st.markdown(
        '<div class="note">Ces chiffres sont ceux de <b>ton contrat</b>. Tu ne '
        'les connais pas encore ? Mets ce que tu veux : <b>tout se corrige dans '
        'Réglages</b>. Compte personnel sans prop firm : laisse les limites, '
        'elles serviront simplement d\'alerte.</div>', unsafe_allow_html=True)
    regles = rules_form("welcome")

    ui.rule()
    ui.eyebrow("2 · par quoi commencer")

    gauche, droite = st.columns(2)

    with gauche:
        st.markdown(
            '<div class="card" style="min-height:190px">'
            '<b>Journal vierge</b>'
            '<div class="note" style="margin-top:8px">Rien dedans. Tu écris ta '
            'première idée quand tu veux, et l\'outil se remplit au fil de tes '
            'trades.<br><br>C\'est le choix normal si tu comptes t\'en servir '
            'pour de vrai dès maintenant.</div></div>', unsafe_allow_html=True)
        if st.button("Commencer avec un journal vierge", type="primary",
                     use_container_width=True, key="w_blank"):
            onboarding.start_blank()
            prop.save_accounts([regles])
            st.session_state["nav"] = "Idée"
            return True

    with droite:
        st.markdown(
            '<div class="card" style="min-height:190px">'
            '<b>Avec des données de démonstration</b>'
            '<div class="note" style="margin-top:8px">Deux trades clôturés '
            '(dont un pyramidé et relu) et un trade en cours, pour voir à quoi '
            'ressemblent les écrans. Tout est <b>inventé</b> : compte fictif, '
            'tickets fictifs.<br><br>Ces données vivent à part et sont '
            '<b>supprimées</b> à ton premier import — ton journal ne les '
            'contiendra jamais.</div></div>',
            unsafe_allow_html=True)
        if st.button("Découvrir avec la démonstration", use_container_width=True,
                     key="w_demo"):
            chemin = onboarding.start_demo()
            store = Store(chemin, demo=True)
            if not store.events():
                try:
                    from seed_demo import seed
                    seed(store, verbose=False)
                except Exception as e:      # fixture absente d'une build allégée
                    st.warning(
                        f"La démonstration n'a pas pu être construite ({e}). "
                        f"Le journal démarre vierge — ça ne change rien à la "
                        f"suite.")
                    onboarding.start_blank()
            prop.save_accounts([regles])
            st.session_state["nav"] = "Tableau de bord"
            return True

    # Rien de plus. L'emplacement du dossier de données n'a rien à faire ici :
    # personne n'a besoin d'un chemin technique avant d'avoir vu un seul écran.
    # Il est dans Réglages → « tes données », au moment où il devient utile.
    return False
