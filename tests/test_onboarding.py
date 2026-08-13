"""
Premier lancement, mode démonstration, et la mort de la démo.

Le risque à couvrir n'est pas un chiffre faux : c'est une CONTAMINATION. Le jour
où une ligne de démonstration se retrouve dans le vrai journal, toutes les
statistiques deviennent fausses de manière invisible, et plus personne ne peut
dire quelles lignes étaient inventées.
"""
from decimal import Decimal

import pytest

from core import onboarding as O
from core import paths, prop, settings
from core.models import Direction, Position, RiskSource, Thesis
from core.store import Store
from datetime import datetime


@pytest.fixture(autouse=True)
def data_isolee(tmp_path, monkeypatch):
    """Aucun test ne doit pouvoir toucher aux vraies données."""
    monkeypatch.setenv("RELEVE_DATA", str(tmp_path))
    return tmp_path


def _these(instrument="BTCUSD"):
    return Thesis(instrument=instrument, direction=Direction.SELL,
                  entry_planned=Decimal("60000"), stop_initial=Decimal("61000"),
                  risk_source=RiskSource.COMPUTED)


def _position(ticket="99001"):
    return Position(
        position_id=ticket, account_id="A", symbol="BTCUSD",
        direction=Direction.SELL, volume=Decimal("1"),
        open_time=datetime(2026, 7, 20, 9, 0), open_price=Decimal("60000"),
        close_time=datetime(2026, 7, 20, 18, 0), close_price=Decimal("59000"),
        commission=Decimal("0"), swap=Decimal("0"), profit_gross=Decimal("1000"))


# ------------------------------------------------------------ premier lancement

def test_au_premier_lancement_rien_n_est_configure():
    assert not O.configured()
    assert not O.demo_mode()


def test_demarrer_vierge_ne_cree_aucune_donnee(data_isolee):
    O.start_blank()
    assert O.configured() and not O.demo_mode()
    journal = O.current_journal()
    assert journal.name == "events.jsonl"
    assert Store(journal).events() == []


def test_le_choix_ne_se_redemande_jamais():
    """
    On ne regarde pas si le journal est vide : quelqu'un qui n'écrit rien
    pendant trois jours reverrait l'écran d'accueil à chaque ouverture.
    """
    O.start_blank()
    assert O.configured()
    assert Store(O.current_journal()).events() == []
    assert O.configured()


def test_aucun_compte_n_est_suppose_avant_le_choix():
    """
    Coder « FundedNext, 100 000 $ » en dur produisait des jauges fausses dès le
    second utilisateur — et une jauge fausse est pire qu'une jauge absente.
    C'est l'écran d'accueil qui écrit les règles.
    """
    assert settings.read().get("accounts") is None
    prop.save_accounts([prop.PropRules(label="The5%ers",
                                       start_balance=Decimal("50000"))])
    assert prop.accounts()[0].start_balance == Decimal("50000")


# -------------------------------------------------------------- la démo isolée

def test_la_demo_vit_dans_son_propre_fichier(data_isolee):
    chemin = O.start_demo()
    assert chemin.name == "demo.jsonl"
    store = Store(chemin, demo=True)
    store.create_thesis(_these(), label="démo")

    assert (data_isolee / "demo.jsonl").exists()
    assert not (data_isolee / "events.jsonl").exists(), (
        "le vrai journal ne doit pas exister tant qu'on n'a rien fait de vrai")


def test_chaque_evenement_de_demo_est_marque(data_isolee):
    store = Store(O.start_demo(), demo=True)
    store.create_thesis(_these(), label="démo")
    assert all(e.get("demo") for e in store.events())


def test_un_store_normal_ne_marque_rien(data_isolee):
    store = Store(O.start_blank())
    store.create_thesis(_these(), label="vrai")
    assert not any(e.get("demo") for e in store.events())


def test_la_demonstration_est_entierement_inventee(data_isolee):
    """
    Aucune donnée réelle : ni compte, ni ticket, ni rapport de broker. Le jour
    où on donne le programme à quelqu'un, il ne repart pas avec l'historique de
    trading de celui qui l'a construit.
    """
    from seed_demo import COMPTE, seed

    store = Store(O.start_demo(), demo=True)
    seed(store, verbose=False)

    ideas, positions, deals = store.load()
    assert COMPTE.startswith("DEMO")
    assert {p.account_id for p in positions.values()} == {COMPTE}
    assert {i.account_id for i in ideas.values()} == {COMPTE}

    brut = O.current_journal().read_text(encoding="utf-8")
    assert "14124899" not in brut, "le vrai numéro de compte a fuité"
    assert "251022835" not in brut, "un vrai ticket a fuité"


def test_la_demonstration_raconte_quelque_chose(data_isolee):
    """
    Elle n'est pas là pour remplir l'écran : elle doit montrer le signal le plus
    cher de l'outil — un noyau gagnant, des renforcements qui reprennent tout —
    et un trade encore ouvert.
    """
    from seed_demo import seed
    from core.specs import SpecBook

    store = Store(O.start_demo(), demo=True)
    idee_id = seed(store, verbose=False)

    ideas, positions, deals = store.load()
    i = ideas[idee_id]
    assert len(i.positions) == 3 and len(i.adds) == 2
    assert i.pnl_initial > 0 > i.pnl_adds, "le noyau gagne, les adds coûtent"
    assert i.review is not None and i.quadrant.value == "erreur"
    assert i.exposure_is_measured(), "les cases breakeven doivent être répondues"
    assert i.r_multiple(SpecBook(list(positions.values()))) < 0
    assert deals, "sans soldes, ni drawdown ni compliance à montrer"
    assert any(x.is_running for x in ideas.values()), "un trade doit être en cours"


# ------------------------------------------------- la démo saute au 1er import

def test_le_premier_import_reel_met_fin_a_la_demo(data_isolee):
    demo = Store(O.start_demo(), demo=True)
    demo.create_thesis(_these(), label="idée de démonstration")
    assert O.demo_mode()

    reel_path, repris = O.leave_demo()

    assert not O.demo_mode()
    assert reel_path.name == "events.jsonl"
    assert repris == 0, "rien d'écrit par l'utilisateur : rien à reprendre"
    assert Store(reel_path).events() == [], (
        "le vrai journal ne doit contenir AUCUNE ligne de démonstration")


def test_ce_que_l_utilisateur_a_ecrit_pendant_la_demo_est_conserve(data_isolee):
    """
    Le cas qui fait mal : quelqu'un découvre l'outil, écrit une VRAIE idée
    pendant la démonstration, puis importe. Son idée ne doit pas partir à la
    poubelle avec le décor.
    """
    demo = Store(O.start_demo(), demo=True)
    demo.create_thesis(_these(), label="décor de démonstration")

    # l'utilisateur écrit, lui, avec un store non marqué
    sien = Store(O.current_journal(), demo=False)
    idee = sien.create_thesis(_these("UKOUSD"), label="ma vraie idée")

    reel_path, repris = O.leave_demo()
    assert repris == 1

    ideas, _, _ = Store(reel_path).load()
    assert len(ideas) == 1
    assert ideas[idee.id].label == "ma vraie idée"


def test_le_decor_de_demonstration_est_supprime(data_isolee):
    """
    Le trade BTC de démonstration ne doit survivre dans AUCUN fichier. Le
    laisser traîner reviendrait à déposer, dans le dossier de données de
    quelqu'un, un trade qui n'a jamais été le sien — et qui ressemblera à une
    vraie donnée le jour où il ouvrira le dossier.
    """
    Store(O.start_demo(), demo=True).create_thesis(_these(), label="décor BTC")
    O.leave_demo()

    assert not (data_isolee / "demo.jsonl").exists()
    restes = "\n".join(f.read_text(encoding="utf-8")
                       for f in data_isolee.glob("*.jsonl"))
    assert "décor BTC" not in restes


def test_le_decor_n_est_efface_qu_APRES_avoir_sauvé_ce_qui_compte(data_isolee):
    """
    L'ordre est la seule chose qui protège vraiment : si la suppression
    précédait l'écriture, une coupure entre les deux perdrait le travail de
    l'utilisateur.
    """
    Store(O.start_demo(), demo=True).create_thesis(_these(), label="décor")
    Store(O.current_journal(), demo=False).create_thesis(_these("XAUUSD"),
                                                        label="la mienne")
    reel, repris = O.leave_demo()

    assert repris == 1
    assert not (data_isolee / "demo.jsonl").exists()
    assert "la mienne" in reel.read_text(encoding="utf-8")


def test_quitter_la_demo_deux_fois_ne_duplique_rien(data_isolee):
    demo = Store(O.start_demo(), demo=True)
    demo.create_thesis(_these(), label="décor")
    Store(O.current_journal(), demo=False).create_thesis(_these("XAUUSD"),
                                                        label="la mienne")
    O.leave_demo()
    n1 = len(Store(O.current_journal()).events())
    O.leave_demo()            # deuxième import : on n'est plus en démo
    assert len(Store(O.current_journal()).events()) == n1


def test_detection_de_vrais_tickets(data_isolee):
    store = Store(O.start_demo(), demo=True)
    store.import_report([_position()], [])
    assert not O.has_real_positions(store.path), (
        "un ticket marqué démo n'est pas un vrai ticket")

    vrai = Store(O.start_blank())
    vrai.import_report([_position("99002")], [])
    assert O.has_real_positions(vrai.path)


# ------------------------------------------------------------ remise à zéro

def test_la_remise_a_zero_sauvegarde_avant_d_ecarter(data_isolee):
    store = Store(O.start_blank())
    store.create_thesis(_these(), label="trois ans de travail")

    O.reset_all(backup=True)

    assert not (data_isolee / "events.jsonl").exists()
    assert not O.configured()
    sauvegardes = list(data_isolee.glob("*avant-remise-a-zero*"))
    assert sauvegardes, "le journal doit être conservé, pas supprimé"
    assert "trois ans de travail" in sauvegardes[0].read_text(encoding="utf-8")


def test_la_remise_a_zero_jette_la_demonstration_sans_la_sauvegarder(data_isolee):
    """
    Conserver un `demo.20260726.jsonl` n'aurait aucun sens : ça ressemblerait à
    une donnée qu'on n'ose plus supprimer, alors que c'est du décor.
    """
    Store(O.start_demo(), demo=True).create_thesis(_these(), label="décor BTC")
    O.reset_all(backup=True)

    assert not (data_isolee / "demo.jsonl").exists()
    assert not list(data_isolee.glob("demo*avant-remise-a-zero*"))


# ---------------------------------------------------------------- les chemins

def test_le_dossier_de_donnees_est_forcable(data_isolee):
    assert paths.data_dir() == data_isolee


def test_le_journal_ne_vit_jamais_a_cote_du_programme(monkeypatch):
    """
    La règle qui rend le .exe possible : un programme installé dans Program
    Files ne peut pas écrire à côté de lui, et un exe « un seul fichier » se
    décompresse dans un dossier temporaire effacé à la fermeture.
    """
    monkeypatch.delenv("RELEVE_DATA", raising=False)
    monkeypatch.setattr(paths, "is_frozen", lambda: True)
    d = paths.data_dir()
    assert paths.repo_root() not in d.parents
    assert d.is_absolute()
