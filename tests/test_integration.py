"""
Cycle complet, sur le vrai fichier : thèse -> import -> appariement -> review.

Ce test simule ce que tu feras réellement, et vérifie qu'à la fin les chiffres
sont ceux qu'on attend. Il vérifie aussi l'idempotence : réimporter le même
fichier ne doit RIEN changer.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from core import matcher, metrics as M
from core.models import (
    Campaign, Direction, Position, RiskSource, Review, Thesis, ThesisOutcome,
)
from core.parser import parse_report
from core.specs import SpecBook
from core.store import Store

FIXTURE = Path(__file__).parent / "fixtures" / "ReportHistory-14124899.html"


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "events.jsonl")


def test_cycle_complet(store):
    report = parse_report(FIXTURE)

    # --- 1. La thèse s'écrit AVANT. Antidatée ici pour simuler le pré-engagement.
    thesis = Thesis(
        instrument="BTCUSD", direction=Direction.SELL,
        macro_theme="Crypto — liquidité", catalyst="Resserrement Fed",
        entry_planned=Decimal("63791.42"),
        stop_initial=Decimal("64700.51"),        # 0.6 % de 100k — MT5 ne le connaît pas
        risk_pct=Decimal("0.6"),
        conviction=4,
        thesis_kill_switch="Un pivot dovish de la Fed.",
        risk_source=RiskSource.COMPUTED,
    )
    idea = store.create_thesis(thesis, label="Short BTC — resserrement")

    # antidatage : la thèse doit précéder le premier ticket (07/07 21:51)
    import json
    lines = store.path.read_text().splitlines()
    ev = json.loads(lines[0])
    ev["payload"]["created_at"] = {"$dt": datetime(2026, 7, 7, 12, 0).isoformat()}
    store.path.write_text(json.dumps(ev, ensure_ascii=False) + "\n")

    # --- 2. Import du rapport MT5
    fresh = store.import_report(report.positions, report.deals)
    assert len(fresh) == 3

    # --- 3. Idempotence : réimporter ne crée aucun doublon
    again = store.import_report(report.positions, report.deals)
    assert again == []
    _, positions, deals = store.load()
    assert len(positions) == 3
    assert len(deals) == 7

    # --- 4. Appariement : l'outil PROPOSE, on valide
    ideas, positions, _ = store.load()
    orphans = store.orphans()
    assert len(orphans) == 3

    for p in sorted(orphans, key=lambda x: x.open_time):
        cands = matcher.candidates(p, list(ideas.values()))
        assert cands, f"aucun candidat pour {p.position_id}"
        assert cands[0].idea.id == idea.id
        store.link(idea.id, p.uid)
        ideas, _, _ = store.load()          # relecture : le suivant sera vu comme un add

    assert store.orphans() == []

    # --- 5. Une idée, trois tickets
    ideas, positions, deals = store.load()
    i = ideas[idea.id]
    spec_book = SpecBook(list(positions.values()))

    assert len(i.positions) == 3
    assert i.pnl_net == Decimal("-588.74")
    assert len(i.adds) == 2
    assert i.initial_position.position_id == "251022835"

    # Le R : dénominateur = SOMME des risques de tous les tickets.
    # Le ticket initial tient son stop de la thèse ; les adds, du fichier MT5
    # (l'un est PROUVÉ via la table Ordres).
    risks = i.ticket_risks(spec_book)
    assert len(risks) == 3
    assert all(v is not None for v in risks.values())
    assert i.risk_realized(spec_book) == pytest.approx(Decimal("1556.82"), abs=Decimal("1"))

    r = i.r_multiple(spec_book)
    assert Decimal("-0.42") < r < Decimal("-0.34")    # -0.38 R

    # Le chiffre que MT5 ne donne nulle part : exposition SIMULTANÉE réelle.
    peak = i.max_concurrent_risk(spec_book)
    assert peak == pytest.approx(Decimal("1105.76"), abs=Decimal("1"))
    assert peak > Decimal("600")     # la thèse annonçait 0.6 % = 600 $

    # --- 6. Le drill-down qui justifie l'architecture
    assert i.pnl_initial == Decimal("380.36")        # le noyau gagnait
    assert i.pnl_adds == Decimal("-969.10")          # les adds ont tout mangé

    # --- 7. Review
    store.complete_review(idea.id, Review(
        entry_in_zone=True, size_conforme=True, stop_at_invalidation=True,
        stop_never_widened=False, exit_per_plan=False,
        thesis_outcome=ThesisOutcome.WRONG,
        lesson="Ajouté sur une thèse qui ne se confirmait pas.",
    ))
    ideas, _, _ = store.load()
    i = ideas[idea.id]
    assert i.discipline_score == 3
    assert i.status.value == "revue"

    # --- 8. Les métriques : UNE idée, PAS trois trades
    exp = M.Expectancy.of(M.r_multiples([i]))
    assert exp.n == 1
    assert exp.win_rate == 0.0            # et non 33.33 % comme le dit MT5

    # Le DD se mesure transaction par transaction — comme MT5, comme la prop firm.
    dd = M.drawdown(M.deal_curve(deals))
    assert dd.max_dd_pct == pytest.approx(0.99, abs=0.01)   # MT5 dit 0.99 % ✓
    assert dd.max_dd_abs == pytest.approx(985.94, abs=0.01)

    # La courbe journalière raterait le creux du 09/07 à 09h59 :
    dd_daily = M.drawdown(M.equity_curve(deals))
    assert dd_daily.max_dd_pct == pytest.approx(0.59, abs=0.01)  # sous-estimé


def test_reimport_apres_lien_ne_casse_rien(store):
    """Le cas réel : tu réimportes un rapport plus large, incluant d'anciens trades."""
    report = parse_report(FIXTURE)
    store.import_report(report.positions, report.deals)

    t = Thesis(instrument="BTCUSD", direction=Direction.SELL,
               entry_planned=Decimal("63791.42"), stop_initial=Decimal("64700.51"))
    idea = store.create_thesis(t)
    _, positions, _ = store.load()
    for uid in positions:
        store.link(idea.id, uid)

    before = store.load()[0][idea.id].position_uids[:]
    store.import_report(report.positions, report.deals)   # réimport
    after = store.load()[0][idea.id].position_uids

    assert before == after
    assert store.orphans() == []


def test_trade_sans_these_est_hors_plan(store):
    """Une position sans thèse candidate n'est pas un bug : c'est une métrique."""
    report = parse_report(FIXTURE)
    store.import_report(report.positions, report.deals)

    ideas, _, _ = store.load()
    for p in store.orphans():
        assert matcher.candidates(p, list(ideas.values())) == []

    # on les enregistre comme hors-plan
    for p in store.orphans():
        i = store.create_thesis(
            Thesis(instrument=p.symbol, direction=p.direction,
                   entry_planned=p.open_price, risk_source=RiskSource.UNKNOWN),
            off_plan=True)
        store.link(i.id, p.uid)

    ideas, _, _ = store.load()
    comp = M.plan_vs_offplan(list(ideas.values()))
    assert comp.off_plan_ratio == 1.0
    assert comp.planned is None


def test_une_idee_journalisee_le_soir_est_un_trade_comme_un_autre(store):
    """
    Tu trades le matin, tu journalises le soir : c'est le fonctionnement NORMAL,
    pas une anomalie.

    L'outil marquait ces idées « tardives » et dégradait leur R en
    « reconstitué ». Sur un usage réel, cela concernait la majorité du journal —
    un bandeau d'avertissement permanent qui ne distinguait plus rien. Le
    drapeau `late` reste disponible pour l'appariement, mais il ne dégrade plus
    ni le R ni l'affichage.
    """
    report = parse_report(FIXTURE)
    store.import_report(report.positions, report.deals)

    t = Thesis(instrument="BTCUSD", direction=Direction.SELL,
               entry_planned=Decimal("63791.42"), stop_initial=Decimal("64700.51"))
    idea = store.create_thesis(t)   # created_at = maintenant, donc après les trades

    ideas, _, _ = store.load()
    orphans = sorted(store.orphans(), key=lambda p: p.open_time)
    # La fenêtre d'appariement (30 j par défaut) se mesure par rapport à
    # « maintenant ». Ce test tourne sur un fichier DATÉ et vise « journaliser le
    # soir ne dégrade rien », pas la limite des 30 jours — on la neutralise pour
    # rester déterministe quelle que soit la date d'exécution.
    cands = matcher.candidates(orphans[0], list(ideas.values()),
                               window=timedelta(days=100000))
    assert cands                    # proposée, pas rejetée

    store.link(idea.id, orphans[0].uid)
    ideas, _, _ = store.load()
    assert ideas[idea.id].risk_source == RiskSource.COMPUTED, (
        "une journalisation différée ne dégrade plus rien")


def test_un_ancien_journal_marque_tardif_se_relit_sans_degrader(store):
    """
    Rétrocompatibilité : les journaux existants contiennent des événements
    `idea_marked_late`. Ils se relisent, et n'ont plus d'effet sur le R.
    """
    report = parse_report(FIXTURE)
    store.import_report(report.positions, report.deals)
    idea = store.create_thesis(Thesis(
        instrument="BTCUSD", direction=Direction.SELL,
        entry_planned=Decimal("63791.42"), stop_initial=Decimal("64700.51")))
    store.link(idea.id, sorted(store.orphans(), key=lambda p: p.open_time)[0].uid)
    store.mark_late(idea.id)

    ideas, _, _ = store.load()
    assert ideas[idea.id].late_thesis is True          # relu sans erreur
    assert ideas[idea.id].risk_source == RiskSource.COMPUTED


# ============================================================================
#  RÉTROCOMPATIBILITÉ — le journal existant ne doit JAMAIS casser
# ============================================================================

def test_un_journal_ecrit_avant_les_campagnes_se_relit_sans_erreur(store):
    """
    LE test qui protège tes données.

    Ton journal contient déjà une idée, écrite avant l'existence des campagnes et
    des stops manuels. Le journal est append-only : on ne le réécrit pas, on le
    relit. Les champs qui n'existaient pas prennent leur valeur par défaut.

    Une idée sans campagne se comporte EXACTEMENT comme avant : même R, même
    exposition, même tout.
    """
    report = parse_report(FIXTURE)

    # --- on reconstruit un journal "ancien format" : aucun champ campaign_id,
    #     aucun stop manuel, exactement ce que contient le tien.
    thesis = Thesis(
        instrument="BTCUSD", direction=Direction.SELL,
        entry_planned=Decimal("63791.42"), stop_initial=Decimal("64700"),
        risk_pct=Decimal("0.6"), risk_source=RiskSource.BACKFILLED,
    )
    idea = store.create_thesis(thesis, label="Short BTC — liquidité")

    import json
    lines = store.path.read_text(encoding="utf-8").splitlines()
    ev = json.loads(lines[0])
    ev["payload"]["created_at"] = {"$dt": datetime(2026, 7, 7, 12, 0).isoformat()}
    ev["payload"].pop("campaign_id", None)      # le champ n'existait pas
    lines[0] = json.dumps(ev, ensure_ascii=False)
    store.path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    store.import_report(report.positions, report.deals)
    for p in report.positions:
        store.link(idea.id, p.uid)

    # --- relecture : rien ne doit casser
    ideas, positions, deals = store.load()
    i = ideas[idea.id]
    book = SpecBook(list(positions.values()))

    assert i.campaign_id is None            # champ absent -> None, pas une erreur
    assert i.manual_stops == {}
    assert len(i.positions) == 3
    assert i.pnl_net == Decimal("-588.74")
    assert i.r_multiple(book) == pytest.approx(Decimal("-0.38"), abs=Decimal("0.01"))
    assert store.campaigns() == {}          # aucune campagne : c'est normal


def test_une_campagne_agrege_deux_instruments(store):
    """
    Deux idées, deux symboles, une seule thèse macro.

    Le R de la campagne = SOMME des R de chaque idée (définition demandée).
    """
    from core.models import Campaign

    camp = store.create_campaign(Campaign(
        name="Dollar fort — Fed hawkish", macro_theme="Fed / taux US",
        conviction=4))

    def _mk(symbol, direction, entry, stop, close, gross, day):
        t = Thesis(instrument=symbol, direction=direction,
                   entry_planned=Decimal(entry), stop_initial=Decimal(stop),
                   risk_source=RiskSource.COMPUTED)
        idea = store.create_thesis(t, label=f"{symbol} {direction.value}")
        store.attach(idea.id, camp.id)
        pos = Position(
            position_id=f"P{day}", account_id="A", symbol=symbol,
            direction=direction, volume=Decimal("1"),
            open_time=datetime(2026, 7, day, 9), open_price=Decimal(entry),
            close_time=datetime(2026, 7, day, 18), close_price=Decimal(close),
            commission=Decimal("0"), swap=Decimal("0"),
            profit_gross=Decimal(gross),
        )
        store.import_report([pos], [])
        store.link(idea.id, pos.uid)
        return idea

    # EURUSD sell : risque 1000 (1 lot × 0.01 × pv), résultat -400  -> -0.4 R
    _mk("EURUSD", Direction.SELL, "1.1000", "1.1100", "1.1040", "-400", 1)
    # USDJPY buy  : risque 1000, résultat +1200                      -> +1.2 R
    _mk("USDJPY", Direction.BUY, "160.00", "159.00", "161.20", "1200", 2)

    camps = store.campaigns()
    c = camps[camp.id]

    assert len(c.executed_ideas) == 2
    assert c.instruments == ["EURUSD", "USDJPY"]
    assert c.pnl_net == Decimal("800")

    ideas, positions, _ = store.load()
    book = SpecBook(list(positions.values()))

    rs = sorted(float(i.r_multiple(book)) for i in c.executed_ideas)
    assert rs[0] == pytest.approx(-0.4, abs=0.01)
    assert rs[1] == pytest.approx(1.2, abs=0.01)

    # R de la campagne = somme des R = -0.4 + 1.2 = +0.8
    assert float(c.r_total(book)) == pytest.approx(0.8, abs=0.01)

    # l'autre lecture : P&L / risque total = 800 / 2000 = +0.4
    assert float(c.r_weighted(book)) == pytest.approx(0.4, abs=0.01)


def test_stop_manuel_sauve_le_R_dune_idee_entiere(store):
    """
    Un renforcement passé au breakeven : MT5 a écrasé son stop d'origine, ta thèse
    ne contient que celui du noyau. Sans saisie, le R de l'IDÉE ENTIÈRE disparaît
    (un dénominateur partiel serait pire que rien).

    Chaque add porte SON PROPRE stop : il n'hérite jamais de celui du noyau.
    """
    t = Thesis(instrument="BTCUSD", direction=Direction.SELL,
               entry_planned=Decimal("63000"), stop_initial=Decimal("63600"),
               risk_source=RiskSource.COMPUTED)
    idea = store.create_thesis(t)

    def _pos(pid, entry, close, sl, day):
        return Position(
            position_id=pid, account_id="A", symbol="BTCUSD",
            direction=Direction.SELL, volume=Decimal("1"),
            open_time=datetime(2026, 7, day, 9), open_price=Decimal(entry),
            close_time=datetime(2026, 7, day, 18), close_price=Decimal(close),
            commission=Decimal("0"), swap=Decimal("0"),
            profit_gross=Decimal(str(Decimal(entry) - Decimal(close))),
            sl_final=Decimal(sl) if sl else None,
        )

    noyau = _pos("A1", "63000", "62500", "63600", 1)          # stop intact
    add_be = _pos("A2", "62500", "62400", "62505", 2)         # passé au BE !
    store.import_report([noyau, add_be], [])
    store.link(idea.id, noyau.uid)
    store.link(idea.id, add_be.uid)

    ideas, positions, _ = store.load()
    i = ideas[idea.id]
    book = SpecBook(list(positions.values()))

    # L'add passé au breakeven n'a plus de stop exploitable, et l'outil ne lui
    # fait PAS hériter de celui du noyau : un renforcement peut avoir été pris
    # plus serré. Il le demande — c'est le seul chiffre que toi seul connais.
    assert [p.position_id for p in i.tickets_needing_stop()] == ["A2"]
    assert i.r_multiple(book) is None

    store.set_ticket_stop(idea.id, add_be.uid, Decimal("62900"))

    ideas, _, _ = store.load()
    i = ideas[idea.id]
    risks = i.ticket_risks(book)
    assert risks["A1"] == Decimal("600")      # 63600 - 63000, depuis l'idée
    assert risks["A2"] == Decimal("400")      # 62900 - 62500, saisi à la main
    assert i.risk_realized(book) == Decimal("1000")
    assert i.risk_source == RiskSource.COMPUTED


def test_un_stop_saisi_ne_degrade_plus_l_idee(store):
    """
    L'ancienne règle distinguait « capture » et « de mémoire », et dégradait
    l'idée entière dans le second cas.

    Elle a été retirée : un chiffre saisi est un chiffre saisi. Les journaux
    existants contiennent encore des évidences `MEMORY` — ils se relisent, sans
    effet sur le R.
    """
    from core.models import StopEvidence

    t = Thesis(instrument="BTCUSD", direction=Direction.SELL,
               entry_planned=Decimal("63000"), stop_initial=Decimal("63600"),
               risk_source=RiskSource.COMPUTED)
    idea = store.create_thesis(t)

    add = Position(
        position_id="A2", account_id="A", symbol="BTCUSD",
        direction=Direction.SELL, volume=Decimal("1"),
        open_time=datetime(2026, 7, 2, 9), open_price=Decimal("62500"),
        close_time=datetime(2026, 7, 2, 18), close_price=Decimal("62400"),
        commission=Decimal("0"), swap=Decimal("0"), profit_gross=Decimal("100"),
        sl_final=Decimal("62505"),          # breakeven
    )
    store.import_report([add], [])
    store.link(idea.id, add.uid)

    store.set_ticket_stop(idea.id, add.uid, Decimal("62900"), StopEvidence.MEMORY)
    i = store.load()[0][idea.id]
    assert i.stop_for(add)[0] == Decimal("62900")
    assert i.risk_source == RiskSource.COMPUTED


def test_abandonner_une_these_ne_leffce_pas(store):
    """
    « Supprimer » une thèse la marque ABANDONNÉE — le journal est append-only,
    rien n'est jamais effacé.

    Ce n'est pas une limitation : c'est ce qui rend possible la question la plus
    intéressante que puisse poser cet outil — « mes idées abandonnées
    auraient-elles gagné ? ». Un vrai delete détruirait cette information à
    jamais.
    """
    from core.models import IdeaStatus
    from core import matcher

    t = Thesis(instrument="BTCUSD", direction=Direction.SELL,
               entry_planned=Decimal("63000"), stop_initial=Decimal("63600"))
    idea = store.create_thesis(t, label="Short BTC — à abandonner")

    ideas, _, _ = store.load()
    assert ideas[idea.id].status == IdeaStatus.ARMED

    store.abandon(idea.id)
    ideas, _, _ = store.load()
    abandonnee = ideas[idea.id]

    # marquée, pas supprimée : la thèse et son contenu sont intacts
    assert abandonnee.status == IdeaStatus.ABANDONED
    assert abandonnee.thesis.stop_initial == Decimal("63600")
    assert abandonnee.label == "Short BTC — à abandonner"

    # mais elle ne peut plus capter un ticket
    pos = Position(
        position_id="X1", account_id="A", symbol="BTCUSD",
        direction=Direction.SELL, volume=Decimal("1"),
        open_time=datetime(2026, 7, 20, 9), open_price=Decimal("63000"),
        close_time=datetime(2026, 7, 20, 18), close_price=Decimal("62500"),
        commission=Decimal("0"), swap=Decimal("0"), profit_gross=Decimal("500"),
    )
    assert matcher.candidates(pos, list(ideas.values())) == []


# ============================================================================
#  Fenêtre de 5 jours ouvrés, abandon de thèse, vue par thèse
# ============================================================================

def test_fenetre_de_cinq_jours_ouvres_saute_le_weekend():
    """
    Aucune position n'est portée sur le week-end : une idée armée a 5 JOURS
    OUVRÉS, pas 5 jours calendaires. Armée le mercredi, elle expire le mercredi
    suivant — pas le lundi, ce qui ne lui aurait laissé que deux séances.
    """
    from core import clock

    mercredi = datetime(2026, 7, 15, 10, 0)
    assert clock.business_days_between(mercredi, datetime(2026, 7, 17, 10)) == 2
    # le week-end ne compte pas
    assert clock.business_days_between(mercredi, datetime(2026, 7, 19, 10)) == 2
    assert clock.business_days_between(mercredi, datetime(2026, 7, 20, 10)) == 3

    assert not clock.review_due(mercredi, datetime(2026, 7, 21, 10))
    assert clock.review_due(mercredi, datetime(2026, 7, 22, 10))     # 5 ouvrés
    assert clock.business_days_left(mercredi, datetime(2026, 7, 20, 10)) == 2


def test_review_dune_idee_abandonnee(store):
    """
    La question n'est pas « avais-je raison » mais « ai-je eu l'occasion ».
    Un setup absent est un non-événement ; une hésitation devant un setup valide
    est l'information qui compte.
    """
    from core.models import IdeaStatus, MissedOutcome, MissedReview

    t = Thesis(instrument="BTCUSD", direction=Direction.SELL,
               entry_planned=Decimal("63000"), stop_initial=Decimal("63600"))
    idea = store.create_thesis(t, label="Short BTC — jamais pris")

    store.review_missed(idea.id, MissedReview(
        setup_appeared=MissedOutcome.HESITATED,
        would_have_won=True,
        reason="pas devant l'écran",
        note="Mon setup s'est présenté, je n'étais pas là."))

    ideas, _, _ = store.load()
    i = ideas[idea.id]
    assert i.status == IdeaStatus.ABANDONED
    assert i.missed_review.setup_appeared == MissedOutcome.HESITATED
    assert i.missed_review.would_have_won is True
    # la thèse elle-même reste intacte : rien n'est effacé
    assert i.thesis.stop_initial == Decimal("63600")


def test_abandonner_une_these_libere_ses_idees(store):
    """
    Abandonner une THÈSE ne touche pas ses idées : elles redeviennent autonomes
    et comptent pour elles-mêmes dans la vue par thèse.
    """
    from core.challenge import thesis_lines
    from core.models import Campaign

    camp = store.create_campaign(Campaign(name="Dollar fort"))
    t = Thesis(instrument="EURUSD", direction=Direction.SELL,
               entry_planned=Decimal("1.1000"), stop_initial=Decimal("1.1100"),
               risk_source=RiskSource.COMPUTED)
    idea = store.create_thesis(t, label="EURUSD sell")
    store.attach(idea.id, camp.id)

    pos = Position(
        position_id="P1", account_id="A", symbol="EURUSD",
        direction=Direction.SELL, volume=Decimal("1"),
        open_time=datetime(2026, 7, 1, 9), open_price=Decimal("1.1000"),
        close_time=datetime(2026, 7, 1, 18), close_price=Decimal("1.0900"),
        commission=Decimal("0"), swap=Decimal("0"), profit_gross=Decimal("1000"))
    store.import_report([pos], [])
    store.link(idea.id, pos.uid)

    ideas, positions, _ = store.load()
    book = SpecBook(list(positions.values()))
    execs = [i for i in ideas.values() if i.is_executed]

    # avant : une ligne « thèse »
    lignes = thesis_lines(execs, store.campaigns(), book)
    assert len(lignes) == 1 and lignes[0].is_campaign

    # après abandon : l'idée compte pour elle-même, rien n'est perdu
    store.abandon_campaign(camp.id)
    lignes = thesis_lines(execs, store.campaigns(), book)
    assert len(lignes) == 1 and not lignes[0].is_campaign
    assert lignes[0].pnl_net == Decimal("1000")


def test_une_idee_sans_these_apparait_quand_meme(store):
    """
    Sinon la somme des lignes ne ferait pas le total du compte, et la section
    mentirait par omission.
    """
    from core.challenge import thesis_lines
    from core.models import Campaign

    camp = store.create_campaign(Campaign(name="Risk-off"))

    def _mk(sym, label, gross, day, attach):
        t = Thesis(instrument=sym, direction=Direction.SELL,
                   entry_planned=Decimal("100"), stop_initial=Decimal("110"),
                   risk_source=RiskSource.COMPUTED)
        i = store.create_thesis(t, label=label)
        if attach:
            store.attach(i.id, camp.id)
        pos = Position(position_id=f"P{day}", account_id="A", symbol=sym,
                       direction=Direction.SELL, volume=Decimal("1"),
                       open_time=datetime(2026, 7, day, 9), open_price=Decimal("100"),
                       close_time=datetime(2026, 7, day, 18),
                       close_price=Decimal("100") - Decimal(gross),
                       commission=Decimal("0"), swap=Decimal("0"),
                       profit_gross=Decimal(gross))
        store.import_report([pos], [])
        store.link(i.id, pos.uid)

    _mk("XAUUSD", "Or", "50", 1, True)      # dans la thèse
    _mk("US30", "Indice", "30", 2, False)   # orpheline

    ideas, positions, _ = store.load()
    book = SpecBook(list(positions.values()))
    execs = [i for i in ideas.values() if i.is_executed]
    lignes = thesis_lines(execs, store.campaigns(), book)

    assert len(lignes) == 2
    assert sum(l.pnl_net for l in lignes) == Decimal("80")   # le total est complet
    assert any(l.is_campaign for l in lignes)
    assert any(not l.is_campaign for l in lignes)
