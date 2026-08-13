"""
Import CSV, rapproché PAR NUMÉRO DE TICKET.

------------------------------------------------------------------------------
POURQUOI LE TICKET, ET RIEN D'AUTRE

Rapprocher un export avec le journal en comparant symbole + heure + prix, c'est
deviner. Deux entrées BTCUSD à 30 secondes d'écart, un pyramidage, une reprise
après stop : l'heuristique se trompe, et une fusion à tort pollue les
statistiques pour toujours (c'est la même raison qui interdit l'appariement
automatique idée↔ticket).

Le numéro de ticket, lui, sort du terminal. Il est unique, il ne change jamais,
et TU l'as déjà saisi en déclarant l'ouverture du trade. Le rapprochement
devient alors une simple égalité — jamais une supposition.

Conséquence directe : l'import est IDEMPOTENT par construction. Un ticket déjà
importé est ignoré, dix fois de suite, même si le fichier suivant recouvre le
précédent.

------------------------------------------------------------------------------
CE QUE LE CSV NE CONTIENT PAS

Un export CSV de terminal donne des TRADES. Il ne donne presque jamais la série
des SOLDES après chaque transaction — celle dont le drawdown a besoin pour être
mesuré comme le mesure ta prop firm (voir metrics.deal_curve). Quand la colonne
« balance » est absente, l'outil le dit et reconstitue la courbe depuis tes
résultats, en le signalant. Il ne fait pas semblant d'avoir la donnée.

Le rapport HTML MT5, lui, contient la table Ordres (donc le SL au placement,
donc les stops PROUVÉS) et les soldes. Il reste la source la plus riche : les
deux imports coexistent, et c'est volontaire.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
from pathlib import Path
from typing import Iterable, Optional

from .models import Deal, Direction, ExitReason, OpenTrade, Position

NBSP = " "


class CsvError(Exception):
    pass


# ---------------------------------------------------------------- les colonnes

# Un champ du domaine -> tous les intitulés vus dans la nature (FR/EN, MT4, MT5,
# cTrader, TradingView, exports maison). Comparaison faite sur l'intitulé
# normalisé : minuscules, sans accent, sans ponctuation.
SYNONYMS: dict[str, tuple[str, ...]] = {
    "ticket": ("ticket", "position", "positionid", "position id", "deal",
               "dealid", "deal id", "order", "orderid", "order id", "id",
               "numero", "n", "no", "tradeid", "trade id"),
    "symbol": ("symbol", "symbole", "instrument", "paire", "pair", "market",
               "produit"),
    "direction": ("type", "sens", "side", "direction", "action", "operation",
                  "buysell", "buy sell", "trade type", "typedetransaction"),
    "volume": ("volume", "lots", "lot", "size", "quantity", "quantite", "qty",
               "amount", "units"),
    "open_time": ("open time", "opentime", "heure d ouverture", "date d ouverture",
                  "ouverture", "entry time", "entrytime", "time", "heure",
                  "date", "opening time", "open date", "opened"),
    "open_price": ("open price", "openprice", "prix d ouverture", "entry price",
                   "entryprice", "entree", "entry", "price", "prix", "opening price"),
    "close_time": ("close time", "closetime", "heure de cloture", "date de cloture",
                   "cloture", "exit time", "exittime", "closing time",
                   "close date", "closed"),
    "close_price": ("close price", "closeprice", "prix de cloture", "exit price",
                    "exitprice", "sortie", "exit", "closing price"),
    "sl": ("sl", "s l", "stop loss", "stoploss", "stop"),
    "tp": ("tp", "t p", "take profit", "takeprofit", "objectif"),
    "commission": ("commission", "commissions", "frais", "fee", "fees"),
    "swap": ("swap", "swaps", "rollover", "interet"),
    "profit": ("profit", "pnl", "p l", "net profit", "gross profit", "resultat",
               "gain", "net", "profit usd"),
    "balance": ("balance", "solde", "equity", "account balance"),
    "account": ("account", "compte", "login", "account id", "numero de compte"),
    "comment": ("comment", "commentaire", "note", "notes"),
}

# Les champs sans lesquels une ligne ne veut rien dire.
REQUIRED = ("ticket", "symbol", "direction", "open_price")


def normalize(header: str) -> str:
    """« Heure d'ouverture » -> « heure d ouverture ». Comparable, stable."""
    s = (header or "").strip().lower()
    for a, b in (("é", "e"), ("è", "e"), ("ê", "e"), ("à", "a"), ("â", "a"),
                 ("î", "i"), ("ï", "i"), ("ô", "o"), ("û", "u"), ("ù", "u"),
                 ("ç", "c")):
        s = s.replace(a, b)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return re.sub(r"\s+", " ", s)


def guess_mapping(headers: Iterable[str]) -> dict[str, str]:
    """
    Devine quel intitulé du fichier alimente quel champ du domaine.

    Premier arrivé, premier servi : sur un export MT5 où « Time » apparaît deux
    fois (ouverture puis clôture), le premier alimente open_time et le second
    close_time — c'est l'ordre du format, et il ne varie pas.
    """
    mapping: dict[str, str] = {}
    used: set[str] = set()
    normalized = [(h, normalize(h)) for h in headers]

    # 1re passe : correspondance EXACTE, la seule fiable
    for field_name, alts in SYNONYMS.items():
        for original, norm in normalized:
            if original in used:
                continue
            if norm in alts:
                mapping[field_name] = original
                used.add(original)
                break

    # 2e passe : « Prix d'ouverture (USD) » contient « prix d ouverture »
    for field_name, alts in SYNONYMS.items():
        if field_name in mapping:
            continue
        for original, norm in normalized:
            if original in used:
                continue
            if any(a in norm for a in alts if len(a) > 3):
                mapping[field_name] = original
                used.add(original)
                break

    # Cas MT5 : deux colonnes « Time » / « Price » consécutives, la seconde est
    # la clôture. Sans ça, un export MT5 brut perdrait toute sa moitié droite.
    plain = [h for h, n in normalized if n in ("time", "heure")]
    if len(plain) >= 2 and "close_time" not in mapping:
        mapping["close_time"] = plain[1]
    prices = [h for h, n in normalized if n in ("price", "prix")]
    if len(prices) >= 2 and "close_price" not in mapping:
        mapping["close_price"] = prices[1]

    return mapping


# ------------------------------------------------------------------ conversion

def num(s) -> Optional[Decimal]:
    """
    Un nombre, quel que soit le dialecte du terminal.

        "1 234.56"   "1,234.56"   "1 234,56"   "1234,56"   "-0.4"   "(12.30)"

    RÈGLE DE LEVÉE D'AMBIGUÏTÉ, énoncée une fois pour toutes : quand une virgule
    est seule et suivie d'EXACTEMENT trois chiffres, c'est un séparateur de
    milliers (« 1,234 » = mille deux cent trente-quatre). Dans tous les autres
    cas, c'est une virgule décimale. C'est la convention la moins fausse ; elle
    ne se trompe que sur un « 1,234 » qui voudrait dire 1,234 — un prix qu'aucun
    terminal n'écrit ainsi sans point.
    """
    if s is None:
        return None
    if isinstance(s, (int, float, Decimal)):
        return Decimal(str(s))
    t = str(s).replace(NBSP, "").replace(" ", "").replace("%", "").strip()
    if not t or t.lower() in ("-", "n/a", "na", "none", "null", "market"):
        return None

    neg = t.startswith("(") and t.endswith(")")
    if neg:
        t = t[1:-1]

    if "," in t and "." in t:
        t = t.replace(",", "") if t.rindex(".") > t.rindex(",") \
            else t.replace(".", "").replace(",", ".")
    elif "," in t:
        entier, _, frac = t.rpartition(",")
        t = t.replace(",", "") if (len(frac) == 3 and entier.count(",") == 0
                                   and entier != "") else t.replace(",", ".")

    try:
        v = Decimal(t)
    except (InvalidOperation, ValueError):
        return None
    return -v if neg else v


# Formats d'horodatage, du plus spécifique au plus large. Le jour PRÉCÈDE le
# mois dans les formats à slash : c'est la convention de MT4/MT5 en français et
# celle des exports européens. Un export américain se re-mappe à la main.
_DATE_FORMATS = (
    "%Y.%m.%d %H:%M:%S", "%Y.%m.%d %H:%M", "%Y.%m.%d",
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d",
    "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y",
    "%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%d.%m.%Y",
    "%d/%m/%y %H:%M:%S", "%d/%m/%y %H:%M",
    "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M",
)


def when(s) -> Optional[datetime]:
    t = str(s or "").replace(NBSP, " ").strip()
    if not t:
        return None
    t = re.sub(r"\s+", " ", t).replace("Z", "").split("+")[0].strip()
    t = re.sub(r"\.\d+$", "", t)          # millisecondes
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(t, fmt)
        except ValueError:
            continue
    return None


_BUY = {"buy", "achat", "long", "b", "0", "buy limit", "buy stop", "acheter"}
_SELL = {"sell", "vente", "short", "s", "1", "sell limit", "sell stop", "vendre"}


def side(s) -> Optional[Direction]:
    t = normalize(str(s or ""))
    if t in _BUY or t.startswith("buy") or t.startswith("achat") or t.startswith("long"):
        return Direction.BUY
    if t in _SELL or t.startswith("sell") or t.startswith("vente") or t.startswith("short"):
        return Direction.SELL
    return None


def _decode(raw: bytes) -> str:
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _sniff(text: str) -> str:
    """Le séparateur : point-virgule en France, virgule ailleurs, tabulation parfois."""
    head = "\n".join(text.splitlines()[:5])
    counts = {d: head.count(d) for d in (";", ",", "\t", "|")}
    best = max(counts, key=counts.get)
    return best if counts[best] else ","


# ------------------------------------------------------------------- résultat

@dataclass
class CsvRow:
    """Une ligne du fichier, traduite dans le vocabulaire du domaine."""
    ticket: str
    symbol: str
    direction: Direction
    open_price: Decimal
    volume: Decimal = Decimal("0")
    open_time: Optional[datetime] = None
    close_time: Optional[datetime] = None
    close_price: Optional[Decimal] = None
    sl: Optional[Decimal] = None
    tp: Optional[Decimal] = None
    commission: Decimal = Decimal(0)
    swap: Decimal = Decimal(0)
    profit: Optional[Decimal] = None
    balance: Optional[Decimal] = None
    account_id: str = ""
    comment: str = ""
    line: int = 0

    @property
    def is_closed(self) -> bool:
        """
        Une ligne est close si elle porte une heure ET un prix de clôture.

        Un prix de clôture sans heure ne suffit pas : la date de clôture est ce
        qui rattache le trade à un mois (§ « un trade appartient au mois de sa
        clôture »). Sans elle, le trade se rangerait au hasard.
        """
        return self.close_time is not None and self.close_price is not None

    def to_position(self, account_id: str = "") -> Position:
        return Position(
            position_id=self.ticket,
            account_id=self.account_id or account_id,
            symbol=self.symbol,
            direction=self.direction,
            volume=self.volume,
            open_time=self.open_time,
            open_price=self.open_price,
            close_time=self.close_time,
            close_price=self.close_price,
            commission=self.commission,
            swap=self.swap,
            profit_gross=self.profit if self.profit is not None else Decimal(0),
            sl_final=self.sl,
            tp_final=self.tp,
            # Un CSV n'a pas de table Ordres : le SL au placement est inconnu.
            # Le stop ne sera donc jamais « PROUVÉ » par cette voie — il viendra
            # de ton idée ou de ta déclaration d'ouverture, ce qui est mieux.
            sl_at_placement=None,
            exit_reason=_exit_reason(self.comment),
        )

    def to_open_trade(self, account_id: str = "") -> OpenTrade:
        return OpenTrade(
            ticket=self.ticket,
            symbol=self.symbol,
            direction=self.direction,
            volume=self.volume,
            open_time=self.open_time,
            open_price=self.open_price,
            account_id=self.account_id or account_id,
            stop=self.sl,
            take_profit=self.tp,
            note=self.comment,
        )


def _exit_reason(comment: str) -> ExitReason:
    m = re.search(r"\[?(sl|tp)\b", (comment or "").strip(), re.I)
    if m:
        return (ExitReason.STOP_LOSS if m.group(1).lower() == "sl"
                else ExitReason.TAKE_PROFIT)
    return ExitReason.MANUAL if comment else ExitReason.UNKNOWN


@dataclass
class CsvFile:
    rows: list[CsvRow] = field(default_factory=list)
    headers: list[str] = field(default_factory=list)
    mapping: dict[str, str] = field(default_factory=dict)
    delimiter: str = ","
    account_id: str = ""
    skipped: list[tuple[int, str]] = field(default_factory=list)
    has_balance: bool = False

    @property
    def missing(self) -> list[str]:
        """Les champs indispensables que le fichier n'a pas fournis."""
        return [f for f in REQUIRED if f not in self.mapping]

    @property
    def closed(self) -> list[CsvRow]:
        return [r for r in self.rows if r.is_closed]

    @property
    def still_open(self) -> list[CsvRow]:
        return [r for r in self.rows if not r.is_closed]


def parse(source, mapping: Optional[dict[str, str]] = None) -> CsvFile:
    """
    Lit un CSV et le traduit. `mapping` force la correspondance des colonnes
    quand le fichier n'a pas d'intitulés reconnaissables (mapping manuel).

    Une ligne illisible n'interrompt jamais l'import : elle part dans `skipped`
    avec son numéro et sa raison. Un fichier de 300 lignes ne doit pas être
    perdu pour une ligne de total en bas de page.
    """
    raw = Path(source).read_bytes() if isinstance(source, (str, Path)) else source
    text = _decode(raw) if isinstance(raw, bytes) else raw
    if not text.strip():
        raise CsvError("Fichier vide.")

    delim = _sniff(text)
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    lignes = [r for r in reader if any((c or "").strip() for c in r)]
    if not lignes:
        raise CsvError("Aucune ligne exploitable.")

    # L'en-tête n'est pas toujours la première ligne : MT4 et certains exports
    # placent un titre, une date, une ligne vide. On prend la première ligne
    # dont au moins trois cellules ressemblent à des intitulés connus.
    head_idx, headers, guessed = 0, lignes[0], {}
    for i, ligne in enumerate(lignes[:10]):
        g = guess_mapping(ligne)
        if len(g) >= 3:
            head_idx, headers, guessed = i, ligne, g
            break
    else:
        guessed = guess_mapping(lignes[0])

    mapping = dict(mapping) if mapping else guessed
    out = CsvFile(headers=list(headers), mapping=mapping, delimiter=delim)

    if out.missing:
        # On renvoie quand même l'objet : l'interface propose alors le mapping
        # manuel plutôt que de rejeter le fichier.
        return out

    idx = {f: headers.index(h) for f, h in mapping.items() if h in headers}

    def cell(row: list[str], f: str) -> Optional[str]:
        i = idx.get(f)
        if i is None or i >= len(row):
            return None
        return (row[i] or "").strip()

    for n, row in enumerate(lignes[head_idx + 1:], start=head_idx + 2):
        ticket = (cell(row, "ticket") or "").strip()
        # Une ligne de total (« Total : 8 240.00 ») n'a pas de ticket numérique.
        if not ticket or not re.fullmatch(r"[0-9A-Za-z\-_]{3,}", ticket):
            out.skipped.append((n, "pas de numéro de ticket exploitable"))
            continue
        sym = (cell(row, "symbol") or "").upper()
        d = side(cell(row, "direction"))
        op = num(cell(row, "open_price"))
        if not sym or d is None or op is None:
            out.skipped.append((n, "symbole, sens ou prix d'entrée illisible"))
            continue
        ot = when(cell(row, "open_time"))
        if ot is None:
            # Sans heure d'entrée, impossible d'ordonner le trade, de mesurer sa
            # durée, ni de vérifier qu'une idée le précédait. On refuse plutôt
            # que de dater au hasard.
            out.skipped.append((n, "heure d'ouverture illisible ou absente"))
            continue

        bal = num(cell(row, "balance"))
        if bal is not None:
            out.has_balance = True

        out.rows.append(CsvRow(
            ticket=ticket, symbol=sym, direction=d, open_price=op,
            volume=num(cell(row, "volume")) or Decimal(0),
            open_time=ot,
            close_time=when(cell(row, "close_time")),
            close_price=num(cell(row, "close_price")),
            sl=num(cell(row, "sl")), tp=num(cell(row, "tp")),
            commission=num(cell(row, "commission")) or Decimal(0),
            swap=num(cell(row, "swap")) or Decimal(0),
            profit=num(cell(row, "profit")),
            balance=bal,
            account_id=(cell(row, "account") or "").strip(),
            comment=cell(row, "comment") or "",
            line=n,
        ))

    if not out.rows:
        raise CsvError(
            "Aucune ligne de trade lisible. Les colonnes attendues sont au "
            "minimum : ticket, symbole, sens, prix d'entrée. "
            "Utilise le mapping manuel si ton export a des intitulés exotiques.")

    comptes = {r.account_id for r in out.rows if r.account_id}
    out.account_id = comptes.pop() if len(comptes) == 1 else ""
    return out


# --------------------------------------------------------- le rapprochement

class Outcome(str, Enum):
    CLOSES = "cloture"        # ce ticket clôture un trade déclaré en cours
    UPDATES = "maj"           # ce ticket est déclaré en cours et l'est toujours
    NEW_CLOSED = "nouveau"    # ticket clôturé jamais vu : à rattacher à une idée
    NEW_OPEN = "nouveau_ouvert"  # ticket encore ouvert et jamais déclaré
    KNOWN = "connu"           # déjà importé : ignoré, sans bruit


@dataclass
class Match:
    row: CsvRow
    outcome: Outcome
    idea_id: Optional[str] = None
    open_trade: Optional[OpenTrade] = None

    @property
    def label(self) -> str:
        return {
            Outcome.CLOSES: "clôture le trade ouvert",
            Outcome.UPDATES: "met à jour « en cours »",
            Outcome.NEW_CLOSED: "nouveau trade",
            Outcome.NEW_OPEN: "nouveau trade ouvert",
            Outcome.KNOWN: "déjà connu — ignoré",
        }[self.outcome]


def reconcile(csvfile: CsvFile, known_positions: dict[str, Position],
              pending: dict[str, tuple[str, OpenTrade]]) -> list[Match]:
    """
    Confronte le fichier au journal. Ne décide rien : décrit.

    known_positions : uid -> Position déjà importée
    pending         : ticket -> (idea_id, OpenTrade) déclarés ouverts
    """
    known_tickets = {p.position_id for p in known_positions.values()}
    out: list[Match] = []

    for r in csvfile.rows:
        declared = pending.get(r.ticket)

        if r.ticket in known_tickets:
            out.append(Match(r, Outcome.KNOWN))
        elif declared and r.is_closed:
            out.append(Match(r, Outcome.CLOSES, idea_id=declared[0],
                             open_trade=declared[1]))
        elif declared:
            out.append(Match(r, Outcome.UPDATES, idea_id=declared[0],
                             open_trade=declared[1]))
        elif r.is_closed:
            out.append(Match(r, Outcome.NEW_CLOSED))
        else:
            out.append(Match(r, Outcome.NEW_OPEN))

    return out


def balance_deals(csvfile: CsvFile, account_id: str = "") -> list[Deal]:
    """
    Reconstruit des transactions à partir de la colonne « balance », QUAND elle
    existe. C'est ce qui alimente la courbe de solde et le drawdown mesuré
    transaction par transaction.

    Sans cette colonne, on ne renvoie rien — et l'interface le dit plutôt que
    d'inventer une courbe.
    """
    if not csvfile.has_balance:
        return []
    out = []
    for r in sorted((x for x in csvfile.closed if x.balance is not None),
                    key=lambda x: x.close_time):
        out.append(Deal(
            deal_id=f"csv:{r.ticket}",
            time=r.close_time,
            symbol=r.symbol,
            deal_type=r.direction.value,
            entry="out",
            volume=r.volume,
            price=r.close_price,
            order_id=r.ticket,
            commission=r.commission,
            fee=Decimal(0),
            swap=r.swap,
            profit=r.profit or Decimal(0),
            balance=r.balance,
            comment=r.comment,
            account_id=r.account_id or account_id,
        ))
    return out
