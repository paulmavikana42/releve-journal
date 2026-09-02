"""
Import : CSV du terminal (la voie normale) ou rapport HTML MT5 (la voie riche).

L'import est idempotent : un ticket déjà connu n'est jamais réimporté. Tu peux
déposer dix fois le même fichier, ou un fichier plus large qui recouvre
l'ancien — rien ne bouge. C'est ce qui rend l'outil réparable.

LE RAPPROCHEMENT SE FAIT PAR NUMÉRO DE TICKET, jamais par ressemblance. Un
ticket que tu as déclaré ouvert est clôturé par son jumeau dans l'export : pas
d'appariement à la main, pas de doublon, pas de fusion à tort.

L'appariement idée↔ticket, lui, ne décide jamais : il propose, tu tranches. Il
ne sert plus qu'aux trades que tu n'avais pas déclarés — c'est-à-dire, si tu
joues le jeu, aux seuls trades hors-plan.
"""
from __future__ import annotations

import tempfile
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import streamlit as st

from core import csvimport as CSV
from core import matcher
from core import onboarding as O
from core.models import Direction, Idea, IdeaStatus, RiskSource, Thesis
from core.parser import ParseError, parse_report
from core import symbols
from core.store import Store
from .. import theme as T
from .. import ui


def _quitter_la_demo(store: Store) -> tuple[Store, int]:
    """
    Le premier import de VRAIS trades met fin à la démonstration.

    On ne supprime rien : on cesse simplement de lire `demo.jsonl`, après avoir
    recopié dans le vrai journal ce que l'utilisateur avait écrit LUI-MÊME
    pendant la démonstration (ses idées, ses captures, ses tickets déclarés).

    Renvoie le store à utiliser pour l'écriture, et le nombre d'événements
    repris. Si on n'était pas en démonstration, ne fait rien.
    """
    if not O.demo_mode():
        return store, 0
    reel, repris = O.leave_demo()
    return Store(reel, demo=False), repris


# ------------------------------------------------------- appariement manuel

def _pos_card(p) -> str:
    tone = ui.tone_of(p.pnl_net)
    return (
        f'<div class="eyebrow">ticket {p.position_id}</div>'
        f'<div class="mono" style="font-size:0.92rem">'
        f'{p.symbol} · {p.direction.value} · {p.volume} lot</div>'
        f'<div class="note mono">'
        f'{p.open_time:%d/%m %H:%M} @ {p.open_price} → '
        f'{p.close_time:%d/%m %H:%M} @ {p.close_price}</div>'
        f'<div class="stat {tone}" style="margin-top:6px">{ui.fmt_money(p.pnl_net)}</div>'
        f'<div class="note">sortie : {p.exit_reason.value}</div>'
    )


def _match_wizard(store: Store, ideas: list[Idea]) -> bool:
    orphans = store.orphans()
    if not orphans:
        return False

    orphans.sort(key=lambda p: p.open_time)
    p = orphans[0]

    ui.title("Appariement",
             f"{len(orphans)} ticket(s) importé(s) et non rattaché(s)")
    st.markdown(
        '<div class="note">Rien ne sera fusionné sans ton accord : deux idées '
        'distinctes peuvent se chevaucher sur le même instrument, et une fusion à '
        'tort pollue tes statistiques pour toujours. '
        '<b>Ces tickets sont ceux que tu n\'avais pas déclarés à l\'ouverture</b> — '
        'déclare-les la prochaine fois et cet écran disparaîtra.</div>',
        unsafe_allow_html=True)

    left, right = st.columns([1, 1.5])

    with left:
        st.markdown(f'<div class="card">{_pos_card(p)}</div>', unsafe_allow_html=True)

    with right:
        cands = matcher.candidates(p, ideas)

        if not cands:
            st.markdown(
                f'<div class="card" style="border-left:3px solid {T.WARN}">'
                f'<div class="eyebrow">aucune idée ne correspond</div>'
                f'<p>Aucune idée armée sur <b>{p.symbol} {p.direction.value}</b>.</p>'
                f'<div class="note">Deux possibilités : soit tu as pris ce trade sans '
                f'l\'avoir écrit (hors-plan), soit ton idée porte un autre nom de '
                f'symbole que celui du broker.</div></div>', unsafe_allow_html=True)

            armees = [i for i in ideas
                      if i.status == IdeaStatus.ARMED and i.thesis
                      and i.thesis.direction == p.direction]
            if armees:
                st.markdown('<div class="eyebrow">une de ces idées vise-t-elle ce trade ?</div>',
                            unsafe_allow_html=True)
                noms = {f"{i.display_name}  ({i.thesis.instrument})": i for i in armees}
                pick = st.selectbox(
                    f"Corriger le symbole vers {p.symbol}",
                    ["— aucune —"] + list(noms), key=f"fixsym_{p.uid}",
                    help=f"Réécrit l'instrument de l'idée en {p.symbol}, le nom "
                         f"exact du broker. Le ticket deviendra alors rattachable.")
                if pick != "— aucune —":
                    if st.button(f"Corriger en {p.symbol} et rattacher",
                                 key=f"fixbtn_{p.uid}", type="primary"):
                        target = noms[pick]
                        fixed = replace(target.thesis, instrument=p.symbol)
                        store.update_thesis(
                            target.id, fixed,
                            label=f"{p.symbol} {p.direction.value}"
                                  f" — {fixed.macro_theme}" if fixed.macro_theme
                                  else f"{p.symbol} {p.direction.value}")
                        st.rerun()
                ui.rule()

            if st.button("Enregistrer comme trade hors-plan", type="primary"):
                _hors_plan(store, p)
            return True

        for c in cands:
            i = c.idea
            verb = ("fragment du noyau — sortie partielle" if c.is_fragment
                    else "renforcement (add)" if c.is_add
                    else "exécution de l'idée")
            border = f"border-left:3px solid {T.WARN}" if c.late else ""
            st.markdown(
                f'<div class="card" style="{border}">'
                f'<div class="eyebrow">idée candidate — {verb}</div>'
                f'<b>{i.display_name}</b> {ui.chips(i)}'
                f'<div class="note mono">stop initial {i.thesis.stop_initial} · '
                f'risque {i.thesis.risk_pct}% · armée le {i.created_at:%d/%m %H:%M}</div>'
                f'<div class="note">{c.reason}</div>'
                f'</div>', unsafe_allow_html=True)

            if c.is_fragment:
                # UN FRAGMENT N'EST PAS UN ADD. Même heure, même prix d'entrée
                # qu'un ticket déjà rattaché : c'est le reste d'une sortie
                # partielle. Il hérite du stop du noyau, il n'a pas de risque
                # propre à saisir, et surtout PAS de case « noyau au breakeven » :
                # cocher ça sur un fragment sous-estimerait ton exposition
                # simultanée (le calcul mettrait le noyau à zéro). On le rattache,
                # point.
                st.markdown(
                    '<div class="note">Rien à saisir : ce ticket a la même entrée '
                    'qu\'un ticket déjà rattaché à cette idée — c\'est le reste '
                    'd\'une sortie partielle, pas un nouveau pari. Il prend le stop '
                    'du noyau, et ton exposition reste calculée sur la position '
                    'entière.</div>', unsafe_allow_html=True)
                if st.button("Rattacher ce fragment du noyau",
                             key=f"frag_{p.uid}_{i.id}", type="primary",
                             help="Le relie à l'idée comme partie du noyau. Aucun "
                                  "stop ni case breakeven : une sortie partielle "
                                  "n'ajoute pas de risque, elle en retire."):
                    store.link(i.id, p.uid)
                    st.rerun()
            elif c.is_add:
                secured = st.checkbox(
                    "Mon noyau était déjà au breakeven quand j'ai ouvert ce ticket",
                    key=f"be_{p.uid}_{i.id}", value=True,
                    help="Si oui, le ticket initial ne risquait plus rien à cet "
                         "instant : son risque sort du calcul d'exposition "
                         "simultanée. Sans réponse, l'outil suppose le pire.")
                # LE stop de l'add, demandé au SEUL moment où tu l'as en tête :
                # celui où tu regardes ce ticket précis. Un renforcement peut
                # être pris plus serré que le noyau — l'outil ne le devine pas
                # et ne l'invente pas. Tant qu'il manque, le R de l'idée reste
                # incalculable, et c'est honnête : un R faux serait pire.
                stop_add = st.number_input(
                    "Stop de ce renforcement",
                    min_value=0.0, value=float(p.stop_original or 0),
                    step=0.01, format="%.5f", key=f"stopadd_{p.uid}_{i.id}",
                    help="Le stop réellement placé sur CE ticket. Il peut être "
                         "plus serré que celui du noyau. Sans lui, le R de "
                         "l'idée n'est pas calculable — tu pourras le saisir "
                         "plus tard depuis le détail de l'idée.")
                if st.button("Rattacher — c'est un ADD sur cette idée",
                             key=f"link_{p.uid}_{i.id}", type="primary"):
                    store.link(i.id, p.uid)
                    store.set_secured(i.id, p.uid, secured)
                    if stop_add > 0:
                        store.set_ticket_stop(i.id, p.uid, Decimal(str(stop_add)))
                    st.rerun()
            else:
                if st.button("Rattacher à cette idée",
                             key=f"link_{p.uid}_{i.id}", type="primary"):
                    store.link(i.id, p.uid)
                    st.rerun()

        ui.rule()
        if st.button("Traiter plus tard", key=f"later_{p.uid}"):
            st.session_state["nav"] = "Tableau de bord"
            st.rerun()
        if st.button("Aucune — c'est un trade hors-plan"):
            _hors_plan(store, p)

    return True


def _hors_plan(store: Store, p):
    thesis = Thesis(instrument=p.symbol, direction=p.direction,
                    entry_planned=p.open_price, risk_source=RiskSource.UNKNOWN)
    idea = store.create_thesis(
        thesis, label=f"{p.symbol} {p.direction.value} — hors-plan",
        off_plan=True, account_id=p.account_id)
    store.link(idea.id, p.uid)
    st.rerun()


# --------------------------------------------- ticket obligatoire avant import

def _completer_tickets(store: Store, ideas: list[Idea], cf: CSV.CsvFile,
                       cle: str, account_id: str) -> bool:
    """
    Garde-fou : avant tout rapprochement, une idée armée qui figure visiblement
    dans ce fichier (même symbole, même sens) mais SANS numéro de ticket déclaré
    doit recevoir le sien. Sans lui, l'appariement devinerait par ressemblance —
    et deviner a déjà fusionné deux trades à tort (jeudi/vendredi, même
    instrument). On propose le ticket le plus proche par PRIX d'entrée,
    l'utilisateur confirme. Rien n'est deviné en silence, et rien n'est bloqué
    sans issue : une idée qui n'est pas dans ce fichier se déclare telle.

    Renvoie True si cet écran a pris la main — l'appelant s'arrête alors là,
    l'import ne se poursuit qu'une fois les tickets tranchés.
    """
    deja = set(store.pending_trades().keys())
    _, positions, _ = store.load()
    deja |= {p.position_id for p in positions.values()}

    ecartees: set = st.session_state.setdefault(f"skip_tick_{cle}", set())

    besoins: list[tuple[Idea, list[CSV.CsvRow]]] = []
    for i in ideas:
        if i.status != IdeaStatus.ARMED or i.open_trades or not i.thesis:
            continue
        if i.id in ecartees:
            continue
        if account_id and i.account_id and i.account_id != account_id:
            continue
        cands = [r for r in cf.rows
                 if r.symbol.upper() == i.thesis.instrument.upper()
                 and r.direction == i.thesis.direction
                 and r.ticket not in deja]
        if not cands:
            continue                       # pas dans ce fichier : on ne bloque pas
        vise = i.thesis.entry_planned or Decimal(0)
        cands.sort(key=lambda r: abs((r.open_price or Decimal(0)) - vise))
        besoins.append((i, cands))

    if not besoins:
        return False

    ui.rule()
    ui.title("Complète les numéros de ticket",
             f"{len(besoins)} idée(s) armée(s) figurent dans ce fichier sans "
             "numéro de ticket. Il est la clé du rapprochement.")
    st.markdown(
        '<div class="note">Le rapprochement se fait par <b>numéro de ticket</b>, '
        'jamais par ressemblance — parce que deviner a déjà fusionné deux trades à '
        'tort. Ces idées n\'en ont pas : l\'outil te propose le ticket le plus '
        'proche par <b>prix d\'entrée</b>, tu confirmes. Une idée absente de ce '
        'fichier ? Dis-le, elle sera laissée tranquille.</div>',
        unsafe_allow_html=True)

    PAS_ICI = "— cette idée n'est pas dans ce fichier —"
    par_id = {i.id: i for i, _ in besoins}
    choix: dict = {}
    for idea, cands in besoins:
        libelles = {
            f"#{r.ticket} · entrée {ui.fmt_price(r.open_price)} · "
            f"{ui.fmt_money(r.profit) if r.profit is not None else 'ouvert'}": r
            for r in cands
        }
        st.markdown(
            f'<div class="card"><div class="eyebrow">idée armée</div>'
            f'<b>{idea.display_name}</b> {ui.chips(idea)}'
            f'<div class="note mono">entrée visée '
            f'{ui.fmt_price(idea.thesis.entry_planned)} · '
            f'stop {ui.fmt_price(idea.thesis.stop_initial)} · '
            f'armée le {idea.created_at:%d/%m %H:%M}</div></div>',
            unsafe_allow_html=True)
        pick = st.selectbox(
            f"Ticket pour « {idea.display_name} »",
            list(libelles) + [PAS_ICI], key=f"tick_pick_{cle}_{idea.id}",
            help="Le plus proche par prix est proposé en premier — à toi de "
                 "confirmer. C'est ce ticket qui clôturera l'idée.")
        choix[idea.id] = None if pick == PAS_ICI else libelles[pick]

    ui.rule()
    if st.button("Confirmer les tickets et rapprocher", type="primary",
                 key=f"tick_ok_{cle}"):
        pris = [r.ticket for r in choix.values() if r]
        if len(pris) != len(set(pris)):
            st.error("Deux idées pointent le même ticket : impossible de trancher "
                     "à ta place. Corrige avant de continuer.")
            return True
        for idea_id, row in choix.items():
            if row is None:
                ecartees.add(idea_id)      # laissée tranquille pour ce fichier
                continue
            idea = par_id[idea_id]
            ot = row.to_open_trade(account_id)
            # Le stop du NOYAU vient de l'idée, jamais du broker : c'est écrit
            # avant d'entrer, et le broker n'archive que le dernier stop.
            if idea.thesis.stop_initial is not None:
                ot = replace(ot, stop=idea.thesis.stop_initial)
            store.open_trade(idea_id, ot)
        st.rerun()
    return True


# --------------------------------------------------------------- import CSV

_MOMENTS = {
    CSV.Outcome.CLOSES: ("acc", "clôture le trade ouvert"),
    CSV.Outcome.UPDATES: ("sig", "met à jour « en cours »"),
    CSV.Outcome.NEW_CLOSED: ("ok", "nouveau trade"),
    CSV.Outcome.NEW_OPEN: ("warn", "nouveau trade ouvert"),
    CSV.Outcome.KNOWN: ("", "déjà connu — ignoré"),
}


def _mapping_manuel(cf: CSV.CsvFile, key: str) -> dict:
    """Quand les intitulés du fichier ne ressemblent à rien de connu."""
    st.markdown(
        f'<div class="card" style="border-left:3px solid {T.WARN}">'
        f'<div class="eyebrow">mapping manuel</div>'
        f'<div class="note">Champs indispensables non reconnus : '
        f'<b>{", ".join(cf.missing)}</b>. Dis à l\'outil quelle colonne les '
        f'contient — il ne devinera pas à ta place.</div></div>',
        unsafe_allow_html=True)
    options = ["— aucune —"] + cf.headers
    m = dict(cf.mapping)
    cols = st.columns(3)
    for n, champ in enumerate(("ticket", "symbol", "direction", "open_price",
                               "open_time", "volume", "close_time", "close_price",
                               "sl", "profit")):
        actuel = m.get(champ, "— aucune —")
        choix = cols[n % 3].selectbox(
            champ, options,
            index=options.index(actuel) if actuel in options else 0,
            key=f"map_{key}_{champ}")
        if choix != "— aucune —":
            m[champ] = choix
        else:
            m.pop(champ, None)
    return m


def _resume_csv(cf: CSV.CsvFile, matches: list[CSV.Match]):
    par_type: dict = {}
    for m in matches:
        par_type[m.outcome] = par_type.get(m.outcome, 0) + 1

    c1, c2, c3 = st.columns(3)
    with c1:
        ui.stat("Lignes lues", str(len(cf.rows)),
                note=f"{len(cf.skipped)} ignorée(s) · séparateur « {cf.delimiter} »")
    with c2:
        neuf = par_type.get(CSV.Outcome.NEW_CLOSED, 0) + par_type.get(CSV.Outcome.NEW_OPEN, 0)
        ui.stat("Nouveaux tickets", str(neuf),
                note=f"{par_type.get(CSV.Outcome.KNOWN, 0)} déjà connu(s)")
    with c3:
        ui.stat("Clôtures attendues", str(par_type.get(CSV.Outcome.CLOSES, 0)),
                note="trades déclarés que ce fichier referme")

    if not cf.has_balance:
        st.markdown(
            '<div class="note" style="margin-top:8px">Ce fichier ne contient pas de '
            'colonne <b>solde</b>. La courbe de compte et le drawdown seront donc '
            '<b>reconstitués</b> depuis tes résultats — justes sur les clôtures, '
            'aveugles aux creux intrajournaliers que surveille ta prop firm. '
            'Le rapport HTML MT5, lui, les contient.</div>', unsafe_allow_html=True)


def _appliquer(store: Store, cf: CSV.CsvFile, matches: list[CSV.Match],
               choix_ouverts: dict, account_id: str):
    """Écrit dans le journal ce que le rapprochement a décrit."""
    # C'est ICI que la démonstration meurt : au moment précis où de vraies
    # données entrent. Avant l'écriture, pour que le premier ticket réel
    # atterrisse déjà dans le vrai journal.
    etait_demo = O.demo_mode()
    store, repris = _quitter_la_demo(store)

    # Le PROPRIÉTAIRE est le compte actif (son uid), pas le n° broker du CSV :
    # c'est lui qui cloisonne. Le n° broker du fichier ne sert qu'au rapprochement
    # par ticket, jamais à ranger le trade dans un compte.
    compte = account_id
    positions, liens, ouverts, majs = [], [], 0, 0

    for m in matches:
        if m.outcome == CSV.Outcome.KNOWN:
            continue

        if m.outcome == CSV.Outcome.CLOSES:
            # Le compte du ticket déclaré fait foi : c'est lui qui porte l'idée.
            pos = m.row.to_position(m.open_trade.account_id or compte)
            positions.append(pos)
            liens.append((m.idea_id, pos.uid))

        elif m.outcome == CSV.Outcome.NEW_CLOSED:
            positions.append(m.row.to_position(compte))

        elif m.outcome == CSV.Outcome.UPDATES:
            champs = {}
            if m.row.sl is not None and m.row.sl != m.open_trade.stop:
                champs["stop"] = m.row.sl
            if champs:
                store.update_trade(m.open_trade.uid, **champs)
                majs += 1

        elif m.outcome == CSV.Outcome.NEW_OPEN:
            cible = choix_ouverts.get(m.row.ticket)
            if not cible:
                continue
            if cible == "__horsplan__":
                idea = store.create_thesis(
                    Thesis(instrument=m.row.symbol, direction=m.row.direction,
                           entry_planned=m.row.open_price, stop_initial=m.row.sl,
                           risk_source=RiskSource.UNKNOWN),
                    label=f"{m.row.symbol} {m.row.direction.value} — hors-plan",
                    off_plan=True, account_id=compte)
                cible = idea.id
            store.open_trade(cible, m.row.to_open_trade(compte))
            ouverts += 1

    fresh = store.import_report(positions, CSV.balance_deals(cf, compte))
    for idea_id, uid in liens:
        store.link(idea_id, uid)

    appris = symbols.learn(r.symbol for r in cf.rows)

    st.success(
        f"{len(fresh)} ticket(s) importé(s) · {len(liens)} clôture(s) rattachée(s) "
        f"automatiquement · {ouverts} trade(s) ouvert(s) déclaré(s) · {majs} mise(s) "
        f"à jour." + (f" Symboles appris : {', '.join(appris)}." if appris else ""))

    if etait_demo:
        st.info(
            f"**Fin de la démonstration.** Ces trades sont les tiens : les "
            f"données de démonstration ont été **supprimées** et ton vrai "
            f"journal démarre ici."
            + (f" Les {repris} élément(s) que tu avais écrits toi-même pendant "
               f"la découverte ont été conservés." if repris else ""))


def _import_csv(store: Store, ideas: list[Idea], up, account_id: str):
    cle = up.name.replace(".", "_")
    forced = st.session_state.get(f"map_forced_{cle}")

    try:
        cf = CSV.parse(up.getvalue(), mapping=forced)
    except CSV.CsvError as e:
        st.error(str(e))
        return

    if cf.missing:
        m = _mapping_manuel(cf, cle)
        if st.button("Relire le fichier avec ce mapping", type="primary"):
            st.session_state[f"map_forced_{cle}"] = m
            st.rerun()
        return

    # Le ticket est facultatif à l'armage, obligatoire ici : une idée armée
    # présente dans ce fichier doit recevoir son ticket AVANT tout rapprochement,
    # sinon l'appariement devinerait. Tant qu'il en manque, on ne va pas plus loin.
    if _completer_tickets(store, ideas, cf, cle, account_id):
        return

    _, positions, _ = store.load()
    pending = store.pending_trades()
    matches = CSV.reconcile(cf, positions, pending)

    ui.rule()
    _resume_csv(cf, matches)
    ui.rule()

    ui.eyebrow(f"rapprochement · {up.name}")
    lignes = []
    for m in matches:
        cls, texte = _MOMENTS[m.outcome]
        lignes.append(
            f'<tr><td class="note tight">#{m.row.ticket}</td>'
            f'<td class="tight"><b>{m.row.symbol}</b></td>'
            f'<td class="tight">{m.row.direction.value}</td>'
            f'<td class="num">{ui.fmt_price(m.row.open_price)}</td>'
            f'<td class="num">{ui.fmt_money(m.row.profit) if m.row.profit is not None else "—"}</td>'
            f'<td class="num"><span class="chip {cls}">{texte}</span></td></tr>')
    st.markdown(
        '<table class="t"><tr><th>ticket</th><th>symbole</th><th>sens</th>'
        '<th style="text-align:right">entrée</th>'
        '<th style="text-align:right">résultat</th>'
        '<th style="text-align:right">rapprochement</th></tr>'
        + "".join(lignes) + "</table>", unsafe_allow_html=True)

    if cf.skipped:
        with st.expander(f"{len(cf.skipped)} ligne(s) ignorée(s)"):
            st.markdown("".join(
                f'<div class="note">ligne {n} — {raison}</div>'
                for n, raison in cf.skipped), unsafe_allow_html=True)

    # --- les trades encore ouverts ont besoin d'une idée d'accueil
    ouverts = [m for m in matches if m.outcome == CSV.Outcome.NEW_OPEN]
    choix_ouverts: dict[str, str] = {}
    if ouverts:
        ui.rule()
        ui.eyebrow("trades ouverts non déclarés")
        st.markdown(
            '<div class="note">Ces tickets sont encore ouverts et tu ne les avais '
            'pas déclarés. Un trade ne peut pas vivre sans idée : rattache-le à une '
            'idée armée, ou assume le hors-plan. Les laisser « — ne pas importer — » '
            'est aussi une réponse.</div>', unsafe_allow_html=True)
        for m in ouverts:
            armees = [i for i in ideas
                      if i.status == IdeaStatus.ARMED and i.thesis
                      and i.thesis.instrument.upper() == m.row.symbol.upper()
                      and i.thesis.direction == m.row.direction]
            options = {"— ne pas importer —": None}
            for i in armees:
                options[f"{i.display_name} (armée le {i.created_at:%d/%m})"] = i.id
            options["Trade hors-plan — créer une idée vide"] = "__horsplan__"
            pick = st.selectbox(
                f"#{m.row.ticket} · {m.row.symbol} {m.row.direction.value} "
                f"@ {ui.fmt_price(m.row.open_price)}",
                list(options), key=f"open_pick_{m.row.ticket}")
            choix_ouverts[m.row.ticket] = options[pick]

    ui.rule()
    a_faire = [m for m in matches if m.outcome != CSV.Outcome.KNOWN]
    if not a_faire:
        st.markdown('<div class="note">Rien de neuf dans ce fichier. '
                    'L\'import est idempotent : c\'est le résultat attendu.</div>',
                    unsafe_allow_html=True)
        return

    if st.button(f"Appliquer — {len(a_faire)} ligne(s)", type="primary"):
        _appliquer(store, cf, matches, choix_ouverts, account_id)
        st.session_state.pop(f"map_forced_{cle}", None)
        st.rerun()


# -------------------------------------------------------------- import HTML

def _import_html(store: Store, up):
    tmp = Path(tempfile.gettempdir()) / up.name
    tmp.write_bytes(up.getvalue())

    try:
        report = parse_report(tmp)
    except ParseError as e:
        st.error(str(e))
        return
    except Exception as e:
        st.error(f"Lecture impossible : {e}")
        return

    c1, c2, c3 = st.columns(3)
    with c1:
        ui.stat("Compte", report.account_id, note=f"{report.broker} · {report.currency}")
    with c2:
        ui.stat("Positions", str(len(report.positions)),
                note=f"{len(report.deals)} transactions")
    with c3:
        total = sum(p.pnl_net for p in report.positions)
        ui.stat("P&L net du fichier", ui.fmt_money(total), ui.tone_of(total))

    _, existing, _ = store.load()
    fresh = [p for p in report.positions if p.uid not in existing]

    st.markdown(
        f'<div class="note">{len(fresh)} nouveau(x) ticket(s) · '
        f'{len(report.positions) - len(fresh)} déjà connu(s), ignoré(s). '
        f'Ce format contient la table <b>Ordres</b> : les stops jamais déplacés '
        f'seront récupérés et marqués <b>prouvés</b>.</div>',
        unsafe_allow_html=True)

    if not fresh:
        return

    if st.button(f"Importer {len(fresh)} ticket(s)", type="primary"):
        # Même règle que pour le CSV : de vraies données mettent fin à la démo.
        store, _ = _quitter_la_demo(store)
        store.import_report(report.positions, report.deals)
        appris = symbols.learn(p.symbol for p in report.positions)
        if appris:
            st.info("Nouveaux symboles appris : " + ", ".join(appris))
        st.rerun()


# ------------------------------------------------------------------- la page

CYCLE = [
    ("à l'ouverture — saisie manuelle",
     "Tu poses la thèse, le niveau d'invalidation et une ou plusieurs captures, "
     "puis tu déclares le ticket. L'idée entre à l'état « en cours »."),
    ("pendant — état vivant",
     "Le trade reste ouvert dans le journal : stop déplaçable, captures ajoutables, "
     "flottant indicatif si tu saisis un cours."),
    ("à la clôture — import CSV",
     "L'export met à jour le trade PAR SON TICKET : prix de sortie, P&L réel, durée. "
     "Aucun doublon, aucune ressaisie."),
    ("après — analyse",
     "Le trade rejoint la matrice décision × résultat, le R, la compliance et tes "
     "statistiques. C'est là que la thèse écrite avant peut te contredire."),
]


def render(store: Store, ideas: list[Idea], account_id: str = ""):
    if _match_wizard(store, ideas):
        return

    ui.title("Importer des trades",
             "Dépose l'export de ton terminal. Les trades sont rapprochés par "
             "numéro de ticket : un trade déjà ouvert est mis à jour, jamais dupliqué.")

    gauche, droite = st.columns([1, 1])

    with gauche:
        ui.eyebrow("fichier")
        up = st.file_uploader(
            "Export de trades", type=["csv", "txt", "html", "htm"],
            help="CSV : MT4, MT5, cTrader ou générique. HTML : rapport "
                 "d'historique MT5 (onglet Historique → clic droit → Rapport).")
        st.markdown(
            '<div class="chips">'
            '<span class="chip ok">✓ MetaTrader 4</span>'
            '<span class="chip ok">✓ MetaTrader 5</span>'
            '<span class="chip ok">✓ cTrader</span>'
            '<span class="chip">CSV générique</span>'
            '<span class="chip">rapport HTML MT5</span></div>',
            unsafe_allow_html=True)

    with droite:
        ui.eyebrow("le cycle d'un trade")
        st.markdown("".join(
            f'<div style="display:flex;gap:12px;padding:8px 0">'
            f'<div class="mono" style="color:{T.ACCENT};font-weight:700">{n}</div>'
            f'<div><div class="eyebrow" style="margin:0">{titre}</div>'
            f'<div class="note">{texte}</div></div></div>'
            for n, (titre, texte) in enumerate(CYCLE, 1)),
            unsafe_allow_html=True)

    if not up:
        return

    if up.name.lower().endswith((".html", ".htm")):
        ui.rule()
        _import_html(store, up)
    else:
        _import_csv(store, ideas, up, account_id)
