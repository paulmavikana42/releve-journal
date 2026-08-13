"""
Reprendre un journal d'une version précédente.

Le vrai risque ici n'est pas de mal lire un fichier : c'est d'ÉCRASER trois ans
d'idées avec un fichier qui n'était pas le bon. D'où l'ordre imposé — regarder,
refuser si ce n'est pas un journal, sauvegarder, et seulement ensuite écrire.
"""
import json
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from core import migration as M
from core import onboarding as O
from core import paths, settings
from core.models import Direction, RiskSource, Thesis
from core.store import Store


@pytest.fixture(autouse=True)
def data_isolee(tmp_path, monkeypatch):
    monkeypatch.setenv("RELEVE_DATA", str(tmp_path))
    return tmp_path


# --- un journal tel que l'écrivait la PREMIÈRE version : pas de account_id, pas
# de drapeau demo, pas de trade ouvert, pas de capture. Rien de tout ça
# n'existait, et pourtant il doit se relire.
ANCIEN = "\n".join([
    json.dumps({"v": 1, "ts": "2026-05-02T08:00:00+00:00", "type": "thesis_created",
                "payload": {"id": "abc123", "created_at": {"$dt": "2026-05-02T08:00:00"},
                            "thesis": {"instrument": "EURUSD", "direction": "sell",
                                       "macro_theme": "BCE / zone euro",
                                       "entry_planned": {"$dec": "1.0900"},
                                       "stop_initial": {"$dec": "1.1000"},
                                       "risk_pct": {"$dec": "0.5"},
                                       "risk_source": "computed", "targets": []},
                            "status": "armee", "off_plan": False,
                            "label": "Short EURUSD — BCE"}}),
    json.dumps({"v": 1, "ts": "2026-05-04T18:00:00+00:00", "type": "position_imported",
                "payload": {"position_id": "77001", "account_id": "14124899",
                            "symbol": "EURUSD", "direction": "sell",
                            "volume": {"$dec": "1.0"},
                            "open_time": {"$dt": "2026-05-03T09:00:00"},
                            "open_price": {"$dec": "1.0900"},
                            "close_time": {"$dt": "2026-05-04T17:00:00"},
                            "close_price": {"$dec": "1.0850"},
                            "commission": {"$dec": "0"}, "swap": {"$dec": "0"},
                            "profit_gross": {"$dec": "500"},
                            "exit_reason": "manual"}}),
    json.dumps({"v": 1, "ts": "2026-05-04T18:00:01+00:00", "type": "position_linked",
                "payload": {"idea_id": "abc123", "position_uid": "14124899:77001"}}),
]) + "\n"


def _journal_actuel(label="idée récente"):
    store = Store(O.start_blank())
    store.create_thesis(
        Thesis(instrument="XAUUSD", direction=Direction.BUY,
               entry_planned=Decimal("2380"), stop_initial=Decimal("2360"),
               risk_source=RiskSource.COMPUTED), label=label)
    return store


# ------------------------------------------------------------------ regarder

def test_l_apercu_dit_ce_que_contient_le_fichier():
    ap = M.inspect(ANCIEN.encode("utf-8"))
    assert ap.evenements == 3
    assert ap.idees == 1 and ap.tickets == 1
    assert ap.illisibles == 0
    assert ap.types_inconnus == set()
    assert ap.premiere.date() == datetime(2026, 5, 2, tzinfo=timezone.utc).date()


def test_un_fichier_qui_n_est_pas_un_journal_est_refuse():
    """Mieux vaut un refus clair qu'un journal écrasé par un CSV."""
    with pytest.raises(M.MigrationError):
        M.inspect(b"Ticket;Symbol;Type\n88210912;UKOUSD;buy\n")
    with pytest.raises(M.MigrationError):
        M.inspect(b"")


def test_une_ligne_corrompue_ne_condamne_pas_le_fichier():
    abime = ANCIEN + "{ceci n'est pas du json\n"
    ap = M.inspect(abime.encode("utf-8"))
    assert ap.evenements == 3 and ap.illisibles == 1


def test_un_type_inconnu_est_signale_pas_avale():
    """
    Un événement d'une version PLUS récente n'est pas une erreur — mais
    l'ignorer en silence ferait disparaître de la donnée sans le dire.
    """
    futur = ANCIEN + json.dumps({"v": 2, "ts": "2027-01-01T00:00:00+00:00",
                                 "type": "chose_du_futur", "payload": {}}) + "\n"
    ap = M.inspect(futur.encode("utf-8"))
    assert ap.types_inconnus == {"chose_du_futur"}


# ------------------------------------------------------------------ installer

def test_un_ancien_journal_se_relit_sans_conversion(data_isolee):
    """
    LA propriété qui rend la reprise possible : le format n'a pas changé, il a
    grandi. Aucun champ nouveau n'est requis.
    """
    M.install(ANCIEN.encode("utf-8"), mode="remplacer")

    ideas, positions, _ = Store(O.current_journal()).load()
    assert len(ideas) == 1 and len(positions) == 1
    idee = ideas["abc123"]
    assert idee.symbol == "EURUSD"
    assert idee.pnl_net == Decimal("500")
    # Et le R se recalcule tout seul : la valeur du point est rétro-déduite de
    # la position (500 $ / (1 lot × 0.0050)), donc le risque vaut 1 000 $ pour
    # un stop à 100 points. 50 points gagnés sur 100 risqués = +0.5 R.
    assert idee.r_multiple() == Decimal("0.5")
    # les champs qui n'existaient pas prennent leur défaut, sans exception
    assert idee.account_id == ""
    assert idee.open_trades == [] and idee.captures == []


def test_remplacer_sauvegarde_l_ancien_journal(data_isolee):
    _journal_actuel("trois ans de travail")
    ap, ecrites, sauvegarde = M.install(ANCIEN.encode("utf-8"), mode="remplacer")

    assert ecrites == 3
    assert sauvegarde is not None and sauvegarde.exists()
    assert "trois ans de travail" in sauvegarde.read_text(encoding="utf-8")
    # le journal courant, lui, est bien le fichier repris
    assert "trois ans de travail" not in O.current_journal().read_text(encoding="utf-8")


def test_ajouter_ne_reprend_pas_deux_fois_les_memes_lignes(data_isolee):
    """Deux machines, chacune une moitié de l'histoire — puis on recolle."""
    M.install(ANCIEN.encode("utf-8"), mode="remplacer")
    _, ecrites, _ = M.install(ANCIEN.encode("utf-8"), mode="ajouter")

    assert ecrites == 0, "les lignes identiques ne doivent pas être dupliquées"
    ideas, positions, _ = Store(O.current_journal()).load()
    assert len(ideas) == 1 and len(positions) == 1


def test_ajouter_conserve_ce_qui_etait_deja_la(data_isolee):
    _journal_actuel("mon idée du mois")
    _, ecrites, _ = M.install(ANCIEN.encode("utf-8"), mode="ajouter")

    assert ecrites == 3
    ideas, _, _ = Store(O.current_journal()).load()
    labels = {i.label for i in ideas.values()}
    assert "mon idée du mois" in labels and "Short EURUSD — BCE" in labels


def test_reprendre_un_journal_met_fin_a_la_demonstration(data_isolee):
    """
    De vraies données arrivent : le décor n'a plus lieu d'être, et il ne doit
    pas rester un fichier de démonstration à côté du vrai journal.
    """
    Store(O.start_demo(), demo=True).create_thesis(
        Thesis(instrument="BTCUSD", direction=Direction.SELL), label="décor BTC")
    assert O.demo_mode()

    M.install(ANCIEN.encode("utf-8"), mode="remplacer")

    assert not O.demo_mode()
    assert O.configured()
    assert not (data_isolee / "demo.jsonl").exists()
    assert "décor BTC" not in O.current_journal().read_text(encoding="utf-8")


def test_un_mode_inconnu_est_refuse():
    with pytest.raises(M.MigrationError):
        M.install(ANCIEN.encode("utf-8"), mode="fusionner_intelligemment")


def test_utf16_et_bom_sont_acceptes(data_isolee):
    """Un fichier passé par le Bloc-notes de Windows peut arriver en UTF-16."""
    ap = M.inspect(ANCIEN.encode("utf-16"))
    assert ap.evenements == 3
