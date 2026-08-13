"""
Le détail d'une idée : ce que tu obtiens en cliquant une ligne du journal.

C'est ici que l'architecture paie. En haut, l'idée : ce que tu avais dit, ce que
le marché a répondu. Au milieu, le trade TANT QU'IL VIT — ticket, stop réel,
captures. En dessous, les tickets clôturés qui la composent, et la seule
question qui vaille à ce niveau : mes renforcements m'ont-ils rapporté ?
"""
from __future__ import annotations

from decimal import Decimal

import streamlit as st

from core import captures as CAP
from core import clock
from core.models import (
    Campaign, CaptureKind, Idea, OpenTrade, Quadrant, Review,
    StopEvidence, ThesisOutcome,
)
from core.store import Store
from .. import theme as T
from .. import ui


# On n'affiche JAMAIS la valeur brute de l'enum (« non_testee ») à l'écran :
# un libellé de code n'explique rien. Ces trois réponses disent, chacune, ce que
# le marché a fait de ta thèse — indépendamment de ton P&L.
_VERDICT_MARCHE = {
    ThesisOutcome.CORRECT: "Correcte — le marché est allé où je pensais",
    ThesisOutcome.WRONG: "Fausse — le marché a fait l'inverse",
    ThesisOutcome.UNTESTED: "Non testée — je suis sorti avant qu'il tranche",
}
_VERDICT_COURT = {
    ThesisOutcome.CORRECT: "correcte",
    ThesisOutcome.WRONG: "fausse",
    ThesisOutcome.UNTESTED: "non testée",
}


def _thesis_block(idea: Idea):
    t = idea.thesis
    if t is None:
        return

    ui.eyebrow("thèse & invalidation")
    st.markdown(
        f'<div class="note" style="margin-bottom:10px">'
        f'Écrit le {idea.created_at:%d/%m/%Y à %H:%M}'
        f'{" — avant l\'ouverture du premier ticket" if idea.opened_at and idea.created_at <= idea.opened_at else ""}.'
        f'</div>', unsafe_allow_html=True)

    st.markdown(
        f'<div class="card">'
        f'<div class="eyebrow">catalyseur macro</div>'
        f'<b>{t.macro_theme or "—"}</b>'
        f'{" · " + t.catalyst if t.catalyst else ""}'
        f'<p style="font-size:0.86rem;margin-top:6px">{t.macro_note or "—"}</p>'
        f'<hr class="rule" style="margin:14px 0 12px 0">'
        f'<div class="eyebrow">signal technique</div>'
        f'<b>{t.setup or "—"}</b> <span class="chip">{t.timeframe or "—"}</span>'
        f'<p style="font-size:0.86rem;margin-top:6px">{t.technical_note or "—"}</p>'
        f'<hr class="rule" style="margin:14px 0 12px 0">'
        f'<div class="eyebrow">niveau d\'invalidation</div>'
        f'<p style="font-size:0.86rem">{t.thesis_kill_switch or "—"} '
        f'<span class="txt-loss">Stop technique {ui.fmt_price(t.stop_initial)}.</span></p>'
        f'<div class="note">L\'invalidation de la THÈSE est distincte du stop : '
        f'elle tue l\'idée même si le prix ne touche pas ton stop.</div>'
        f'</div>', unsafe_allow_html=True)


def _declarer_ouverture(store: Store, idea: Idea):
    """
    « Je viens d'entrer. » La déclaration du ticket, au moment vrai : quand tu
    entres réellement, pas quand tu écris l'idée. L'idée passe « en cours », le
    stop réel est enregistré avant que le broker ne l'écrase, et le numéro de
    ticket devient la clé qui clôturera ce trade à l'import — sans doublon.
    """
    t = idea.thesis
    ui.eyebrow("je viens d'entrer")
    st.markdown(
        '<div class="note">Déclare le numéro de ticket que t\'affiche ton '
        'terminal : l\'idée passe <b>en cours</b>, et ton prochain import '
        'clôturera ce trade tout seul. Le volume et l\'entrée réelle viendront de '
        'l\'export — rien d\'autre à saisir.</div>', unsafe_allow_html=True)
    with st.form(f"declare_{idea.id}"):
        ticket = st.text_input("N° de ticket",
                               placeholder="celui affiché par ton terminal")
        if st.form_submit_button("Déclarer le ticket ouvert", type="primary"):
            if not ticket.strip():
                st.error("Le numéro de ticket est indispensable : c'est la clé "
                         "qui permettra à l'import de clôturer ce trade.")
            else:
                store.open_trade(idea.id, OpenTrade(
                    ticket=ticket.strip(), symbol=t.instrument,
                    direction=t.direction, volume=Decimal("0"),
                    open_time=clock.server_now(),
                    open_price=t.entry_planned or Decimal("0"),
                    account_id=idea.account_id, stop=t.stop_initial))
                st.rerun()
    ui.rule()


def _open_block(store: Store, idea: Idea, spec_book):
    """
    Le trade PENDANT qu'il vit.

    Trois choses seulement, parce que trois choses seulement se font pendant un
    trade : constater où on en est, déplacer le stop, joindre une capture.
    Aucune review ici — juger un trade en cours, c'est juger le hasard.
    """
    if not idea.open_trades:
        # Idée armée, aucun ticket encore déclaré : c'est ICI qu'on déclare
        # l'entrée (déplacé depuis le formulaire de création). Uniquement si rien
        # n'est encore clôturé — un trade clos ne se « rouvre » pas.
        if not idea.is_executed and idea.thesis:
            _declarer_ouverture(store, idea)
        return

    ui.eyebrow(f"{len(idea.open_trades)} ticket(s) en cours")
    for o in idea.open_trades:
        pv = spec_book.point_value_for(o.symbol) if spec_book else None
        flot = o.floating_pnl(pv)

        c1, c2, c3, c4 = st.columns([1.3, 1, 1, 1.2])
        with c1:
            ui.stat("Ticket", o.ticket,
                    note=f"{o.symbol} · {o.direction.value} · {o.volume} lot")
        with c2:
            ui.stat("Entrée", ui.fmt_price(o.open_price),
                    note=f"ouvert le {o.open_time:%d/%m %H:%M}")
        with c3:
            ui.stat("Stop placé", ui.fmt_price(o.stop),
                    note="déclaré à l'ouverture" if o.stop else "non déclaré")
        with c4:
            if flot is not None:
                ui.stat("Flottant", ui.fmt_money(flot), ui.tone_of(flot),
                        note=f"cours {ui.fmt_price(o.last_price)} saisi le "
                             f"{o.last_price_at:%d/%m %H:%M}" if o.last_price_at
                             else "cours saisi à la main")
            else:
                ui.stat("Flottant", "—", note="aucun cours saisi")

        with st.expander(f"Mettre à jour le ticket {o.ticket}"):
            st.markdown(
                '<div class="note">L\'outil n\'a <b>aucun flux de prix</b>. Le cours '
                'que tu saisis ici sert à afficher un flottant indicatif, horodaté, '
                'et rien d\'autre : il n\'entre dans aucune statistique. Le stop, '
                'lui, compte — c\'est lui qui fixera ton R si le broker l\'écrase.</div>',
                unsafe_allow_html=True)
            a, b, c = st.columns(3)
            cours = a.number_input("Cours actuel", min_value=0.0, value=0.0,
                                   step=0.01, format="%.5f", key=f"px_{o.uid}")
            nstop = b.number_input("Nouveau stop", min_value=0.0, value=0.0,
                                   step=0.01, format="%.5f", key=f"st_{o.uid}")
            note = c.text_input("Note", key=f"nt_{o.uid}",
                                placeholder="passé au BE après le CPI")
            g, d = st.columns(2)
            if g.button("Enregistrer", key=f"upd_{o.uid}", type="primary"):
                champs = {}
                if cours > 0:
                    champs["last_price"] = Decimal(str(cours))
                    champs["last_price_at"] = clock.server_now()
                if nstop > 0:
                    champs["stop"] = Decimal(str(nstop))
                if note:
                    champs["note"] = note
                if champs:
                    store.update_trade(o.uid, **champs)
                    st.rerun()
                else:
                    st.error("Rien à enregistrer.")
            if d.button("Ce ticket n'existe pas — annuler la déclaration",
                        key=f"cxl_{o.uid}"):
                store.cancel_trade(o.uid, reason="déclaré par erreur")
                st.rerun()

    st.markdown(
        '<div class="note">Ce trade sera <b>clôturé automatiquement</b> par ton '
        'prochain import : le numéro de ticket sert de clé, les données réelles '
        '(sortie, P&L, durée) viendront de l\'export. Rien à ressaisir.</div>',
        unsafe_allow_html=True)


def _captures_block(store: Store, idea: Idea, data_dir):
    ui.eyebrow("captures du trade")
    st.markdown(
        '<div class="note">Le graphique à l\'entrée, le ticket d\'ordre, la sortie. '
        'Une capture jointe au moment du trade est une donnée <b>pré-engagée</b> : '
        'l\'image horodate ce que tu voyais.</div>', unsafe_allow_html=True)

    ui.gallery(data_dir, idea.attachments, per_row=3,
               on_remove=lambda aid: (store.remove_capture(aid), st.rerun()),
               key_prefix=idea.id)

    with st.expander("Ajouter des captures"):
        fichiers = st.file_uploader(
            "Images", type=["png", "jpg", "jpeg", "webp", "gif"],
            accept_multiple_files=True, key=f"add_shots_{idea.id}")
        c1, c2 = st.columns([1, 2])
        moment = c1.selectbox("Moment", [k.value for k in CaptureKind],
                              format_func=lambda v: ui.KIND_LABELS.get(v, v),
                              key=f"kind_{idea.id}")
        legende = c2.text_input("Légende", key=f"cap_{idea.id}",
                                placeholder="H4 · cassure de 71.10 sur volume")
        if st.button("Joindre", key=f"join_{idea.id}", type="primary"):
            n = 0
            for f in fichiers or []:
                try:
                    att = CAP.save(data_dir, "idea", idea.id, f.name, f.getvalue(),
                                   kind=CaptureKind(moment), caption=legende)
                except CAP.CaptureError as e:
                    st.error(f"{f.name} : {e}")
                    continue
                store.add_capture(att)
                n += 1
            if n:
                st.rerun()
            else:
                st.error("Aucune image à joindre.")


def _quadrant_block(idea: Idea):
    """La matrice décision × résultat, avec la case de CETTE idée allumée."""
    q = idea.quadrant
    cases = [
        (Quadrant.LUCK, "luck", "Gain<br>mauvais process", "Chance ⚠"),
        (Quadrant.MASTERY, "mastery", "Gain<br>bon process", "Maîtrise ✓"),
        (Quadrant.ERROR, "error", "Perte<br>mauvais process", "Erreur ✗"),
        (Quadrant.VARIANCE, "variance", "Perte<br>bon process", "Aléa OK"),
    ]
    ui.eyebrow("décision × résultat")
    html = ['<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">']
    for quad, cls, titre, verdict in cases:
        actif = "box-shadow:0 0 0 2px currentColor;" if quad == q else "opacity:.55;"
        html.append(
            f'<div class="quad {cls}" style="{actif}">'
            f'<div class="lab">{titre}</div>'
            f'<div class="n" style="font-size:1rem;margin-top:14px">{verdict}</div>'
            f'</div>')
    html.append("</div>")
    st.markdown("".join(html), unsafe_allow_html=True)

    messages = {
        Quadrant.MASTERY: ("ok", "Maîtrise.", "Thèse posée avant l'entrée, "
                           "invalidation respectée, sizing dans les règles. Le gain "
                           "récompense un bon process — à répliquer, pas juste à célébrer."),
        Quadrant.LUCK: ("bad", "Chance.", "Le process a dérapé et ça a payé quand "
                        "même. C'est le quadrant le plus dangereux du tableau : "
                        "c'est celui qu'on répète."),
        Quadrant.ERROR: ("bad", "Erreur.", "Process dégradé, résultat négatif. "
                         "C'est le seul quadrant dont le coût était évitable."),
        Quadrant.VARIANCE: ("sig", "Aléa OK.", "Tu as perdu en respectant ton plan. "
                            "C'est le coût normal du métier, pas une faute — "
                            "rien à corriger ici."),
        Quadrant.PENDING: ("", "En attente.",
                           "Le verdict exige la review : sans elle, le process n'est "
                           "pas jugé, et l'outil n'invente pas ce qu'il ne sait pas."),
    }
    cls, titre, texte = messages[q]
    couleur = {"ok": T.GAIN, "bad": T.LOSS, "sig": T.SIGNAL}.get(cls, T.MUTED)
    st.markdown(
        f'<div class="card" style="border-left:3px solid {couleur}">'
        f'<b style="color:{couleur}">{titre}</b> '
        f'<span class="note">{texte}</span></div>', unsafe_allow_html=True)


def _execution_block(idea: Idea, spec_book, equity_ref: Decimal):
    """Qualité d'exécution : ce que la review a mesuré, pas ce qu'elle a ressenti."""
    r = idea.review
    if r is None:
        return
    ui.eyebrow("qualité d'exécution")
    conf = idea.size_conformity(equity_ref, spec_book)
    lignes = [
        ("Respect du plan", f"{r.discipline_score}/5",
         "entrée, taille, stop, non-élargissement, sortie",
         "gain" if r.discipline_score >= 4 else "loss"),
        ("Thèse", _VERDICT_COURT[r.thesis_outcome],
         "verdict du marché, indépendant du P&L", ""),
        ("Émotion", r.emotional_state or "—", "déclaratif", ""),
        ("Sizing", f"{float(conf):.2f}×" if conf else "—",
         "risque réel / risque annoncé — mesuré",
         "loss" if conf and float(conf) > 1.15 else "gain"),
    ]
    st.markdown(
        "".join(
            f'<div style="display:flex;justify-content:space-between;'
            f'align-items:baseline;padding:10px 0;border-bottom:1px solid {T.RULE_SOFT}">'
            f'<div><div class="eyebrow" style="margin:0">{lab}</div>'
            f'<div class="note">{note}</div></div>'
            f'<div class="mono {tone}" style="font-weight:600">{val}</div></div>'
            for lab, val, note, tone in lignes),
        unsafe_allow_html=True)


def _risk_block(idea: Idea, spec_book, equity_ref: Decimal):
    t = idea.thesis
    risk = idea.risk_realized(spec_book)
    peak = idea.max_concurrent_risk(spec_book)
    plan = idea.risk_planned(equity_ref)
    init = idea.initial_position

    ui.eyebrow("le risque")

    c1, c2, c3, c4 = st.columns(4)
    with c1:
        ui.stat("Risque voulu", ui.fmt_money(plan).lstrip("+") if plan else "—",
                note=f"{t.risk_pct} % du compte" if t and t.risk_pct else "ta thèse")
    with c2:
        if idea.is_running:
            # Un trade en cours engage un risque MAINTENANT : l'afficher comme
            # « somme de 0 ticket » serait absurde, et masquer la seule ligne de
            # risque réellement à l'écran au moment où elle compte le plus.
            ouvert = idea.risk_open(spec_book)
            ui.stat("Risque engagé — en cours",
                    ui.fmt_money(ouvert).lstrip("+") if ouvert else "—",
                    note=(f"{len(idea.open_trades)} ticket(s) ouvert(s)" if ouvert
                          else "valeur du point pas encore apprise sur ce symbole"))
        else:
            ui.stat("Risque total engagé",
                    ui.fmt_money(risk).lstrip("+") if risk else "—",
                    note=f"somme des {len(idea.positions)} ticket(s)")
    with c3:
        if peak:
            pct = float(peak) / float(equity_ref) * 100
            over = plan and peak > plan * Decimal("1.15")
            mesure = idea.exposure_is_measured()
            ui.stat("Exposition simultanée", f"{pct:.2f} %", "loss" if over else "",
                    note=(ui.fmt_money(peak).lstrip("+") + " au pire moment"
                          if mesure else
                          "MAJORANT — coche le breakeven de tes adds pour mesurer"))
    with c4:
        if plan and peak:
            ratio = float(peak / plan)
            ui.stat("Dérive", f"{ratio:.2f}×", "loss" if ratio > 1.15 else "gain",
                    note="exposition réelle / annoncée")

    if plan and peak and peak > plan * Decimal("1.15"):
        pct_peak = float(peak) / float(equity_ref) * 100
        st.markdown(
            f'<div class="card" style="border-left:3px solid {T.LOSS}">'
            f'<div class="eyebrow">exposition non déclarée</div>'
            f'<div class="note">Ta thèse annonçait <b>{t.risk_pct} %</b>. '
            f'Tes renforcements t\'ont porté à <b>{pct_peak:.2f} %</b> exposés '
            f'simultanément. Les adds n\'étaient pas gratuits : chacun portait '
            f'son propre stop complet.</div></div>', unsafe_allow_html=True)

    if not idea.positions:
        return

    risks = idea.ticket_risks(spec_book)
    rows = []
    for p in sorted(idea.positions, key=lambda x: x.open_time):
        r = risks.get(p.position_id)
        stop, _ = idea.stop_for(p)
        rows.append(
            f'<tr><td>{p.position_id}</td>'
            f'<td class="num">{ui.fmt_price(p.open_price)}</td>'
            f'<td class="num">{ui.fmt_price(stop) if stop else "—"}</td>'
            f'<td class="num">{ui.fmt_money(r).lstrip("+") if r else "non calculable"}</td></tr>')

    st.markdown(
        '<table class="t"><tr><th>ticket</th><th style="text-align:right">entrée</th>'
        '<th style="text-align:right">stop</th>'
        '<th style="text-align:right">risque</th></tr>'
        + "".join(rows) + "</table>", unsafe_allow_html=True)

    st.markdown(
        '<div class="note" style="margin-top:8px">'
        'Quand l\'export ne contient pas de stop — un ordre au marché, par '
        'exemple — c\'est celui de ton idée qui sert : il a été écrit avant le '
        'trade.</div>', unsafe_allow_html=True)

    if init and init.sl_final and t and t.stop_initial:
        risk_mt5 = init.volume * abs(init.open_price - init.sl_final) * (
            spec_book.point_value(init) or Decimal(1))
        if risk_mt5 > 0:
            r_mt5 = idea.pnl_net / risk_mt5
            r_vrai = idea.r_multiple(spec_book)
            if r_vrai and abs(float(r_mt5) - float(r_vrai)) > 1:
                st.markdown(
                    f'<div class="card" style="border-left:3px solid {T.LOSS}">'
                    f'<div class="eyebrow">pourquoi ton stop ne peut pas venir du broker</div>'
                    f'<div class="mono" style="font-size:0.85rem">'
                    f'Dernier stop archivé : {init.sl_final} → '
                    f'<b style="color:{T.LOSS}">{float(r_mt5):+.1f} R</b><br>'
                    f'Stop initial de ta thèse : {t.stop_initial} → '
                    f'<b style="color:{T.GAIN}">{float(r_vrai):+.2f} R</b>'
                    f'</div>'
                    f'<div class="note">Le broker n\'archive que le <i>dernier</i> stop '
                    f'connu. Sur ce trade, tu l\'as déplacé. Le R issu du fichier est '
                    f'faux.</div></div>', unsafe_allow_html=True)


def _missing_stops_block(store: Store, idea: Idea, spec_book):
    """
    Les tickets dont le stop reste introuvable.

    Ce cas s'est beaucoup raréfié : à défaut de stop dans l'export, celui de
    l'idée s'applique désormais à TOUS les tickets. Il ne reste donc que les
    idées écrites sans stop du tout — et là, aucun R n'est calculable, ce n'est
    pas une opinion mais une division par rien.

    La correction se fait ici, sans qualifier la donnée : un chiffre saisi est
    un chiffre saisi.
    """
    manquants = idea.tickets_needing_stop()
    if not manquants:
        return

    st.markdown(
        f'<div class="card" style="border-left:3px solid {T.LOSS}">'
        f'<div class="eyebrow">{len(manquants)} ticket(s) sans stop</div>'
        f'<div class="note">Ni l\'export ni ton idée ne portent de stop pour '
        f'ce(s) ticket(s). <b>Tant qu\'un seul reste vide, le R de cette idée '
        f'n\'est pas calculable</b> — le plus simple est de renseigner le stop de '
        f'l\'idée, il s\'appliquera à tous.</div></div>', unsafe_allow_html=True)

    for p in sorted(manquants, key=lambda x: x.open_time):
        c1, c2 = st.columns([2, 1.1])
        with c1:
            st.markdown(
                f'<div class="mono" style="font-size:0.9rem">'
                f'Ticket <b>{p.position_id}</b> · {p.direction.value} · {p.volume} lot<br>'
                f'<span class="note">ouvert le {p.open_time:%d/%m à %H:%M} '
                f'à {p.open_price}</span></div>', unsafe_allow_html=True)
        with c2:
            val = st.number_input(
                "Stop", min_value=0.0, value=0.0, step=0.01,
                format="%.5f", key=f"ms_{idea.id}_{p.uid}",
                label_visibility="collapsed", placeholder="stop de ce ticket")
            if st.button("Enregistrer", key=f"msb_{idea.id}_{p.uid}"):
                if val <= 0:
                    st.error("Saisis un prix.")
                else:
                    ok = ((p.direction.value == "sell" and val > float(p.open_price))
                          or (p.direction.value == "buy" and val < float(p.open_price)))
                    if not ok:
                        st.error(
                            f"Sur un {p.direction.value}, le stop doit être "
                            f"{'au-dessus' if p.direction.value == 'sell' else 'en dessous'}"
                            f" de l'entrée ({p.open_price}).")
                    else:
                        store.set_ticket_stop(idea.id, p.uid, Decimal(str(val)),
                                              StopEvidence.CAPTURE)
                        st.rerun()


def _campaign_block(store: Store, idea: Idea, campaigns: dict):
    """Rattachement OPTIONNEL à une thèse macro."""
    ui.eyebrow("thèse macro")
    st.markdown(
        '<div class="note">Facultatif. Une thèse macro regroupe plusieurs idées '
        'sur des instruments <b>différents</b> — un « dollar fort » joué en short '
        'EURUSD <i>et</i> en long USDJPY. Le R de la thèse est la somme des R de '
        'ses idées.</div>', unsafe_allow_html=True)

    noms = {c.display_name: cid for cid, c in campaigns.items() if not c.closed}
    actuel = campaigns.get(idea.campaign_id).display_name if \
        idea.campaign_id and idea.campaign_id in campaigns else "— aucune —"

    options = ["— aucune —"] + sorted(noms)
    choix = st.selectbox("Rattacher cette idée à", options,
                         index=options.index(actuel) if actuel in options else 0,
                         key=f"camp_{idea.id}")

    if st.button("Appliquer", key=f"campb_{idea.id}"):
        if choix == "— aucune —":
            if idea.campaign_id:
                store.detach(idea.id)
        else:
            store.attach(idea.id, noms[choix])
        st.rerun()


def _disjoints_block(store: Store, idea: Idea):
    """
    Les tickets rattachés à tort — ceux qui ne chevauchent aucun autre.

    Le détachement est possible parce que le journal est append-only : on
    n'efface pas le rattachement, on en ajoute l'annulation. Le ticket redevient
    orphelin et l'écran d'appariement le repropose, cette fois vers la bonne
    idée.
    """
    fautifs = idea.tickets_disjoints
    if not fautifs:
        return

    st.markdown(
        f'<div class="card" style="border-left:3px solid {T.LOSS}">'
        f'<div class="eyebrow">{len(fautifs)} ticket(s) qui ne sont pas des renforcements</div>'
        f'<div class="note">Un renforcement s\'ouvre <b>pendant</b> que l\'idée '
        f'vit. Ces tickets se sont ouverts après la clôture de tous les autres : '
        f'ce sont d\'autres trades, avec leur propre thèse et leur propre '
        f'conviction.<br><br>Tant qu\'ils restent ici, leurs risques '
        f's\'additionnent à celui de l\'idée et le <b>R affiché est faux</b>.</div>'
        f'</div>', unsafe_allow_html=True)

    for p in sorted(fautifs, key=lambda x: x.open_time):
        c1, c2 = st.columns([2.2, 1])
        with c1:
            st.markdown(
                f'<div class="mono" style="font-size:0.9rem">'
                f'Ticket <b>#{p.position_id}</b> · {p.volume} lot · '
                f'ouvert le {p.open_time:%d/%m à %H:%M}<br>'
                f'<span class="note">le dernier ticket encore actif s\'était '
                f'clôturé avant cette ouverture</span></div>',
                unsafe_allow_html=True)
        with c2:
            if st.button("Détacher ce ticket", key=f"unlink_{idea.id}_{p.uid}",
                         type="primary"):
                store.unlink(idea.id, p.uid)
                st.rerun()


def _secured_block(store: Store, idea: Idea):
    """La case BE, corrigeable après coup depuis le détail de l'idée."""
    if not idea.adds:
        return

    ui.eyebrow("le breakeven de tes renforcements")
    st.markdown(
        '<div class="note">Un noyau passé au breakeven ne risque plus rien : son '
        'risque sort du calcul d\'exposition simultanée à l\'instant où tu ajoutes. '
        'Aucun broker n\'archive l\'heure de tes déplacements de stop — et sur '
        'mobile, aucun journal n\'existe. Cette case est la seule source possible.</div>',
        unsafe_allow_html=True)

    changed = False
    for a in sorted(idea.adds, key=lambda p: p.open_time):
        cur = idea.secured_on_add.get(a.uid)
        val = st.checkbox(
            f"Ticket {a.position_id} ({a.open_time:%d/%m %H:%M}) — "
            f"mon noyau était déjà au breakeven",
            value=bool(cur), key=f"sec_{idea.id}_{a.uid}")
        if cur is None or val != cur:
            if st.button("Enregistrer", key=f"savesec_{idea.id}_{a.uid}"):
                store.set_secured(idea.id, a.uid, val)
                changed = True

    if changed:
        st.rerun()

    if not idea.exposure_is_measured():
        st.markdown(
            f'<div class="note txt-warn">'
            f'Tant qu\'un renforcement reste sans réponse, l\'exposition affichée '
            f'est un <b>majorant</b>, pas une mesure : l\'outil suppose le pire.</div>',
            unsafe_allow_html=True)


def _tickets_block(idea: Idea):
    if not idea.positions:
        return
    ui.eyebrow("les tickets clôturés")
    st.markdown(
        f'<div class="note">Le broker compte {len(idea.positions)} trade(s). '
        f'Tu as pris 1 décision. Le détail ne sert qu\'à répondre à une question : '
        f'mes renforcements me rapportent-ils ?</div>', unsafe_allow_html=True)

    init = idea.initial_position
    rows = []
    reprises = 0
    for p in sorted(idea.positions, key=lambda x: x.open_time):
        role = "initial" if p is init else "add"
        tone = ui.tone_of(p.pnl_net)
        stop, source = idea.stop_for(p)
        if source == "ton idée" and p is not init:
            reprises += 1
        rows.append(
            f'<tr>'
            f'<td><span class="chip {"sig" if role == "initial" else ""}">{role}</span></td>'
            f'<td>{p.position_id}</td>'
            f'<td>{p.open_time:%d/%m %H:%M}</td>'
            f'<td>{p.close_time:%d/%m %H:%M}</td>'
            f'<td class="num">{p.volume}</td>'
            f'<td class="num">{ui.fmt_price(p.open_price)}</td>'
            f'<td class="num">{ui.fmt_price(stop) if stop else "—"}</td>'
            f'<td class="note">{source}</td>'
            f'<td class="num {tone}">{ui.fmt_money(p.pnl_net)}</td>'
            f'</tr>')

    st.markdown(
        '<table class="t"><tr><th>rôle</th><th>ticket</th><th>ouverture</th>'
        '<th>clôture</th>'
        '<th style="text-align:right">vol</th><th style="text-align:right">entrée</th>'
        '<th style="text-align:right">stop</th><th>d\'où il vient</th>'
        '<th style="text-align:right">P&L net</th></tr>'
        + "".join(rows) + "</table>", unsafe_allow_html=True)

    st.markdown(
        '<div class="note" style="margin-top:6px">Le noyau prend le stop de '
        'ton idée quand l\'export n\'en porte pas. Un <b>renforcement</b>, non : '
        'il peut avoir été pris plus serré, et l\'outil ne le devine pas — il '
        'te le demande.</div>', unsafe_allow_html=True)

    if idea.adds:
        init_pnl, adds_pnl = idea.pnl_initial, idea.pnl_adds
        verdict = ""
        if init_pnl > 0 and idea.pnl_net < 0:
            verdict = ("Ton ticket initial gagnait. Tes renforcements ont transformé "
                       "une idée gagnante en idée perdante.")
        elif adds_pnl > 0:
            verdict = "Tes renforcements ont ajouté de la performance sur cette idée."
        elif adds_pnl < 0:
            verdict = "Tes renforcements ont coûté sur cette idée."

        c1, c2, c3 = st.columns([1, 1, 2])
        with c1:
            ui.stat("Ticket initial", ui.fmt_money(init_pnl), ui.tone_of(init_pnl))
        with c2:
            ui.stat(f"{len(idea.adds)} renforcement(s)", ui.fmt_money(adds_pnl),
                    ui.tone_of(adds_pnl))
        with c3:
            if verdict:
                st.markdown(f'<div class="eyebrow">verdict</div>'
                            f'<div class="note">{verdict}</div>', unsafe_allow_html=True)


def _review_form(store: Store, idea: Idea):
    r = idea.review
    if idea.is_running:
        st.markdown(
            f'<div class="card" style="border-left:3px solid {T.ACCENT}">'
            f'<div class="eyebrow">review — pas maintenant</div>'
            f'<div class="note">Ce trade est encore en cours. Une review écrite '
            f'avant la clôture juge un résultat qui n\'existe pas : elle attendra '
            f'l\'import qui referme le ticket.</div></div>', unsafe_allow_html=True)
        return

    ui.eyebrow("la review")
    st.markdown(
        '<div class="note">Cinq critères objectifs, pas un « j\'ai respecté mon plan » '
        'booléen. Un booléen se note généreusement ; une checklist se vérifie.</div>',
        unsafe_allow_html=True)

    with st.form(f"review_{idea.id}"):
        c1, c2 = st.columns(2)
        with c1:
            entry_ok = st.checkbox("Entrée dans la zone prévue",
                                   value=r.entry_in_zone if r else False)
            size_ok = st.checkbox("Taille conforme au risque défini",
                                  value=r.size_conforme if r else False)
            stop_ok = st.checkbox("Stop placé à l'invalidation annoncée",
                                  value=r.stop_at_invalidation if r else False)
        with c2:
            widen_ok = st.checkbox("Stop jamais élargi ni retiré",
                                   value=r.stop_never_widened if r else False)
            exit_ok = st.checkbox("Sortie conforme au plan",
                                  value=r.exit_per_plan if r else False)

        ui.rule()
        _libelles = list(_VERDICT_MARCHE.values())
        _defaut = r.thesis_outcome if r else ThesisOutcome.UNTESTED
        outcome_lib = st.radio(
            "Le marché a-t-il donné raison à ton idée ?",
            _libelles, index=list(_VERDICT_MARCHE).index(_defaut),
            help="INDÉPENDANT du P&L — on juge ta LECTURE, pas ton gain.\n\n"
                 "• Correcte : le prix est parti dans ton sens, comme tu l'avais "
                 "écrit.\n"
                 "• Fausse : il a fait l'inverse.\n"
                 "• Non testée : tu es sorti AVANT que le marché tranche — "
                 "breakeven, stop de bruit, prise de gains rapide. Ni raison ni "
                 "tort : le marché n'a pas eu l'occasion de répondre. Elle est "
                 "donc exclue de ton taux d'« idées correctes », elle ne te "
                 "pénalise ni ne te flatte.\n\n"
                 "Une thèse correcte mal exécutée peut perdre ; une thèse fausse "
                 "peut gagner par chance. C'est ce que la matrice sépare.")
        outcome = next(o for o, lib in _VERDICT_MARCHE.items() if lib == outcome_lib)

        emotion = st.text_input("État émotionnel pendant le trade",
                                value=r.emotional_state if r else "")
        lesson = st.text_area("Leçon", value=r.lesson if r else "", height=80)

        if st.form_submit_button("Enregistrer la review", type="primary"):
            store.complete_review(idea.id, Review(
                entry_in_zone=entry_ok, size_conforme=size_ok,
                stop_at_invalidation=stop_ok, stop_never_widened=widen_ok,
                exit_per_plan=exit_ok,
                thesis_outcome=outcome,
                emotional_state=emotion, lesson=lesson,
            ))
            st.rerun()


def render(store: Store, idea: Idea, spec_book, equity_ref: Decimal,
           campaigns: dict = None, data_dir=None):
    campaigns = campaigns or {}
    # Le bouton retour vit dans le routeur (app/main.py) : lui seul connaît la
    # section d'origine. Ici, juste le fil d'ariane.
    st.markdown(
        f'<div class="note">Idée / '
        f'{ui.fmt_month(idea.created_at)} / '
        f'<span class="txt-acc">{idea.display_name}</span></div>',
        unsafe_allow_html=True)

    if idea.is_running:
        r = idea.floating_r(spec_book)
        pnl = idea.floating_pnl(spec_book)
        suffixe = " · flottant déclaratif"
    else:
        r = idea.r_multiple(spec_book) if idea.is_executed else None
        pnl = idea.pnl_net if idea.is_executed else None
        suffixe = f" · {len(idea.positions)} ticket(s)"
    tone = ui.tone_of(r)

    c1, c2 = st.columns([2, 1])
    with c1:
        st.markdown(f"# {idea.symbol}")
        ui.stepper(idea.status)
        st.markdown(ui.chips(idea) + " " + ui.provenance(idea), unsafe_allow_html=True)
    with c2:
        st.markdown(
            f'<div class="eyebrow bar">{"flottant" if idea.is_running else "résultat net"}</div>'
            f'<div class="verdict {tone}">{ui.fmt_r(r)}</div>'
            f'<div class="note mono">{ui.fmt_money(pnl)}{suffixe}</div>',
            unsafe_allow_html=True)

    ui.rule()
    _disjoints_block(store, idea)
    _missing_stops_block(store, idea, spec_book)
    _open_block(store, idea, spec_book)

    gauche, droite = st.columns([1.5, 1])
    with gauche:
        _thesis_block(idea)
        _captures_block(store, idea, data_dir)
    with droite:
        _quadrant_block(idea)
        _execution_block(idea, spec_book, equity_ref)

    ui.rule()
    _risk_block(idea, spec_book, equity_ref)
    ui.rule()
    _secured_block(store, idea)
    _tickets_block(idea)
    ui.rule()
    _campaign_block(store, idea, campaigns)
    ui.rule()
    _review_form(store, idea)
