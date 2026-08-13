"""
Parser du rapport d'historique MT5 (.html).

Trois pièges du format, tous neutralisés ici :

  1. ENCODAGE. MT5 exporte en UTF-16LE avec BOM. Un open() naïf renvoie du
     charabia.

  2. CELLULES FANTÔMES. MT5 insère des <td class="hidden" colspan="8"> pour
     aligner ses colonnes dans le navigateur. pandas.read_html les compte comme
     des colonnes réelles et DÉCALE SILENCIEUSEMENT toutes les données. Tu
     obtiens des chiffres faux, sans la moindre erreur. C'est la raison pour
     laquelle on n'utilise pas read_html ici.

  3. SÉPARATEURS. Les milliers sont séparés par des espaces insécables
     (U+00A0). "100 000.00" -> float() lève une exception.

Le parser est tolérant aux libellés FR et EN.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Optional
import re

from bs4 import BeautifulSoup

from .models import Deal, Direction, ExitReason, Position

NBSP = "\u00a0"

_SECTIONS = {
    "positions": "positions", "ordres": "orders", "orders": "orders",
    "transactions": "deals", "deals": "deals",
}

_HEADER_KEYS = {
    "nom": "name", "name": "name",
    "compte": "account", "account": "account",
    "courtier": "broker", "broker": "broker",
    "date": "date",
}


class ParseError(Exception):
    pass


# --------------------------------------------------------------------- outils

def num(s: Optional[str]) -> Optional[Decimal]:
    """'100 000.00' -> Decimal('100000.00'). '' / 'market' -> None."""
    if s is None:
        return None
    s = s.replace(NBSP, "").replace(" ", "").replace("%", "").strip()
    if not s or s.lower() in ("market", "-"):
        return None
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return None


def dt(s: Optional[str]) -> Optional[datetime]:
    s = (s or "").strip()
    for fmt in ("%Y.%m.%d %H:%M:%S", "%Y.%m.%d %H:%M"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _decode(path: Path) -> str:
    raw = path.read_bytes()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    for enc in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _cells(tr) -> list[str]:
    """Aplatit une ligne EN JETANT les cellules fantômes de mise en page."""
    out = []
    for td in tr.find_all("td"):
        if "hidden" in (td.get("class") or []):
            continue
        out.append(td.get_text().replace(NBSP, " ").strip())
    return out


def _exit_reason(comment: str) -> ExitReason:
    """MT5 encode la cause de sortie dans le commentaire : '[sl 62943.31]'."""
    m = re.match(r"\[(sl|tp)\b", (comment or "").strip(), re.I)
    if m:
        return ExitReason.STOP_LOSS if m.group(1).lower() == "sl" else ExitReason.TAKE_PROFIT
    return ExitReason.MANUAL


# ------------------------------------------------------------------- résultat

class Report:
    def __init__(self, account_id, account_name, broker, currency, report_date):
        self.account_id = account_id
        self.account_name = account_name
        self.broker = broker
        self.currency = currency
        self.report_date = report_date
        self.positions: list[Position] = []
        self.deals: list[Deal] = []

    @property
    def equity_start(self) -> Optional[Decimal]:
        """Solde avant le premier trade = dépôt initial."""
        for d in self.deals:
            if d.is_funding:
                return d.balance
        return None

    def __repr__(self):
        return (f"<Report {self.account_id} {self.currency} "
                f"{len(self.positions)} positions {len(self.deals)} deals>")


# --------------------------------------------------------------------- parser

def parse_report(path) -> Report:
    path = Path(path)
    soup = BeautifulSoup(_decode(path), "lxml")

    # --- en-tête : les <th> vont par paires libellé / valeur
    head: dict[str, str] = {}
    for th in soup.find_all("th"):
        key = th.get_text().strip().rstrip(":").lower()
        if key in _HEADER_KEYS:
            nxt = th.find_next_sibling("th")
            if nxt:
                head[_HEADER_KEYS[key]] = nxt.get_text().replace(NBSP, " ").strip()

    acct = head.get("account", "")
    account_id = acct.split("(")[0].strip() or "unknown"
    currency = acct.split("(")[1].split(",")[0].strip() if "(" in acct else "USD"

    report = Report(
        account_id=account_id,
        account_name=head.get("name", ""),
        broker=head.get("broker", ""),
        currency=currency,
        report_date=dt(head.get("date")) or datetime.now(),
    )

    # --- passe 1 : la table ORDRES.
    # Le SL qu'elle contient est celui du PLACEMENT de l'ordre. Croisé avec le SL
    # final de la table Positions, il permet de PROUVER qu'un stop n'a jamais été
    # déplacé — donc de récupérer le vrai stop d'origine sans rien demander.
    # L'identifiant de position MT5 est celui de son ordre d'ouverture.
    sl_at_placement: dict[str, Decimal] = {}
    section = None
    for tr in soup.find_all("tr"):
        th = tr.find("th")
        if th:
            title = th.get_text().strip().lower()
            if title in _SECTIONS:
                section = _SECTIONS[title]
            continue
        if section != "orders":
            continue
        c = _cells(tr)
        if len(c) >= 8 and c[1].isdigit():
            sl = num(c[6])
            if sl is not None:
                sl_at_placement[c[1]] = sl

    # --- passe 2 : positions et transactions
    section = None
    for tr in soup.find_all("tr"):
        th = tr.find("th")
        if th:
            title = th.get_text().strip().lower()
            if title in _SECTIONS:
                section = _SECTIONS[title]
            continue

        c = _cells(tr)
        if len(c) < 5 or c[0] in ("Heure", "Heure d'ouverture", "Time", "Open Time"):
            continue

        if section == "positions" and len(c) >= 13 and dt(c[0]):
            try:
                direction = Direction(c[3].lower())
            except ValueError:
                continue
            close_t = dt(c[8])
            if close_t is None:
                continue  # position encore ouverte : pas de trade clos, on ignore
            report.positions.append(Position(
                position_id=c[1],
                account_id=account_id,
                symbol=c[2],
                direction=direction,
                volume=num(c[4]) or Decimal(0),
                open_time=dt(c[0]),
                open_price=num(c[5]) or Decimal(0),
                sl_final=num(c[6]),
                tp_final=num(c[7]),
                close_time=close_t,
                close_price=num(c[9]) or Decimal(0),
                commission=num(c[10]) or Decimal(0),
                swap=num(c[11]) or Decimal(0),
                profit_gross=num(c[12]) or Decimal(0),
                sl_at_placement=sl_at_placement.get(c[1]),
            ))

        elif section == "deals" and len(c) >= 13 and c[1].isdigit():
            report.deals.append(Deal(
                deal_id=c[1],
                time=dt(c[0]),
                symbol=c[2],
                deal_type=c[3],
                entry=c[4],
                volume=num(c[5]),
                price=num(c[6]),
                order_id=c[7],
                commission=num(c[8]) or Decimal(0),
                fee=num(c[9]) or Decimal(0),
                swap=num(c[10]) or Decimal(0),
                profit=num(c[11]) or Decimal(0),
                balance=num(c[12]) or Decimal(0),
                comment=c[13] if len(c) > 13 else "",
                account_id=account_id,
            ))

    # --- cause de sortie : elle vit dans le deal de clôture, pas dans la position.
    # On la remonte en appariant sur (symbole, heure de clôture).
    exits = {(d.symbol, d.time): d.comment for d in report.deals if d.entry == "out"}
    enriched = []
    for p in report.positions:
        comment = exits.get((p.symbol, p.close_time))
        reason = _exit_reason(comment) if comment is not None else ExitReason.UNKNOWN
        enriched.append(Position(**{**p.__dict__, "exit_reason": reason}))
    report.positions = enriched

    if not report.positions and not report.deals:
        raise ParseError(
            "Aucune position ni transaction trouvée. Le fichier est-il bien un "
            "« Rapport d'historique » MT5 et non un « Relevé » ?"
        )

    return report
