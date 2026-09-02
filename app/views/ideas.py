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

import uuid
from decimal import Decimal
from typing import Optional

import streamlit as st

from core import clock
from core.models import (
    Direction, Idea, IdeaStatus, OpenTrade, RiskSource, Thesis,
)
from core import symbols
from core.store import Store
from .. import blocks as B
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


def _form(store: Store, data_dir, account_id: str = "",
          existing: Optional[Idea] = None, campaigns: Optional[dict] = None):
    t = existing.thesis if existing else None
    key = existing.id if existing else "new"
    titre = "Modifier l'idée" if existing else "Écrire une idée"

    st.markdown(f"## {titre}")

    # Dossier des images d'une NOUVELLE idée (avant sa création). Le bloc stocke
    # le chemin complet : peu importe que ce dossier diffère de l'id final.
    img_owner = existing.id if existing else st.session_state.setdefault(
        "new_idea_img", uuid.uuid4().hex[:12])

    # PLUS de st.form : l'éditeur par blocs (ajout/déplacement/retrait) exige des
    # reruns immédiats, qu'un formulaire (qui n'agit qu'à la validation) interdit.
    # Le symbole se choisit dans TA liste : taper « BRENT » quand le broker écrit
    # UKOUSD envoyait le trade en hors-plan à tort.
    choices = symbols.known()
    current = (t.instrument or "").upper() if t else ""
    if current and current not in choices:
        choices = [current] + choices          # ne jamais perdre une valeur existante

    c1, c2, c3 = st.columns([1.4, 1, 1])
    instrument = c1.selectbox(
        "Instrument", choices, key=f"idea_instr_{key}",
        index=choices.index(current) if current in choices else 0,
        help="Ta watchlist. Tout symbole importé s'y ajoute automatiquement — "
             "c'est le nom exact du broker qui fait foi.")
    direction = c2.selectbox(
        "Sens", ["sell", "buy"], key=f"idea_dir_{key}",
        index=0 if not t or t.direction == Direction.SELL else 1)
    conviction = c3.slider("Conviction", 1, 5,
                           t.conviction if t and t.conviction else 3,
                           key=f"idea_conv_{key}")

    ui.rule()
    ui.eyebrow("l'idée fonda")
    c1, c2 = st.columns([1, 1])
    macro_theme = c1.text_input(
        "Thème", value=t.macro_theme if t else "", key=f"idea_theme_{key}",
        placeholder="ex. Fed / taux US, dollar fort, risk-off…",
        help="Catégoriel : c'est ce qui rend tes idées agrégeables. Écris-le "
             "librement — mais réutilise les MÊMES mots d'une idée à l'autre "
             "pour qu'elles se regroupent.")
    catalyst = c2.text_input("Catalyseur attendu", value=t.catalyst if t else "",
                             key=f"idea_cat_{key}", placeholder="CPI US du 15/07")

    # --- LE DÉVELOPPEMENT, EN BLOCS (même éditeur que la thèse macro) -----
    ui.rule()
    ui.eyebrow("le développement — écris, ajoute des visuels au fil",
               aide="Écris un paragraphe, insère une image à sa suite (le "
                    "graphique, le ticket d'ordre), continue. Chaque bloc se "
                    "déplace (↑↓) et se retire (✕).")
    bkey = f"idea_blocks_{key}"
    if bkey not in st.session_state:
        if t and t.blocks:
            st.session_state[bkey] = B.init(t.blocks)
        else:
            # Reprise d'une ancienne idée : ses textes deviennent des blocs
            # (les captures, elles, restent dans la galerie du détail).
            fallback = []
            if t and t.macro_note:
                fallback.append({"type": "text", "text": t.macro_note})
            if t and t.technical_note:
                fallback.append({"type": "text", "text": t.technical_note})
            st.session_state[bkey] = B.init(fallback)
    B.editor(bkey, "idea", img_owner, data_dir)

    ui.rule()
    ui.eyebrow("la structure technique")
    c1, c2 = st.columns([1, 1])
    setup = c1.selectbox(
        "Setup", SETUPS, key=f"idea_setup_{key}",
        index=SETUPS.index(t.setup) if t and t.setup in SETUPS else 0)
    timeframe = c2.selectbox(
        "Unité de temps", TIMEFRAMES, key=f"idea_tf_{key}",
        index=TIMEFRAMES.index(t.timeframe) if t and t.timeframe in TIMEFRAMES else 0)

    ui.rule()
    ui.eyebrow("le risque")
    st.markdown(
        '<div class="note">Le <b>stop initial</b> est le seul champ indispensable. '
        "Ton broker n'archive que ton <i>dernier</i> stop : dès que tu passes au "
        "breakeven, ton risque d'origine est perdu pour toujours. Il ne peut venir "
        "que d'ici.</div>", unsafe_allow_html=True)

    c1, c2, c3 = st.columns(3)
    entry = c1.number_input(
        "Entrée visée", value=float(t.entry_planned) if t and t.entry_planned else 0.0,
        step=0.01, format="%.5f", key=f"idea_entry_{key}")
    stop = c2.number_input(
        "Stop initial", value=float(t.stop_initial) if t and t.stop_initial else 0.0,
        step=0.01, format="%.5f", key=f"idea_stop_{key}")
    risk_pct = c3.number_input(
        "Risque visé (%)", min_value=0.0, max_value=10.0,
        value=float(t.risk_pct) if t and t.risk_pct else 0.5,
        step=0.1, format="%.2f", key=f"idea_risk_{key}",
        help="Ne sert pas au calcul du R. Sert de contrôle croisé : l'outil "
             "compare ce que tu voulais risquer à ce que tu as réellement risqué.")

    targets_raw = st.text_input(
        "Objectifs (séparés par des virgules)", key=f"idea_targets_{key}",
        value=", ".join(str(x) for x in t.targets) if t and t.targets else "")

    ui.rule()
    ui.eyebrow("l'invalidation")
    kill = st.text_area(
        "Ce qui tue l'idée, même si le prix ne touche pas le stop",
        value=t.thesis_kill_switch if t else "", height=68, key=f"idea_kill_{key}",
        placeholder="Un CPI qui sort au-dessus du consensus. Un pivot BoJ.",
        help="Distinct du stop technique. C'est l'invalidation de la THÈSE, "
             "pas celle du trade.")

    # --- LE TICKET, À L'ENTRÉE --------------------------------------------
    ui.rule()
    ui.eyebrow("le ticket — dès que tu es entré")
    _running = bool(existing and existing.open_trades)
    _closed = bool(existing and existing.is_executed)
    ticket_val = ""
    if _running:
        _tks = ", ".join(o.ticket for o in existing.open_trades)
        st.markdown(
            f'<div class="note">Trade déjà déclaré <b>en cours</b> (ticket '
            f'{_tks}). Il sera clôturé tout seul par ton prochain import — '
            f'rien à ressaisir ici.</div>', unsafe_allow_html=True)
    elif _closed:
        st.markdown(
            '<div class="note">Idée clôturée : le(s) ticket(s) sont déjà '
            'rattachés, il n\'y a plus rien à déclarer.</div>',
            unsafe_allow_html=True)
    else:
        if st.session_state.get("focus_ticket"):
            st.markdown(
                f'<div class="card" style="border-left:3px solid {T.ACCENT}">'
                f'<div class="eyebrow bar">on y est presque 🙂</div>'
                f'<div class="note">Il ne manque que le <b>numéro de '
                f'ticket</b> de ce trade. Renseigne-le et l\'idée passe en '
                f'cours : ton prochain import la clôturera toute seule.</div>'
                f'</div>', unsafe_allow_html=True)
        ticket_val = st.text_input(
            "N° de ticket (facultatif tant que tu n'es pas entré)",
            value="", placeholder="celui affiché par ton terminal",
            key=f"idea_ticket_{key}",
            help="Dès que tu prends la position, mets-le : l'idée passe « en "
                 "cours », ton stop réel est figé avant que le broker ne "
                 "l'écrase, et l'import refermera ce trade par ce numéro.")

    # --- RATTACHEMENT À UNE THÈSE MACRO (facultatif) ---------------------
    ui.rule()
    ui.eyebrow("la thèse liée")
    camps = campaigns or {}
    vivantes = {c.display_name: cid for cid, c in camps.items()
                if not getattr(c, "abandoned", False) and not c.closed}
    _actuelle = (camps[existing.campaign_id].display_name
                 if existing and existing.campaign_id in camps else "— aucune —")
    _opts = ["— aucune —"] + list(vivantes)
    these_choix = st.selectbox(
        "Rattacher à une thèse macro (facultatif)", _opts, key=f"idea_camp_{key}",
        index=_opts.index(_actuelle) if _actuelle in _opts else 0,
        help="Regroupe cette idée avec d'autres qui expriment la MÊME "
             "conviction sur des instruments différents. Reste modifiable "
             "ensuite depuis le détail de l'idée.")

    ui.rule()
    if not st.button("Enregistrer" if existing else "Armer l'idée",
                     type="primary", key=f"idea_save_{key}"):
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

    # Le corps de l'idée vit désormais en BLOCS (texte/image façon Notion) ; la
    # note « à plat » en est le reflet (recherche, rétrocompat). technical_note
    # est repris dans les blocs à la reprise d'une ancienne idée, donc vidé ici.
    blocs = [dict(b) for b in st.session_state[bkey]]
    macro_note = B.to_note(blocs)

    thesis = Thesis(
        instrument=instrument,
        direction=Direction(direction),
        macro_theme=macro_theme, catalyst=catalyst, macro_note=macro_note,
        blocks=blocs,
        setup=setup, timeframe=timeframe, technical_note="",
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

    # rattachement (ou détachement) à la thèse macro choisie
    cible_camp = vivantes.get(these_choix)
    ancienne = existing.campaign_id if existing else None
    if cible_camp and cible_camp != ancienne:
        store.attach(cible, cible_camp)
    elif ancienne and these_choix == "— aucune —":
        store.detach(cible)

    # DÉCLARATION DU TICKET (#182) : si un numéro est fourni et que l'idée n'est
    # ni en cours ni clôturée, on ouvre le trade — l'idée passe « en cours »,
    # avec le stop de l'idée (le broker n'archive que le dernier stop). Le focus
    # « idée incomplète » est levé : le ticket manquant a été renseigné.
    declare = False
    if ticket_val.strip():
        # account_id VIDE, jamais l'uid interne : ce champ sert au rapprochement
        # par NUMÉRO BROKER, inconnu à la saisie (mobile). Le ticket, unique,
        # referme le trade à l'import ([O]). Le cloisonnement, lui, passe par
        # l'idée (idea_id), pas par le compte du trade ouvert.
        store.open_trade(cible, OpenTrade(
            ticket=ticket_val.strip(), symbol=instrument,
            direction=Direction(direction), volume=Decimal("0"),
            open_time=clock.server_now(), open_price=Decimal(str(entry)),
            account_id="", stop=Decimal(str(stop))))
        declare = True
        st.session_state.pop("focus_ticket", None)

    # Nouvelle idée : on libère les clés de composition pour repartir vierge.
    if not existing:
        for k in list(st.session_state):
            if k.endswith("_new") or k == "new_idea_img" or "_new_" in k \
                    or k == bkey:
                st.session_state.pop(k, None)

    st.success(msg + (" Ticket déclaré : l'idée est en cours." if declare else ""))
    st.rerun()


# ------------------------------------------------------------------ la liste

def _ouvrir(idea: Idea):
    # Ouverture en OVERLAY : le retour ramènera à la liste des idées, d'où l'on
    # vient, exactement à la hauteur du tableau. Pas de changement de rail.
    st.session_state["view_idea"] = idea.id
    st.session_state["view_origin"] = "Idée"
    st.session_state["view_anchor"] = "anchor-liste"
    st.rerun()


def _menu_idee(store: Store, idea: Optional[Idea]):
    """
    Les 3 points d'une idée : ouvrir / modifier / abandonner — comme la thèse.
    Un popover natif, jamais un accordéon qui pousse la liste. Désactivé tant
    qu'aucune idée n'est choisie.
    """
    with st.popover("⋮", disabled=idea is None, use_container_width=False):
        if idea is None:
            return
        st.markdown('<div class="eyebrow bar">cette idée</div>',
                    unsafe_allow_html=True)
        if st.button("Ouvrir / relire", key=f"open_{idea.id}",
                     use_container_width=True):
            _ouvrir(idea)

        # #174 — une idée clôturée ET revue ne se modifie plus : le verdict est
        # acquis. On grise proprement (un cadena), pas de bouton mort.
        verrou = idea.is_executed and not idea.is_running and idea.review is not None
        if verrou:
            st.markdown(
                '<div class="note" style="opacity:.7">🔒 Clôturée et revue — '
                'elle ne se modifie plus. Son verdict est acquis.</div>',
                unsafe_allow_html=True)
        else:
            if st.button("Modifier", key=f"editi_{idea.id}",
                         use_container_width=True):
                st.session_state["idea_edit"] = idea.id
                st.rerun()

        ui.rule()
        if idea.status == IdeaStatus.ARMED:
            st.markdown(
                '<div class="note">L\'abandon la sort des candidates à '
                'l\'appariement et des stats. Elle reste dans le journal.</div>',
                unsafe_allow_html=True)
            ok = st.checkbox("Je confirme l'abandon", key=f"abdoki_{idea.id}")
            if st.button("Abandonner l'idée", key=f"abdi_{idea.id}",
                         disabled=not ok, use_container_width=True):
                store.abandon(idea.id)
                st.rerun()
        else:
            st.markdown(
                '<div class="note" style="opacity:.7">🔒 L\'abandon ne concerne '
                'qu\'une idée jamais exécutée.</div>', unsafe_allow_html=True)


# Largeurs de colonnes, partagées par l'en-tête et chaque ligne : symbole, sens,
# statut, entrée, décision, résultat, et la colonne étroite des 3 points.
_COLS = [1.7, 0.8, 0.95, 0.95, 1.0, 0.85, 0.5]


def _liste(store: Store, ideas: list[Idea], spec_book):
    """
    Le journal en lignes NATIVES : chaque idée porte ses 3 points au bout de SA
    ligne (plus de selectbox « choose an option » ni de menu détaché). Un tableau
    HTML ne peut pas héberger de widget cliquable par ligne — d'où les colonnes.
    """
    head = st.columns(_COLS, vertical_alignment="center")
    for col, lab in zip(head, ["symbole", "sens", "statut", "entrée",
                               "décision", "résultat", ""]):
        col.markdown(f'<div class="eyebrow" style="margin:0">{lab}</div>',
                     unsafe_allow_html=True)
    st.markdown(f'<hr style="margin:2px 0 0;border:none;'
                f'border-top:0.5px solid {T.RULE}">', unsafe_allow_html=True)

    for idea in ideas:
        if idea.is_running:
            fr = idea.floating_r(spec_book)
            res = (f'flottant {ui.fmt_r(fr)}' if fr is not None else 'en cours')
            tone = "txt-warn" if fr is not None else "note"
        else:
            r = idea.r_multiple(spec_book) if idea.is_executed else None
            res = ui.fmt_r(r)
            t = ui.tone_of(r)
            tone = f"txt-{t}" if t in ("gain", "loss") else "note"

        entree = "—"
        if idea.open_trades:
            entree = ui.fmt_price(idea.open_trades[0].open_price)
        elif idea.initial_position:
            entree = ui.fmt_price(idea.initial_position.open_price)
        elif idea.thesis and idea.thesis.entry_planned:
            entree = ui.fmt_price(idea.thesis.entry_planned)

        sens = idea.thesis.direction.value if idea.thesis else "?"
        sens_cls = "ok" if sens == "buy" else "bad"

        c = st.columns(_COLS, vertical_alignment="center")
        c[0].markdown(f'<div><b>{idea.symbol}</b>{ui.tags(idea)}</div>',
                      unsafe_allow_html=True)
        c[1].markdown(f'<span class="chip {sens_cls}">'
                      f'{"long" if sens == "buy" else "short"}</span>',
                      unsafe_allow_html=True)
        c[2].markdown(ui.status_chip(idea), unsafe_allow_html=True)
        c[3].markdown(f'<div class="mono" style="text-align:right">{entree}</div>',
                      unsafe_allow_html=True)
        c[4].markdown(ui.quadrant_chip(idea), unsafe_allow_html=True)
        c[5].markdown(f'<div class="mono {tone}" style="text-align:right;'
                      f'white-space:nowrap">{res}</div>', unsafe_allow_html=True)
        with c[6]:
            _menu_idee(store, idea)
        st.markdown(f'<hr style="margin:0;border:none;'
                    f'border-top:0.5px solid {T.RULE_SOFT}">',
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

        # --- sous-vue « modifier une idée » (ouverte depuis les 3 points, ou
        # par le routage « idée incomplète » après un import sans ticket). Une
        # page à part, avec un retour — pas un accordéon.
        ie = st.session_state.get("idea_edit")
        edit_idea = next((i for i in ideas if i.id == ie), None) if ie else None
        if edit_idea is not None:
            if st.button("← Retour au journal", key="idea_edit_back"):
                st.session_state.pop("idea_edit", None)
                st.session_state.pop("focus_ticket", None)
                st.rerun()
            _form(store, data_dir, account_id, existing=edit_idea,
                  campaigns=campaigns)
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

        # --- « entré sur une idée armée ? renseigne son ticket » (#182)
        # Une INVITATION, pas un reproche : une idée armée peut n'être pas encore
        # jouée. Le bouton emmène droit sur la modif, au niveau du champ ticket,
        # avec le message d'accueil (focus_ticket).
        sans_ticket = [i for i in armed if not i.open_trades]
        if sans_ticket:
            noms_st = {f"{i.symbol} — {i.display_name}": i for i in sans_ticket}
            cA, cB = st.columns([2.4, 1])
            with cA:
                st.markdown(
                    f'<div class="note" style="margin-top:6px">'
                    f'<span class="chip acc">{len(sans_ticket)} idée(s) armée(s)'
                    f'</span> Entré en position sur l\'une d\'elles ? Renseigne '
                    f'son <b>numéro de ticket</b> pour la passer « en cours ».'
                    f'</div>', unsafe_allow_html=True)
            with cB:
                pick_inc = st.selectbox(
                    "Compléter le ticket", ["—"] + list(noms_st),
                    label_visibility="collapsed", key="incomplete_pick")
            if pick_inc != "—":
                if st.button("Emmener vers l'idée", key="go_incomplete",
                             type="primary"):
                    st.session_state["idea_edit"] = noms_st[pick_inc].id
                    st.session_state["focus_ticket"] = True
                    st.rerun()

        # ancre de RETOUR depuis une fiche d'idée : on re-scrolle sur le tableau.
        st.markdown('<div id="anchor-liste"></div>', unsafe_allow_html=True)
        if not vus:
            ui.empty("Aucune idée ne correspond à ce filtre.")
        else:
            ordre = {IdeaStatus.RUNNING: 0, IdeaStatus.ARMED: 1}
            vus = sorted(vus, key=lambda i: (
                ordre.get(i.status, 2),
                -(i.opened_at or i.created_at).timestamp()))
            # Chaque ligne porte ses 3 points au bout : ouvrir, modifier,
            # abandonner — directement à côté de l'idée (plus de selectbox).
            _liste(store, vus, spec_book)

        ui.rule()
        _echues(store, armed)
