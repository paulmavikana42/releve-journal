"""
Lecture des exports CSV.

Le parser HTML avait trois pièges connus (UTF-16, cellules fantômes, NBSP). Le
CSV en a d'autres, et ils sont plus sournois parce qu'ils ne lèvent AUCUNE
erreur : une virgule décimale lue comme un séparateur de milliers transforme
1,50 lot en 150 lots, et personne ne s'en aperçoit avant de lire un risque
absurde.

Chaque test ci-dessous fige un dialecte réel de terminal.
"""
from datetime import datetime
from decimal import Decimal

import pytest

from core import csvimport as CSV
from core.models import Direction, Position


# ------------------------------------------------------------------- nombres

@pytest.mark.parametrize("brut,attendu", [
    ("1234.56", "1234.56"),
    ("1 234.56", "1234.56"),          # espace insécable des exports MT
    ("1,234.56", "1234.56"),          # anglo-saxon : virgule = milliers
    ("1 234,56", "1234.56"),          # français : virgule = décimale
    ("1234,56", "1234.56"),
    ("-0.4", "-0.4"),
    ("(12.30)", "-12.30"),            # comptable : parenthèses = négatif
    ("0", "0"),
])
def test_nombres_de_tous_les_dialectes(brut, attendu):
    assert CSV.num(brut) == Decimal(attendu)


def test_la_virgule_a_trois_chiffres_est_un_separateur_de_milliers():
    """
    LA règle d'ambiguïté, figée. « 1,234 » vaut mille deux cent trente-quatre,
    « 1,50 » vaut un et demi. Se tromper ici multiplie un volume par cent.
    """
    assert CSV.num("1,234") == Decimal("1234")
    assert CSV.num("1,50") == Decimal("1.50")
    assert CSV.num("1,5") == Decimal("1.5")


@pytest.mark.parametrize("vide", ["", "   ", "-", "n/a", "market", None])
def test_les_cases_vides_ne_valent_pas_zero(vide):
    """Un zéro se lirait comme une mesure. L'absence doit rester l'absence."""
    assert CSV.num(vide) is None


# --------------------------------------------------------------------- dates

@pytest.mark.parametrize("brut", [
    "2026.07.22 14:05:00", "2026.07.22 14:05", "2026-07-22 14:05:00",
    "22/07/2026 14:05", "22.07.2026 14:05:00", "2026-07-22T14:05:00",
])
def test_dates_de_tous_les_terminaux(brut):
    d = CSV.when(brut)
    assert d.year == 2026 and d.month == 7 and d.day == 22


def test_le_jour_precede_le_mois():
    """
    Convention explicite : les formats à slash sont lus à l'européenne, comme
    les exports MT4/MT5 francophones. 03/07 est le 3 juillet, pas le 7 mars.
    """
    assert CSV.when("03/07/2026").month == 7


# ------------------------------------------------------------------- colonnes

MT5_FR = (
    "Ticket;Symbole;Type;Volume;Heure d'ouverture;Prix d'ouverture;"
    "Heure de clôture;Prix de clôture;S/L;T/P;Commission;Swap;Profit;Balance\n"
    "88210912;UKOUSD;buy;1.00;2026.07.19 10:30;71.40;2026.07.22 14:05;73.32;"
    "70.20;;0;-4,00;1 925,20;101 925,20\n"
)

CTRADER_EN = (
    "Deal ID,Symbol,Side,Quantity,Opening time,Entry price,Closing time,"
    "Exit price,Stop loss,Net profit\n"
    "88213047,USDJPY,Sell,0.50,2026-07-21 08:15:00,157.80,,,158.60,\n"
)


def test_export_mt5_francais():
    cf = CSV.parse(MT5_FR.encode("utf-8"))
    assert cf.delimiter == ";"
    assert not cf.missing
    r = cf.rows[0]
    assert r.ticket == "88210912"
    assert r.symbol == "UKOUSD"
    assert r.direction == Direction.BUY
    assert r.volume == Decimal("1.00")
    assert r.open_time == datetime(2026, 7, 19, 10, 30)
    assert r.close_price == Decimal("73.32")
    assert r.profit == Decimal("1925.20")
    assert r.is_closed
    assert cf.has_balance


def test_export_ctrader_anglais_encore_ouvert():
    cf = CSV.parse(CTRADER_EN.encode("utf-8"))
    assert cf.delimiter == ","
    r = cf.rows[0]
    assert r.direction == Direction.SELL
    assert r.sl == Decimal("158.60")
    assert not r.is_closed, "sans heure NI prix de clôture, le trade est ouvert"
    assert not cf.has_balance


def test_une_ligne_de_total_ne_fait_pas_tomber_le_fichier():
    """
    Beaucoup d'exports finissent par une ligne de totaux. Perdre 300 trades
    pour une ligne de pied de page serait absurde — elle part dans `skipped`,
    numérotée, et l'import continue.
    """
    texte = MT5_FR + "Total;;;;;;;;;;;;2 355,70;\n"
    cf = CSV.parse(texte.encode("utf-8"))
    assert len(cf.rows) == 1
    assert len(cf.skipped) == 1
    assert cf.skipped[0][0] == 3          # numéro de ligne, pour aller voir


def test_un_fichier_sans_colonnes_reconnaissables_demande_un_mapping():
    """
    On ne devine pas. Un fichier illisible renvoie la liste des champs
    manquants, et l'interface propose le mapping manuel.
    """
    exotique = "col1;col2;col3\n88210912;UKOUSD;71.40\n"
    cf = CSV.parse(exotique.encode("utf-8"))
    assert cf.missing, "des colonnes inconnues doivent être signalées"
    assert cf.rows == []


def test_le_mapping_manuel_debloque_le_fichier():
    exotique = "col1;col2;col3;col4;col5\n88210912;UKOUSD;buy;71.40;2026.07.19 10:30\n"
    cf = CSV.parse(exotique.encode("utf-8"), mapping={
        "ticket": "col1", "symbol": "col2", "direction": "col3",
        "open_price": "col4", "open_time": "col5",
    })
    assert not cf.missing
    assert cf.rows[0].ticket == "88210912"
    assert cf.rows[0].open_price == Decimal("71.40")


def test_utf16_et_bom():
    """MT5 exporte parfois en UTF-16 : un open() naïf renvoie du charabia."""
    cf = CSV.parse(MT5_FR.encode("utf-16"))
    assert cf.rows[0].symbol == "UKOUSD"


def test_une_ligne_sans_heure_d_ouverture_est_refusee():
    """
    Sans heure d'entrée : pas d'ordre, pas de durée, et surtout aucun moyen de
    vérifier qu'une idée précédait le trade. On refuse plutôt que de dater au
    hasard.
    """
    texte = ("Ticket;Symbol;Type;Volume;Open Time;Open Price\n"
             "88210912;UKOUSD;buy;1.00;;71.40\n")
    with pytest.raises(CSV.CsvError):
        CSV.parse(texte.encode("utf-8"))


# -------------------------------------------------------------- rapprochement

def _position(ticket="88210912", account="14124899") -> Position:
    return Position(
        position_id=ticket, account_id=account, symbol="UKOUSD",
        direction=Direction.BUY, volume=Decimal("1"),
        open_time=datetime(2026, 7, 19, 10, 30), open_price=Decimal("71.40"),
        close_time=datetime(2026, 7, 22, 14, 5), close_price=Decimal("73.32"),
        commission=Decimal("0"), swap=Decimal("0"), profit_gross=Decimal("1920"),
    )


def test_un_ticket_deja_importe_est_ignore_sans_bruit():
    cf = CSV.parse(MT5_FR.encode("utf-8"))
    connues = {"14124899:88210912": _position()}
    m = CSV.reconcile(cf, connues, {})[0]
    assert m.outcome == CSV.Outcome.KNOWN


def test_un_ticket_declare_ouvert_est_cloture_par_son_jumeau():
    from core.models import OpenTrade
    cf = CSV.parse(MT5_FR.encode("utf-8"))
    ouvert = OpenTrade(ticket="88210912", symbol="UKOUSD",
                       direction=Direction.BUY, volume=Decimal("1"),
                       open_time=datetime(2026, 7, 19, 10, 30),
                       open_price=Decimal("71.40"), stop=Decimal("70.20"))
    m = CSV.reconcile(cf, {}, {"88210912": ("idee-1", ouvert)})[0]
    assert m.outcome == CSV.Outcome.CLOSES
    assert m.idea_id == "idee-1"


def test_un_ticket_inconnu_et_encore_ouvert_est_signale_comme_tel():
    cf = CSV.parse(CTRADER_EN.encode("utf-8"))
    m = CSV.reconcile(cf, {}, {})[0]
    assert m.outcome == CSV.Outcome.NEW_OPEN


def test_la_colonne_solde_alimente_la_courbe_du_drawdown():
    cf = CSV.parse(MT5_FR.encode("utf-8"))
    deals = CSV.balance_deals(cf)
    assert len(deals) == 1
    assert deals[0].balance == Decimal("101925.20")


def test_sans_colonne_solde_on_ne_fabrique_aucune_courbe():
    """Inventer des soldes donnerait un drawdown faux, donc rassurant."""
    cf = CSV.parse(CTRADER_EN.encode("utf-8"))
    assert CSV.balance_deals(cf) == []
