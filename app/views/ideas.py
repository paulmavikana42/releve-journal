"""
Le JOURNAL : la liste des idées, et la rédaction d'une idée.

Vocabulaire : tu écris une IDÉE (un instrument, un stop, une conviction).
Plusieurs idées peuvent ensuite se regrouper sous une THÈSE (macro,
multi-instruments), page « Thèses ».

L'idée s'écrit AVANT d'entrer. C'est ce qui la rend falsifiable — et c'est la
seule source possible pour ton stop initial, que le broker n'archive pas.

LE CYCLE, tel qu'il se déroule vraiment :

    tu écris l'idée (thèse, invalidation, captures)     -> armée
    tu entres, tu déclares le ticket                     -> EN COURS
    le trade vit dans l'outil, tu ajoutes des captures   -> EN COURS
    tu sors, tu déposes l'export CSV                     -> clôturée
    tu relis                                             -> revue, et dans les stats

La déclaration d'ouverture est le maillon qui manquait : sans elle, un trade en
cours n'existe nulle part et le stop réellement placé est perdu au premier
breakeven.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Optional

import streamlit as st

from core import captures as CAP
from core import clock
from core.models import (
    CaptureKind, Direction, Idea, IdeaStatus, RiskSource, Thesis,
)
from core import symbols
from core.store import Store
from .. import theme as T
from .. import ui

THEMES = [
    "", "Fed / taux US", "BCE / zone euro", "BoJ / yen", "Inflation / CPI",
    "Emploi / NFP", "Risk-off géopolitique", "Flux COT / positionnement",
    "Énergie / matières premières", "Crypto — liquidité", "Autre",
]

SETUPS = [
    "", "Cassure de structure", "Retest de zone", "Range — extrémité",
    "Divergence", "Liquidity grab", "Continuation de tendance", "Autre",
]

TIMEFRAMES = ["", "M15", "H1", "H4", "D1", "W1"]


def _joindre_captures(store: Store, data_dir, owner_type: str, owner_id: str,
                      fichiers, kind: CaptureKind, legende: str = "") -> int:
    """
    Enregistre N captures et journalise chacune. Renvoie le nombre joint.

    L'écriture disque précède TOUJOURS l'événement : un événement écrit alors
    que le fichier a échoué laisserait une capture fantôme dans le journal, et
    le journal est append-only — on ne peut pas revenir dessus.
    """
    n = 0
    for f in fichiers or []:
        try:
            att = CAP.save(data_dir, owner_type, owner_id, f.name, f.getvalue(),
                           kind=kind, caption=legende)
        except CAP.CaptureError as e:
            st.error(f"{f.name} : {e}")
            continue
        store.add_capture(att)
        n += 1
    return n


def _form(store: Store, data_dir, account_id: str = "",
          existing: Optional[Idea] = None, campaigns: Optional[dict] = None):
    t = existing.thesis if existing else None
    titre = "Modifier l'idée" if existing else "Écrire une idée"

    st.markdown(f"## {titre}")

    with st.form(f"thesis_{existing.id if existing else 'new'}",
                 clear_on_submit=not existing):
        # Le symbole ne se tape plus à la main : il se choisit dans TA liste.
        # Taper « BRENT » quand le broker écrit UKOUSD envoyait le trade en
        # hors-plan alors qu'il était planifié — la métrique la plus dure de
        # l'outil s'en trouvait faussée.
        choices = symbols.known()
        current = (t.instrument or "").upper() if t else ""
        if current and current not in choices:
            choices = [current] + choices      # ne jamais perdre une valeur existante

        c1, c2, c3 = st.columns([1.4, 1, 1])
        instrument = c1.selectbox(
            "Instrument", choices,
            index=choices.index(current) if current in choices else 0,
            help="Ta watchlist. Tout symbole importé s'y ajoute automatiquement — "
                 "c'est le nom exact du broker qui fait foi.")
        direction = c2.selectbox("Sens", ["sell", "buy"],
                                 index=0 if not t or t.direction == Direction.SELL else 1)
        conviction = c3.slider("Conviction", 1, 5, t.conviction if t and t.conviction else 3)

        ui.rule()
        ui.eyebrow("l'idée fonda")
        c1, c2 = st.columns([1, 1])
        macro_theme = c1.text_input("Thème", value=t.macro_theme if t else "",
                                    placeholder="ex. Fed / taux US, dollar fort, risk-off…",
                                    help="Catégoriel : c'est ce qui rend tes idées agrégeables. "
                                         "Écris-le librement — mais réutilise les MÊMES mots d'une "
                                         "idée à l'autre pour qu'elles se regroupent.")
        catalyst = c2.text_input("Catalyseur attendu", value=t.catalyst if t else "",
                                 placeholder="CPI US du 15/07")
        macro_note = st.text_area("Développement", value=t.macro_note if t else "",
                                  height=80, placeholder="Pourquoi le marché a tort.")

        ui.rule()
        ui.eyebrow("la structure technique")
        c1, c2 = st.columns([1, 1])
        setup = c1.selectbox("Setup", SETUPS,
                             index=SETUPS.index(t.setup) if t and t.setup in SETUPS else 0)
        timeframe = c2.selectbox("Unité de temps", TIMEFRAMES,
                                 index=TIMEFRAMES.index(t.timeframe) if t and t.timeframe in TIMEFRAMES else 0)
        technical_note = st.text_area("Ce qui me fait entrer", value=t.technical_note if t else "",
                                      height=68)

        ui.rule()
        ui.eyebrow("le risque")
        st.markdown(
            '<div class="note">Le <b>stop initial</b> est le seul champ indispensable. '
            "Ton broker n'archive que ton <i>dernier</i> stop : dès que tu passes au "
            "breakeven, ton risque d'origine est perdu pour toujours. Il ne peut venir "
            "que d'ici.</div>", unsafe_allow_html=True)

        c1, c2, c3 = st.columns(3)
        entry = c1.number_input("Entrée visée", value=float(t.entry_planned) if t and t.entry_planned else 0.0,
                                step=0.01, format="%.5f")
        stop = c2.number_input("Stop initial", value=float(t.stop_initial) if t and t.stop_initial else 0.0,
                               step=0.01, format="%.5f")
        risk_pct = c3.number_input("Risque visé (%)", min_value=0.0, max_value=10.0,
                                   value=float(t.risk_pct) if t and t.risk_pct else 0.5,
                                   step=0.1, format="%.2f",
                                   help="Ne sert pas au calcul du R. Sert de contrôle croisé : "
                                        "l'outil compare ce que tu voulais risquer à ce que tu as "
                                        "réellement risqué.")

        targets_raw = st.text_input("Objectifs (séparés par des virgules)",
                                    value=", ".join(str(x) for x in t.targets) if t and t.targets else "")

        ui.rule()
        ui.eyebrow("l'invalidation")
        kill = st.text_area(
            "Ce qui tue l'idée, même si le prix ne touche pas le stop",
            value=t.thesis_kill_switch if t else "", height=68,
            placeholder="Un CPI qui sort au-dessus du consensus. Un pivot BoJ.",
            help="Distinct du stop technique. C'est l'invalidation de la THÈSE, "
                 "pas celle du trade.")

        # --- LES CAPTURES ------------------------------------------------
        # Elles entrent au moment de l'écriture, pas après : c'est ce qui leur
        # donne leur valeur de preuve. Plusieurs à la fois — un graphique H4, un
        # D1, le ticket d'ordre.
        ui.rule()
        ui.eyebrow("les captures")
        # Modification TOTALE : en édition, on peut aussi RETIRER une capture,
        # pas seulement en ajouter. Le fichier reste sur le disque (journal
        # append-only), la capture est simplement démarquée.
        a_retirer = []
        if existing and existing.captures:
            st.markdown(
                '<div class="note">Captures actuelles — coche celles à retirer.</div>',
                unsafe_allow_html=True)
            for a in existing.captures:
                if st.checkbox(f"Retirer : {a.original_name or a.caption or a.id}",
                               key=f"rmcap_{existing.id}_{a.id}"):
                    a_retirer.append(a.id)
        st.markdown(
            '<div class="note">Autant que tu veux : le graphique de ta thèse, le '
            'ticket d\'ordre, la structure sur deux unités de temps. Une capture '
            'jointe <b>maintenant</b> horodate ce que tu voyais — elle vaut une '
            'donnée pré-engagée, exactement comme un champ du broker.</div>',
            unsafe_allow_html=True)
        shots = st.file_uploader(
            "Captures (PNG, JPG, WEBP)", type=["png", "jpg", "jpeg", "webp", "gif"],
            accept_multiple_files=True, key=f"shots_{existing.id if existing else 'new'}")

        # --- RATTACHEMENT À UNE THÈSE MACRO (facultatif) -----------------
        # La déclaration du ticket ne se fait PLUS ici : elle a lieu dans le
        # détail de l'idée, au moment où tu entres réellement (« je viens
        # d'entrer »). Ici, on écrit l'idée — et, si elle appartient à une
        # conviction plus large, on la rattache tout de suite à sa thèse.
        ui.rule()
        ui.eyebrow("la thèse liée")
        camps = campaigns or {}
        vivantes = {c.display_name: cid for cid, c in camps.items()
                    if not getattr(c, "abandoned", False) and not c.closed}
        _actuelle = (camps[existing.campaign_id].display_name
                     if existing and existing.campaign_id in camps else "— aucune —")
        _opts = ["— aucune —"] + list(vivantes)
        these_choix = st.selectbox(
            "Rattacher à une thèse macro (facultatif)", _opts,
            index=_opts.index(_actuelle) if _actuelle in _opts else 0,
            help="Regroupe cette idée avec d'autres qui expriment la MÊME "
                 "conviction sur des instruments différents. Reste modifiable "
                 "ensuite depuis le détail de l'idée.")

        submitted = st.form_submit_button(
            "Enregistrer" if existing else "Armer l'idée", type="primary")

    if not submitted:
        return

    if not instrument:
        st.error("L'instrument est obligatoire.")
        return
    if stop == 0 or entry == 0:
        st.error("Entrée et stop initial sont obligatoires : sans eux, aucun R n'est calculable.")
        return
    if direction == "sell" and stop <= entry:
        st.error("Sur un sell, le stop doit être AU-DESSUS de l'entrée.")
        return
    if direction == "buy" and stop >= entry:
        st.error("Sur un buy, le stop doit être EN DESSOUS de l'entrée.")
        return

    targets = []
    for chunk in targets_raw.split(","):
        chunk = chunk.strip()
        if chunk:
            try:
                targets.append(Decimal(chunk))
            except Exception:
                pass

    thesis = Thesis(
        instrument=instrument,
        direction=Direction(direction),
        macro_theme=macro_theme, catalyst=catalyst, macro_note=macro_note,
        setup=setup, timeframe=timeframe, technical_note=technical_note,
        entry_planned=Decimal(str(entry)), stop_initial=Decimal(str(stop)),
        targets=targets,
        risk_pct=Decimal(str(risk_pct)) if risk_pct else None,
        thesis_kill_switch=kill,
        conviction=conviction,
        risk_source=RiskSource.COMPUTED,
    )

    label = f"{instrument} {direction} — {macro_theme}" if macro_theme else f"{instrument} {direction}"

    if existing:
        store.update_thesis(existing.id, thesis, label)
        cible = existing.id
        msg = "Idée modifiée. La révision est horodatée dans le journal."
    else:
        idea = store.create_thesis(thesis, label=label, account_id=account_id)
        cible = idea.id
        msg = "Idée armée. Elle attend son exécution."

    for aid in a_retirer:
        store.remove_capture(aid)

    n = _joindre_captures(store, data_dir, "idea", cible, shots, CaptureKind.THESIS)

    # rattachement (ou détachement) à la thèse macro choisie
    cible_camp = vivantes.get(these_choix)
    ancienne = existing.campaign_id if existing else None
    if cible_camp and cible_camp != ancienne:
        store.attach(cible, cible_camp)
    elif ancienne and these_choix == "— aucune —":
        store.detach(cible)

    st.success(msg + (f" {n} capture(s) jointe(s)." if n else ""))
    st.rerun()


# ------------------------------------------------------------------ la liste

def _ouvrir(idea: Idea):
    # Ouverture en OVERLAY : le retour ramènera à la liste des idées, d'où l'on
    # vient, exactement à la hauteur du tableau. Pas de changement de rail.
    st.session_state["view_idea"] = idea.id
    st.session_state["view_origin"] = "Idée"
    st.session_state["view_anchor"] = "anchor-liste"
    st.rerun()


def _ligne(idea: Idea, spec_book) -> str:
    """Une ligne du journal, dans l'esprit des maquettes."""
    if idea.is_running:
        fr = idea.floating_r(spec_book)
        res = (f'<span class="txt-warn">flottant {ui.fmt_r(fr)}</span>' if fr is not None
               else '<span class="note">en cours</span>')
        tone = ""
    else:
        r = idea.r_multiple(spec_book) if idea.is_executed else None
        res = ui.fmt_r(r)
        tone = ui.tone_of(r)

    entree = "—"
    if idea.open_trades:
        entree = ui.fmt_price(idea.open_trades[0].open_price)
    elif idea.initial_position:
        entree = ui.fmt_price(idea.initial_position.open_price)
    elif idea.thesis and idea.thesis.entry_planned:
        entree = ui.fmt_price(idea.thesis.entry_planned)

    sens = idea.thesis.direction.value if idea.thesis else "?"
    sens_cls = "ok" if sens == "buy" else "bad"

    return (
        f'<tr>'
        f'<td><b>{idea.symbol}</b>{ui.tags(idea)}</td>'
        f'<td class="tight">'
        f'<span class="chip {sens_cls}">{"long" if sens == "buy" else "short"}</span></td>'
        f'<td class="tight">{ui.status_chip(idea)}</td>'
        f'<td class="num">{entree}</td>'
        f'<td class="tight">{ui.quadrant_chip(idea)}</td>'
        f'<td class="num {tone}">{res}</td>'
        f'</tr>'
    )


def _table(ideas: list[Idea], spec_book):
    st.markdown(
        '<table class="t"><tr>'
        '<th>symbole</th><th>sens</th><th>statut</th>'
        '<th style="text-align:right">entrée</th><th>décision</th>'
        '<th style="text-align:right">résultat</th></tr>'
        + "".join(_ligne(i, spec_book) for i in ideas) + "</table>",
        unsafe_allow_html=True)


def _echues(store: Store, armed: list[Idea]):
    """
    Les idées armées dont la fenêtre de 5 jours ouvrés est écoulée sans exécution.
    On ne demande PLUS de review d'abandon : on propose simplement de les
    abandonner. Le potentiel est épuisé (jamais de position le week-end).
    """
    echues = [i for i in armed if clock.review_due(i.created_at)]
    if not echues:
        return
    st.markdown("### Fenêtre écoulée")
    st.markdown(
        '<div class="note">Ces idées ont dépassé <b>5 jours ouvrés</b> sans '
        'être exécutées. Tu ne portes jamais sur le week-end : leur potentiel '
        'est épuisé. Tu peux les abandonner.</div>', unsafe_allow_html=True)

    noms = {i.display_name: i for i in echues}
    cible = st.selectbox("Idée à abandonner", ["— aucune —"] + list(noms),
                         key="missed_pick")
    if cible != "— aucune —":
        if st.button("Abandonner cette idée", key="missed_abandon", type="primary"):
            store.abandon(noms[cible].id)
            st.rerun()
    ui.rule()


def render(store: Store, ideas: list[Idea], spec_book, data_dir=None,
           account_id: str = "", campaigns: Optional[dict] = None):
    n_comptes = len({i.account_id for i in ideas}) or 1
    ui.title("Idée", f"{len(ideas)} idée(s) · {n_comptes} compte(s) cloisonné(s)")

    tab_list, tab_new = st.tabs(["Le journal", "＋ Nouvelle idée"])

    with tab_new:
        _form(store, data_dir, account_id, campaigns=campaigns)

    with tab_list:
        if not ideas:
            ui.empty("Aucune idée pour l'instant.",
                     "Commence par écrire une idée — avant d'entrer en position.")
            return

        armed = [i for i in ideas if i.status == IdeaStatus.ARMED]
        running = [i for i in ideas if i.is_running]
        to_review = [i for i in ideas
                     if i.is_executed and not i.is_running and i.review is None]

        # --- filtres, dans l'esprit de la maquette
        c1, c2 = st.columns([2.2, 1])
        q = c1.text_input("Rechercher", placeholder="un symbole, un tag, une thèse…",
                          label_visibility="collapsed", key="journal_q")
        filtre = c2.selectbox("Filtre",
                              ["Tous", "En cours", "Armées", "Clôturés", "À relire"],
                              label_visibility="collapsed", key="journal_f")

        vus = ideas
        if filtre == "En cours":
            vus = running
        elif filtre == "Armées":
            vus = armed
        elif filtre == "Clôturés":
            vus = [i for i in ideas if i.is_executed and not i.is_running]
        elif filtre == "À relire":
            vus = to_review

        if q:
            mot = q.lower()
            def _match(i: Idea) -> bool:
                champs = [i.symbol, i.display_name, i.label]
                if i.thesis:
                    champs += [i.thesis.macro_theme, i.thesis.catalyst,
                               i.thesis.setup, i.thesis.macro_note,
                               i.thesis.technical_note]
                return any(mot in (c or "").lower() for c in champs)
            vus = [i for i in vus if _match(i)]

        if to_review:
            st.markdown(
                f'<div class="note" style="margin:8px 0">'
                f'<span class="chip sig">{len(to_review)} review(s) à faire</span>'
                f'Pas de blocage. Juste un compteur qui ne descend que si tu le fais.'
                f'</div>', unsafe_allow_html=True)

        # ancre de RETOUR depuis une fiche d'idée : on re-scrolle sur le tableau.
        st.markdown('<div id="anchor-liste"></div>', unsafe_allow_html=True)
        if not vus:
            ui.empty("Aucune idée ne correspond à ce filtre.")
        else:
            ordre = {IdeaStatus.RUNNING: 0, IdeaStatus.ARMED: 1}
            vus = sorted(vus, key=lambda i: (
                ordre.get(i.status, 2),
                -(i.opened_at or i.created_at).timestamp()))
            _table(vus, spec_book)

            st.markdown("")
            choix = st.selectbox("Ouvrir une idée",
                                 [""] + [f"{i.symbol} — {i.display_name}" for i in vus],
                                 key="journal_open")
            if choix:
                cible = next(i for i in vus
                             if f"{i.symbol} — {i.display_name}" == choix)
                _ouvrir(cible)

        ui.rule()

        if armed:
            # Une idée armée n'a pas encore rencontré le marché : la corriger
            # avant l'entrée n'est pas de la réécriture d'histoire, c'est du
            # travail normal. Chaque modification reste horodatée dans le
            # journal — si tu la retouches APRÈS le trade, l'outil le sait.
            with st.expander("Modifier une idée armée"):
                noms = {f"{i.symbol} — {i.display_name}": i for i in armed}
                cible = st.selectbox("Idée à modifier", ["— aucune —"] + list(noms),
                                     key="edit_pick")
                if cible != "— aucune —":
                    _form(store, data_dir, account_id, existing=noms[cible],
                          campaigns=campaigns)

        _echues(store, armed)

        if armed:
            with st.expander("Abandonner une idée jamais exécutée"):
                st.markdown(
                    '<div class="note">Une idée abandonnée sort des candidates '
                    'à l\'appariement et n\'entre dans aucune statistique de '
                    'performance. Elle reste dans le journal : c\'est ce qui '
                    'permettra un jour de savoir si tes renoncements étaient '
                    'justifiés.</div>', unsafe_allow_html=True)
                noms = {i.display_name: i for i in armed}
                cible = st.selectbox("Idée à abandonner", ["— aucune —"] + list(noms),
                                     key="abandon_pick")
                if cible != "— aucune —":
                    confirme = st.checkbox(f"Je confirme l'abandon de « {cible} »",
                                           key="abandon_ok")
                    if st.button("Abandonner", key="abandon_btn", disabled=not confirme):
                        store.abandon(noms[cible].id)
                        st.rerun()
