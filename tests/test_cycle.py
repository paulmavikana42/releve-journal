"""
LE CYCLE COMPLET D'UN TRADE, tel qu'il se déroule vraiment.

    idée écrite (thèse + invalidation + captures)   -> armée
    entrée, ticket déclaré                           -> EN COURS
    le trade vit : stop déplacé, capture ajoutée     -> EN COURS
    export CSV déposé                                -> clôturée, R calculable
    review                                           -> quadrant, statistiques

C'est le chemin que l'outil promet. Un test par maillon, et un test pour le
chemin entier — parce que ce sont les jointures qui cassent, pas les pièces.
"""
from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from core import captures as CAP
from core import csvimport as CSV
from core import prop as P
from core.models import (
    CaptureKind, Direction, IdeaStatus, OpenTrade, Quadrant, Review, RiskSource,
    Thesis, ThesisOutcome,
)
from core.specs import SpecBook
from core.store import Store


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "events.jsonl")


def _idee(store, instrument="UKOUSD", direction=Direction.BUY,
          entree="71.40", stop="70.20"):
    return store.create_thesis(
        Thesis(instrument=instrument, direction=direction,
               entry_planned=Decimal(entree), stop_initial=Decimal(stop),
               risk_pct=Decimal("1"), conviction=4,
               macro_theme="Risk-off géopolitique",
               thesis_kill_switch="Désescalade confirmée",
               risk_source=RiskSource.COMPUTED),
        label="UKOUSD buy — Ormuz", account_id="14124899")


def _ticket(ticket="88210912", account="14124899", stop="70.20"):
    return OpenTrade(
        ticket=ticket, symbol="UKOUSD", direction=Direction.BUY,
        volume=Decimal("1"), open_time=datetime(2026, 7, 19, 10, 30),
        open_price=Decimal("71.40"), account_id=account,
        stop=Decimal(stop) if stop else None)


CSV_CLOTURE = (
    "Ticket;Symbol;Type;Volume;Open Time;Open Price;Close Time;Close Price;"
    "S/L;Commission;Swap;Profit;Balance\n"
    "88210912;UKOUSD;buy;1.00;2026.07.19 10:30;71.40;2026.07.22 14:05;73.32;"
    "70.20;0;0;1 920,00;101 920,00\n"
)


# ------------------------------------------------------- le trade qui vit

def test_declarer_un_ticket_fait_passer_l_idee_en_cours(store):
    idee = _idee(store)
    store.open_trade(idee.id, _ticket())

    ideas, _, _ = store.load()
    i = ideas[idee.id]
    assert i.status == IdeaStatus.RUNNING
    assert i.is_running and not i.is_executed
    assert i.open_trades[0].ticket == "88210912"
    # le stop RÉELLEMENT placé est enregistré avant que le broker ne l'écrase
    assert i.open_trades[0].stop == Decimal("70.20")


def test_le_ticket_declare_devient_la_cle_de_rapprochement(store):
    idee = _idee(store)
    store.open_trade(idee.id, _ticket())
    assert set(store.pending_trades()) == {"88210912"}


def test_un_trade_en_cours_ne_demande_pas_de_review(store):
    """
    Une review écrite avant la clôture juge un résultat qui n'existe pas. Le
    compteur « à relire » ne doit donc jamais compter un trade vivant.
    """
    idee = _idee(store)
    store.open_trade(idee.id, _ticket())
    ideas, _, _ = store.load()
    i = ideas[idee.id]
    a_relire = i.is_executed and not i.is_running and i.review is None
    assert not a_relire
    assert i.quadrant == Quadrant.PENDING


def test_un_ticket_declare_par_erreur_s_annule(store):
    idee = _idee(store)
    store.open_trade(idee.id, _ticket())
    ideas, _, _ = store.load()
    store.cancel_trade(ideas[idee.id].open_trades[0].uid)

    ideas, _, _ = store.load()
    assert ideas[idee.id].open_trades == []
    assert ideas[idee.id].status == IdeaStatus.ARMED


def test_le_flottant_exige_un_cours_saisi(store):
    """
    L'outil n'a aucun flux de prix. Sans cours saisi, il renvoie None — pas
    zéro : un zéro se lirait « à l'équilibre », ce qui serait inventé.
    """
    idee = _idee(store)
    store.open_trade(idee.id, _ticket())
    book = SpecBook()
    ideas, _, _ = store.load()
    assert ideas[idee.id].floating_pnl(book) is None

    uid = ideas[idee.id].open_trades[0].uid
    store.update_trade(uid, last_price=Decimal("72.10"),
                       last_price_at=datetime(2026, 7, 21, 9, 0))
    ideas, _, _ = store.load()
    # toujours None : la valeur du point de UKOUSD n'a jamais été apprise
    assert ideas[idee.id].floating_pnl(book) is None


def test_le_stop_deplace_pendant_le_trade_est_journalise(store):
    idee = _idee(store)
    store.open_trade(idee.id, _ticket())
    ideas, _, _ = store.load()
    uid = ideas[idee.id].open_trades[0].uid

    store.update_trade(uid, stop=Decimal("71.40"), note="passé au BE")
    ideas, _, _ = store.load()
    o = ideas[idee.id].open_trades[0]
    assert o.stop == Decimal("71.40")
    assert o.note == "passé au BE"
    # le journal est append-only : les deux valeurs y sont encore
    types = [e["type"] for e in store.events()]
    assert types.count("trade_opened") == 1 and types.count("trade_updated") == 1


# ------------------------------------------------- la clôture par le CSV

def test_le_csv_cloture_le_trade_par_son_ticket(store):
    idee = _idee(store)
    store.open_trade(idee.id, _ticket())

    cf = CSV.parse(CSV_CLOTURE.encode("utf-8"))
    _, positions, _ = store.load()
    matches = CSV.reconcile(cf, positions, store.pending_trades())
    assert matches[0].outcome == CSV.Outcome.CLOSES

    pos = matches[0].row.to_position(matches[0].open_trade.account_id)
    store.import_report([pos], CSV.balance_deals(cf))
    store.link(matches[0].idea_id, pos.uid)

    ideas, _, deals = store.load()
    i = ideas[idee.id]
    assert i.status == IdeaStatus.CLOSED
    assert not i.is_running, "le ticket importé consomme le trade déclaré"
    assert i.is_executed
    assert i.pnl_net == Decimal("1920.00")
    # le R vient du stop de l'IDÉE, pas d'un champ du broker
    assert i.r_multiple(SpecBook(list(i.positions))) == pytest.approx(
        Decimal("1.6"), abs=Decimal("0.01"))
    assert deals[0].balance == Decimal("101920.00")


def test_ticket_obligatoire_avant_import_transforme_une_devinette_en_cle(store):
    """
    Le garde-fou « ticket obligatoire avant l'import » (écran d'import) : une
    idée armée SANS ticket, présente dans le fichier, serait rapprochée par
    ressemblance — la porte ouverte à la fusion à tort. En déclarant son ticket
    depuis la ligne du CSV (ce que l'écran fait faire à l'utilisateur), le
    rapprochement redevient déterministe PAR TICKET.
    """
    idee = _idee(store)                     # armée, aucun ticket déclaré

    cf = CSV.parse(CSV_CLOTURE.encode("utf-8"))
    _, positions, _ = store.load()

    # Avant : rien de déclaré → la ligne n'est PAS une clôture par ticket.
    avant = CSV.reconcile(cf, positions, store.pending_trades())
    assert avant[0].outcome != CSV.Outcome.CLOSES

    # L'écran déclare le ticket depuis la ligne (stop repris de l'IDÉE).
    from dataclasses import replace
    ot = cf.rows[0].to_open_trade("14124899")
    ot = replace(ot, stop=idee.thesis.stop_initial)
    store.open_trade(idee.id, ot)

    # Après : clôture par ticket, rattachée à la bonne idée, sans heuristique.
    apres = CSV.reconcile(cf, positions, store.pending_trades())
    assert apres[0].outcome == CSV.Outcome.CLOSES
    assert apres[0].idea_id == idee.id
    assert ot.stop == Decimal("70.20")      # le noyau garde le stop de l'idée


def _pos(ticket, op, ot, cp, ct, vol="1", sym="USDJPY", acc="14124899"):
    from core.models import Position
    return Position(position_id=ticket, account_id=acc, symbol=sym,
                    direction=Direction.BUY, volume=Decimal(vol),
                    open_time=ot, open_price=Decimal(op),
                    close_time=ct, close_price=Decimal(cp),
                    commission=Decimal(0), swap=Decimal(0),
                    profit_gross=Decimal("100"))


def test_un_fragment_de_sortie_partielle_n_est_pas_un_add(store):
    """
    Une sortie partielle scinde le noyau en deux lignes de même heure et de même
    prix d'entrée, mais de tickets différents. La seconde arrive à l'appariement :
    l'assistant NE DOIT PAS la présenter comme un renforcement. La confondre avec
    un add faisait cocher « noyau au breakeven » par défaut, et sous-estimait
    l'exposition simultanée (120 au lieu de 240) — la seule erreur interdite.
    """
    from core import matcher
    idee = _idee(store, instrument="USDJPY", entree="157.00", stop="156.20")

    core = _pos("3001", "157.00", datetime(2026, 7, 1, 10), "157.80",
                datetime(2026, 7, 2, 10))
    store.import_report([core], [])
    store.link(idee.id, core.uid)
    idea = store.load()[0][idee.id]

    # fragment : MÊME heure + MÊME prix que le noyau, autre ticket
    fragment = _pos("3002", "157.00", datetime(2026, 7, 1, 10), "158.50",
                    datetime(2026, 7, 4, 10))
    cands = matcher.candidates(fragment, [idea])
    assert cands and cands[0].is_fragment
    assert not cands[0].is_add, "un fragment de noyau n'est pas un renforcement"

    # une fois le fragment rattaché, un VRAI add (heure ET prix différents) qui
    # chevauche reste bien un add
    store.import_report([fragment], [])
    store.link(idee.id, fragment.uid)
    idea = store.load()[0][idee.id]
    add = _pos("3003", "157.60", datetime(2026, 7, 3, 10), "158.50",
               datetime(2026, 7, 4, 10))
    cands = matcher.candidates(add, [idea])
    assert cands and cands[0].is_add and not cands[0].is_fragment


def test_justesse_des_idees_executees(store):
    """Le taux d'idées CORRECTES : le marché t'a-t-il donné raison, P&L à part."""
    from core import metrics as M
    from core.models import Review

    for tag, outcome in (("PA", ThesisOutcome.CORRECT),
                         ("PB", ThesisOutcome.WRONG),
                         ("PC", ThesisOutcome.CORRECT),
                         ("PD", ThesisOutcome.UNTESTED)):   # non tranché : ignoré
        i = _idee(store)
        p = _pos(tag, "71.40", datetime(2026, 7, 1, 10), "72.00",
                 datetime(2026, 7, 2, 10), sym="UKOUSD")
        store.import_report([p], [])
        store.link(i.id, p.uid)
        store.complete_review(i.id, Review(thesis_outcome=outcome))

    ideas = list(store.load()[0].values())
    rate = M.ideas_correct_rate(ideas)
    assert rate is not None and rate.n == 3 and rate.n_correct == 2
    assert abs(rate.rate - 2 / 3) < 1e-9

    # la ventilation qu'affiche désormais le tableau de bord : correcte / fausse /
    # non testée (la review d'ABANDON, elle, a été retirée)
    b = M.outcome_breakdown(ideas)
    assert (b.correct, b.wrong, b.untested) == (2, 1, 1)
    assert b.judged == 3 and abs(b.correct_rate - 2 / 3) < 1e-9


def test_reimporter_le_meme_csv_ne_duplique_rien(store):
    idee = _idee(store)
    store.open_trade(idee.id, _ticket())
    cf = CSV.parse(CSV_CLOTURE.encode("utf-8"))

    for _ in range(3):
        _, positions, _ = store.load()
        matches = CSV.reconcile(cf, positions, store.pending_trades())
        for m in matches:
            if m.outcome in (CSV.Outcome.CLOSES, CSV.Outcome.NEW_CLOSED):
                p = m.row.to_position("14124899")
                store.import_report([p], [])
                if m.idea_id:
                    store.link(m.idea_id, p.uid)

    ideas, positions, _ = store.load()
    assert len(positions) == 1
    assert len(ideas[idee.id].positions) == 1


def test_un_ticket_sans_compte_ferme_quand_meme_le_trade_declare(store):
    """
    Un CSV n'a presque jamais de colonne « compte ». Quand un seul des deux
    côtés connaît le numéro, le ticket seul tranche — sinon un trade resterait
    « en cours » pour l'éternité alors qu'il est clôturé.
    """
    idee = _idee(store)
    store.open_trade(idee.id, _ticket(account="14124899"))

    cf = CSV.parse(CSV_CLOTURE.encode("utf-8"))
    pos = cf.rows[0].to_position("")          # aucun compte dans le fichier
    store.import_report([pos], [])
    store.link(idee.id, pos.uid)

    ideas, _, _ = store.load()
    assert not ideas[idee.id].is_running


def test_deux_comptes_renseignes_ne_se_melangent_pas(store):
    """
    La contrepartie : quand les DEUX côtés portent un numéro et qu'ils
    diffèrent, on ne rapproche pas. Un ticket peut se répéter d'un compte à
    l'autre, et une fusion à tort pollue les statistiques pour toujours.
    """
    idee = _idee(store)
    store.open_trade(idee.id, _ticket(account="14124899"))

    cf = CSV.parse(CSV_CLOTURE.encode("utf-8"))
    pos = cf.rows[0].to_position("99999999")   # un AUTRE compte
    store.import_report([pos], [])

    ideas, _, _ = store.load()
    assert ideas[idee.id].is_running, "le trade d'un autre compte ne clôture rien"


# ------------------------------------------------------------- les captures

def test_plusieurs_captures_sur_une_idee(tmp_path, store):
    idee = _idee(store)
    for n, moment in enumerate((CaptureKind.THESIS, CaptureKind.ENTRY,
                                CaptureKind.EXIT)):
        att = CAP.save(tmp_path, "idea", idee.id, f"shot{n}.png",
                       b"\x89PNG" + bytes(50), kind=moment, caption=f"n{n}")
        store.add_capture(att)

    ideas, _, _ = store.load()
    i = ideas[idee.id]
    assert len(i.captures) == 3
    assert [a.kind for a in i.captures] == [CaptureKind.THESIS, CaptureKind.ENTRY,
                                            CaptureKind.EXIT]
    assert all(CAP.resolve(tmp_path, a) is not None for a in i.captures)


def test_retirer_une_capture_ne_supprime_pas_le_fichier(tmp_path, store):
    """
    Le journal est append-only et une image supprimée par erreur ne se
    reconstitue pas. Retirer = sortir de l'affichage, pas effacer du disque.
    """
    idee = _idee(store)
    att = CAP.save(tmp_path, "idea", idee.id, "shot.png", b"\x89PNG" + bytes(50))
    store.add_capture(att)
    store.remove_capture(att.id)

    ideas, _, _ = store.load()
    i = ideas[idee.id]
    assert i.captures == []
    assert len(i.attachments) == 1 and i.attachments[0].removed
    assert CAP.resolve(tmp_path, att) is not None, "le fichier doit survivre"


@pytest.mark.parametrize("nom,contenu", [
    ("notes.pdf", b"%PDF"),           # mauvais format
    ("vide.png", b""),                # fichier vide
])
def test_une_capture_invalide_est_refusee_avant_le_journal(tmp_path, nom, contenu):
    """
    L'écriture disque précède l'événement : un refus ne doit laisser aucune
    trace dans le journal, qu'on ne pourrait plus retirer.
    """
    with pytest.raises(CAP.CaptureError):
        CAP.save(tmp_path, "idea", "abc", nom, contenu)


def test_une_capture_trop_lourde_est_refusee(tmp_path):
    with pytest.raises(CAP.CaptureError):
        CAP.save(tmp_path, "idea", "abc", "enorme.png",
                 b"\x89PNG" + bytes(CAP.MAX_BYTES + 1))


def test_blocs_visuels_sur_une_these(tmp_path, store):
    """Une thèse porte ses propres blocs visuels (image + légende structurées)."""
    from core.models import Campaign
    camp = store.create_campaign(Campaign(name="Dollar fort"))
    att = CAP.save(tmp_path, "campaign", camp.id, "cot.png",
                   b"\x89PNG" + bytes(50), kind=CaptureKind.THESIS,
                   caption="COT nettement haussier")
    store.add_capture(att)

    c = store.campaigns()[camp.id]
    assert len(c.captures) == 1 and c.captures[0].caption == "COT nettement haussier"

    # retrait : le bloc sort de l'affichage, le fichier reste sur le disque
    store.remove_capture(att.id)
    assert store.campaigns()[camp.id].captures == []
    assert CAP.resolve(tmp_path, att) is not None


# ---------------------------------------------------- le quadrant du trade

def _idee_clôturee(store, pnl: str, score: int):
    idee = _idee(store)
    store.open_trade(idee.id, _ticket())
    cf = CSV.parse(
        CSV_CLOTURE.replace("1 920,00", pnl).encode("utf-8"))
    pos = cf.rows[0].to_position("14124899")
    store.import_report([pos], [])
    store.link(idee.id, pos.uid)
    store.complete_review(idee.id, Review(
        *( [True] * score + [False] * (5 - score) ),
        thesis_outcome=ThesisOutcome.CORRECT))
    ideas, _, _ = store.load()
    return ideas[idee.id]


@pytest.mark.parametrize("pnl,score,attendu", [
    ("1 920,00", 5, Quadrant.MASTERY),    # gain + process tenu
    ("1 920,00", 2, Quadrant.LUCK),       # gain + process dégradé -> le pire
    ("-900,00", 2, Quadrant.ERROR),       # perte + process dégradé
    ("-900,00", 5, Quadrant.VARIANCE),    # perte + process tenu -> normal
])
def test_le_quadrant_croise_le_process_et_le_resultat(store, pnl, score, attendu):
    assert _idee_clôturee(store, pnl, score).quadrant == attendu


def test_sans_review_aucun_quadrant_n_est_inventé(store):
    idee = _idee(store)
    store.open_trade(idee.id, _ticket())
    cf = CSV.parse(CSV_CLOTURE.encode("utf-8"))
    pos = cf.rows[0].to_position("14124899")
    store.import_report([pos], [])
    store.link(idee.id, pos.uid)

    ideas, _, _ = store.load()
    assert ideas[idee.id].quadrant == Quadrant.PENDING


# ------------------------------------------- l'écriture faite par l'interface

def test_le_bouton_appliquer_ecrit_exactement_ce_que_le_rapprochement_decrit(store):
    """
    Le maillon le plus fragile : entre « l'outil a compris ce fichier » et « le
    journal contient la bonne chose », il y a du code d'interface. Ce test
    l'exécute pour de vrai, hors navigateur.
    """
    from app.views.importer import _appliquer

    idee = _idee(store)
    store.open_trade(idee.id, _ticket())

    csv_deux_lignes = CSV_CLOTURE + (
        "88213047;USDJPY;sell;0.50;2026.07.21 08:15;157.80;;;158.60;0;0;;\n")
    cf = CSV.parse(csv_deux_lignes.encode("utf-8"))
    _, positions, _ = store.load()
    matches = CSV.reconcile(cf, positions, store.pending_trades())

    # le ticket ouvert non déclaré part en hors-plan, choix explicite de l'écran
    choix = {"88213047": "__horsplan__"}
    _appliquer(store, cf, matches, choix, account_id="14124899")

    ideas, positions, _ = store.load()
    assert len(positions) == 1, "seule la ligne clôturée devient un ticket"
    assert ideas[idee.id].status == IdeaStatus.CLOSED
    assert ideas[idee.id].pnl_net == Decimal("1920.00")

    horsplan = [i for i in ideas.values() if i.off_plan]
    assert len(horsplan) == 1
    assert horsplan[0].is_running
    assert horsplan[0].open_trades[0].ticket == "88213047"
    assert horsplan[0].open_trades[0].stop == Decimal("158.60")


def test_la_matrice_decision_resultat_compte_les_non_relus_a_part(store):
    from core import metrics as M
    gagnant = _idee_clôturee(store, "1 920,00", 5)
    dm = M.decision_matrix([gagnant])
    assert dm.get(Quadrant.MASTERY).n == 1
    assert dm.n_pending == 0
    assert dm.good_process_share == 1.0
