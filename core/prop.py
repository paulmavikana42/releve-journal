"""
Compliance prop firm : les règles du challenge, vérifiées à chaque import.

------------------------------------------------------------------------------
CE QUI CHANGE PAR RAPPORT À challenge.py

`challenge.py` répond à UNE question, la plus vitale : « combien me reste-t-il
avant le plancher ? » — marge de survie, globale, jamais remise à zéro.

Ce module répond à la question d'à côté : « suis-je en règle sur TOUTES les
règles de ma firme ? » Perte journalière, drawdown, objectif, jours minimum,
week-end, cohérence. Ce sont des règles contractuelles, elles varient d'une
firme à l'autre, donc elles sont PARAMÉTRABLES — contrairement au plancher
codé en dur qui était juste pour FundedNext et faux ailleurs.

------------------------------------------------------------------------------
DEUX HONNÊTETÉS À NE PAS PERDRE

1. LE SOLDE N'EST PAS LE SOLDE LIVE. L'outil connaît tes trades CLÔTURÉS. Une
   position ouverte fait bouger l'equity en continu ; ici, elle n'entre qu'à
   travers un cours que TU as saisi. Chaque chiffre affiché porte donc sa date,
   et le flottant est toujours signalé comme déclaratif.

2. DRAWDOWN STATIQUE ≠ TRAILING. FundedNext applique un drawdown FIXE base
   100k : le plancher à 90 000 $ ne bouge jamais, même après 50 000 $ de gains.
   D'autres firmes appliquent un trailing sur le plus-haut.
   Les deux sont implémentés, et le mode est affiché en toutes lettres : se
   tromper de mode, c'est croire qu'on a 10 000 $ de marge quand on en a 2 000.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, Sequence

from . import settings
from .models import Deal, Idea

ZERO = Decimal(0)


# ------------------------------------------------------------------ les règles

# Le symbole affiché partout sur un compte, déduit de sa devise.
_CURRENCY_SYMBOLS = {"USD": "$", "EUR": "€", "GBP": "£"}

# Les types de challenge et les phases, nommés une fois pour toutes.
CHALLENGE_TYPES = ("one_phase", "two_phase", "instant")
PHASES = ("p1", "p2", "funded")
TRADING_DAY_RULES = ("position", "gain", "loss")


@dataclass
class PropRules:
    """
    Les règles d'UN compte. Paramétrables, parce qu'elles sont contractuelles.

    Les valeurs par défaut sont celles d'un challenge FundedNext classique :
    100 000 $, 5 % journalier, 10 % total en statique, 2 phases.

    Tout est éditable après création : rien de ce qui est saisi à l'ouverture du
    compte n'est figé (le contraire produisait des jauges fausses qu'on ne
    pouvait plus corriger).
    """
    account_id: str = ""
    label: str = "FundedNext"
    broker: str = ""
    currency: str = "USD"                             # USD | EUR | GBP
    start_balance: Decimal = Decimal("100000")

    # Trade-t-il en prop firm ? Non → aucune règle de challenge ne s'applique,
    # l'écran Compliance est verrouillé et toutes ces options sont sans objet.
    is_prop: bool = True

    # Type de challenge et phase où le client se trouve MAINTENANT.
    challenge_type: str = "two_phase"                 # one_phase | two_phase | instant
    phase: str = "p1"                                 # p1 | p2 | funded

    daily_loss_pct: Decimal = Decimal("5")
    max_drawdown_pct: Decimal = Decimal("10")
    drawdown_static: bool = True                      # False = trailing

    # Objectifs de profit. Aucun en instant funding ni une fois financé.
    profit_target_pct: Optional[Decimal] = Decimal("8")      # 1 phase, ou phase 1
    profit_target_p2_pct: Optional[Decimal] = Decimal("5")   # phase 2
    profit_split_pct: Decimal = Decimal("80")         # part du trader au payout

    # Jours de trading minimum + ce qu'est un « jour de trading » pour la firme.
    min_trading_days: Optional[int] = 3
    trading_day_rule: str = "position"                # position | gain | loss
    trading_day_threshold_pct: Decimal = Decimal("0")  # seuil % pour gain/loss
    min_days_scope: str = "challenge"                 # challenge | always (aussi financé)

    consistency_pct: Optional[Decimal] = Decimal("30")
    # Seuil d'alerte : à 75 % d'une limite, on prévient avant qu'il soit trop tard.
    warn_at: Decimal = Decimal("75")

    @property
    def symbol(self) -> str:
        return _CURRENCY_SYMBOLS.get(self.currency, "$")

    @property
    def is_funded(self) -> bool:
        """Financé : instant funding, ou phase finale franchie → plus d'objectif."""
        return self.challenge_type == "instant" or self.phase == "funded"

    def active_profit_target(self) -> Optional[Decimal]:
        """L'objectif de la phase COURANTE, ou None si financé/instant."""
        if self.is_funded:
            return None
        if self.challenge_type == "two_phase" and self.phase == "p2":
            return self.profit_target_p2_pct
        return self.profit_target_pct

    @property
    def floor(self) -> Decimal:
        """Le plancher fatal, en mode statique."""
        return self.start_balance * (1 - self.max_drawdown_pct / 100)

    @classmethod
    def from_dict(cls, d: dict) -> "PropRules":
        champs = {f for f in cls.__dataclass_fields__}
        out = {}
        for k, v in (d or {}).items():
            if k not in champs:
                continue                              # ex. l'ancien weekend_flat
            if k in ("start_balance", "daily_loss_pct", "max_drawdown_pct",
                     "profit_target_pct", "profit_target_p2_pct", "profit_split_pct",
                     "trading_day_threshold_pct", "consistency_pct", "warn_at"):
                out[k] = Decimal(str(v)) if v is not None else None
            elif k == "min_trading_days":
                out[k] = int(v) if v is not None else None
            elif k in ("drawdown_static", "is_prop"):
                out[k] = bool(v)
            else:
                out[k] = v
        return cls(**out)

    def to_dict(self) -> dict:
        return {
            "account_id": self.account_id, "label": self.label,
            "broker": self.broker, "currency": self.currency,
            "start_balance": str(self.start_balance), "is_prop": self.is_prop,
            "challenge_type": self.challenge_type, "phase": self.phase,
            "daily_loss_pct": str(self.daily_loss_pct),
            "max_drawdown_pct": str(self.max_drawdown_pct),
            "drawdown_static": self.drawdown_static,
            "profit_target_pct": (str(self.profit_target_pct)
                                  if self.profit_target_pct is not None else None),
            "profit_target_p2_pct": (str(self.profit_target_p2_pct)
                                     if self.profit_target_p2_pct is not None else None),
            "profit_split_pct": str(self.profit_split_pct),
            "min_trading_days": self.min_trading_days,
            "trading_day_rule": self.trading_day_rule,
            "trading_day_threshold_pct": str(self.trading_day_threshold_pct),
            "min_days_scope": self.min_days_scope,
            "consistency_pct": (str(self.consistency_pct)
                                if self.consistency_pct is not None else None),
            "warn_at": str(self.warn_at),
        }


DEFAULT_ACCOUNT = PropRules(account_id="", label="FundedNext")


def accounts() -> list[PropRules]:
    """Les comptes déclarés. Toujours au moins un : cloisonner viendra après."""
    raw = settings.get("accounts") or []
    out = [PropRules.from_dict(a) for a in raw]
    return out or [DEFAULT_ACCOUNT]


def save_accounts(rules: Sequence[PropRules]) -> None:
    settings.set("accounts", [r.to_dict() for r in rules])


def rules_for(account_id: str) -> PropRules:
    for a in accounts():
        if a.account_id == (account_id or ""):
            return a
    return accounts()[0]


def belongs_to(idea, account_id: str, default_account_id: str = "") -> bool:
    """
    Cette idée appartient-elle à ce compte ?

    Une idée SANS compte déclaré appartient au premier compte. C'est le cas de
    tout le journal écrit avant l'existence des comptes multiples : la
    rétrograder en « aucun compte » la ferait disparaître de l'écran, ce qui
    ressemblerait beaucoup à une perte de données.
    """
    return (getattr(idea, "account_id", "") or default_account_id) == account_id


# ------------------------------------------------------------------- la courbe

@dataclass
class BalancePoint:
    when: datetime
    balance: Decimal


@dataclass
class Equity:
    """
    La série des soldes, et d'où elle vient — l'origine fait partie du chiffre.

    MEASURED : les soldes viennent du broker (rapport HTML, ou colonne balance
               d'un CSV). C'est la seule série sur laquelle un drawdown se
               mesure comme le mesure la firme : après CHAQUE transaction.
    REBUILT  : reconstituée en cumulant tes résultats sur le solde de départ.
               Juste sur les clôtures, aveugle à tout le reste (frais isolés,
               dépôts, mouvements intrajournaliers). Affichée comme telle.
    """
    points: list[BalancePoint] = field(default_factory=list)
    measured: bool = False

    @property
    def last(self) -> Optional[Decimal]:
        return self.points[-1].balance if self.points else None

    @property
    def lowest(self) -> Optional[Decimal]:
        return min((p.balance for p in self.points), default=None)

    @property
    def highest(self) -> Optional[Decimal]:
        return max((p.balance for p in self.points), default=None)

    def before(self, d: date) -> Optional[Decimal]:
        """Le dernier solde connu AVANT ce jour — la base de la perte du jour."""
        prev = None
        for p in self.points:
            if p.when.date() >= d:
                break
            prev = p.balance
        return prev


def equity_series(rules: PropRules, ideas: Sequence[Idea],
                  deals: Sequence[Deal] = ()) -> Equity:
    """
    La courbe de solde : mesurée si le broker l'a fournie, reconstituée sinon.

    Aucun mélange des deux. Un point mesuré et un point reconstitué n'ont pas la
    même valeur probatoire, et les additionner produirait une courbe dont
    personne ne pourrait plus dire ce qu'elle vaut.
    """
    tradings = [d for d in sorted(deals, key=lambda x: x.time) if d.balance is not None]
    if tradings:
        return Equity([BalancePoint(d.time, d.balance) for d in tradings],
                      measured=True)

    solde = rules.start_balance
    pts = [BalancePoint(datetime.min, solde)]
    closed = sorted((i for i in ideas if i.is_executed and i.closed_at),
                    key=lambda i: i.closed_at)
    for i in closed:
        solde += i.pnl_net
        pts.append(BalancePoint(i.closed_at, solde))
    return Equity(pts, measured=False)


# ------------------------------------------------------------------ le verdict

@dataclass
class Check:
    """Une règle, son état, et de quoi le comprendre sans y réfléchir."""
    key: str
    label: str
    ok: bool
    breached: bool                    # règle franchie : le challenge est perdu
    value: str                        # ce que vaut la mesure, prêt à afficher
    detail: str = ""
    pct: Optional[float] = None       # avancement 0..1 vers la limite (jauges)

    @property
    def tone(self) -> str:
        if self.breached:
            return "loss"
        return "gain" if self.ok else "warn"


@dataclass
class Compliance:
    rules: PropRules
    equity: Equity
    balance: Decimal
    day: date
    daily_pnl: Decimal
    daily_pct: Decimal                # négatif = perte, en % de la base du jour
    daily_limit_pct: Decimal
    drawdown_pct: Decimal             # positif = repli, depuis la base du mode
    drawdown_limit_pct: Decimal
    floor: Decimal
    margin_to_floor: Decimal           # jamais négatif : plancher touché = 0
    profit_pct: Decimal
    trading_days: int                  # jours VALIDES (selon la règle du compte)
    best_day_share: Optional[Decimal]  # part du meilleur jour dans le profit total
    open_symbols: list[str]
    # combien on peut encore risquer AUJOURD'HUI : le plus petit entre la limite
    # du jour et ce qui reste avant le plancher (indexé au drawdown restant).
    daily_allow_amount: Decimal = ZERO
    daily_allow_pct: Decimal = ZERO
    # payout estimé une fois financé : gain × profit split (négatif si en perte).
    payout_amount: Optional[Decimal] = None
    checks: list[Check] = field(default_factory=list)

    @property
    def breached(self) -> list[Check]:
        return [c for c in self.checks if c.breached]

    @property
    def warnings(self) -> list[Check]:
        return [c for c in self.checks if not c.ok and not c.breached]

    @property
    def clean(self) -> bool:
        return not self.breached and not self.warnings

    @property
    def tone(self) -> str:
        if self.breached:
            return "loss"
        return "warn" if self.warnings else "gain"


def _pct(part: Decimal, whole: Decimal) -> Decimal:
    return (part / whole * 100) if whole else ZERO


def evaluate(rules: PropRules, ideas: Sequence[Idea], deals: Sequence[Deal] = (),
             today: Optional[date] = None, now: Optional[datetime] = None
             ) -> Compliance:
    """
    Confronte l'état du compte à ses règles.

    `ideas` doit déjà être filtré sur le compte : cloisonner est la
    responsabilité de l'appelant, pas d'un paramètre oublié ici.
    """
    from .clock import server_now
    now = now or server_now()
    today = today or now.date()

    eq = equity_series(rules, ideas, deals)
    balance = eq.last if eq.last is not None else rules.start_balance

    closed = [i for i in ideas if i.is_executed and i.closed_at]
    opens = [o for i in ideas for o in i.open_trades]

    # --- perte journalière : mesurée sur la base du JOUR, pas sur le capital
    # initial. Une perte de 4 000 $ sur un compte tombé à 95 000 $ fait 4,2 %,
    # pas 4,0 % : c'est ce 0,2 % qui fait sauter un challenge.
    du_jour = [i for i in closed if i.closed_at.date() == today]
    daily_pnl = sum((i.pnl_net for i in du_jour), ZERO)
    base_jour = eq.before(today) or rules.start_balance
    daily_pct = _pct(daily_pnl, base_jour)

    # --- drawdown
    if rules.drawdown_static:
        base_dd = rules.start_balance
        floor = rules.floor
    else:
        base_dd = eq.highest or rules.start_balance
        floor = base_dd * (1 - rules.max_drawdown_pct / 100)
    plus_bas = eq.lowest if eq.lowest is not None else balance
    # Un compte qui n'est jamais passé sous sa base n'a pas un drawdown négatif :
    # il a un drawdown NUL. Sans ce plancher à zéro, l'écran affichait « -−0,43 % ».
    creux = base_dd - min(plus_bas, balance)
    dd_pct = _pct(creux, base_dd) if creux > 0 else ZERO
    # Plancher touché → il ne reste RIEN. On ne montre jamais une marge négative :
    # « il te reste -300 $ » n'a pas de sens, le compte est déjà perdu.
    marge = balance - floor
    if marge < ZERO:
        marge = ZERO

    # Combien puis-je encore risquer AUJOURD'HUI ? Le plus petit entre la limite du
    # jour (base_jour × perte/jour) et ce qui reste avant le plancher : quand le
    # plancher est plus proche, c'est LUI qui borne la journée. On l'exprime en
    # devise ET en % de la base du jour.
    # Certains comptes (futures intraday, type Apex) n'ont AUCUNE limite
    # journalière : seul le plancher borne alors la journée.
    daily_cap = (base_jour * rules.daily_loss_pct / 100
                 if rules.daily_loss_pct else marge)
    daily_allow_amount = min(daily_cap, marge)
    daily_allow_pct = _pct(daily_allow_amount, base_jour)

    profit_pct = _pct(balance - rules.start_balance, rules.start_balance)

    # Payout estimé une fois financé : ta part réelle du gain. En perte, on montre
    # le gain net négatif tel quel (rien à toucher, il faut d'abord revenir).
    payout_amount = None
    if rules.is_funded:
        gain_net = balance - rules.start_balance
        payout_amount = (gain_net * rules.profit_split_pct / 100
                         if gain_net > 0 else gain_net)

    par_jour: dict[date, Decimal] = {}
    for i in closed:
        par_jour[i.closed_at.date()] = par_jour.get(i.closed_at.date(), ZERO) + i.pnl_net

    # Un « jour de trading » selon la DÉFINITION de la firme (reprise du compte) :
    # une simple position, ou un gain/perte au-delà d'un seuil.
    def _jour_valide(pnl_j: Decimal, base_j: Decimal) -> bool:
        seuil = base_j * rules.trading_day_threshold_pct / 100
        if rules.trading_day_rule == "gain":
            return pnl_j >= seuil
        if rules.trading_day_rule == "loss":
            return pnl_j <= -seuil
        return True
    jours = sorted(dj for dj, pnl in par_jour.items()
                   if _jour_valide(pnl, eq.before(dj) or rules.start_balance))

    gains = [v for v in par_jour.values() if v > 0]
    total_gain = sum(gains, ZERO)
    best_share = (max(gains) / total_gain * 100) if gains and total_gain else None

    checks: list[Check] = []

    # 1. perte journalière — 0 = pas de limite (futures intraday)
    limite_j = rules.daily_loss_pct
    perte_j = -daily_pct if daily_pct < 0 else ZERO
    _sans_j = limite_j == 0
    checks.append(Check(
        key="daily",
        label="Perte journalière",
        ok=_sans_j or perte_j < limite_j * rules.warn_at / 100,
        breached=(not _sans_j) and perte_j >= limite_j,
        value=("aucune limite" if _sans_j else f"{float(daily_pct):+.2f} %"),
        detail=("pas de limite journalière sur ce compte (fréquent en futures intraday)"
                if _sans_j else
                f"limite {float(limite_j):.0f} % · base du jour "
                f"{float(base_jour):,.0f}".replace(",", " ")),
        pct=None if _sans_j else float(perte_j / limite_j),
    ))

    # 2. drawdown max
    checks.append(Check(
        key="drawdown",
        label="Drawdown max",
        ok=dd_pct < rules.max_drawdown_pct * rules.warn_at / 100,
        breached=dd_pct >= rules.max_drawdown_pct,
        value=f"-{float(dd_pct):.2f} %" if dd_pct > 0 else "0.00 %",
        detail=(f"limite {float(rules.max_drawdown_pct):.0f} % · "
                f"{'statique' if rules.drawdown_static else 'trailing'} · "
                f"plancher {float(floor):,.0f}".replace(",", " ")),
        pct=float(dd_pct / rules.max_drawdown_pct) if rules.max_drawdown_pct else None,
    ))

    # 3. objectif de profit de la PHASE COURANTE — un objectif non atteint n'est
    # pas une infraction. Aucun objectif en instant funding ni une fois financé.
    _target = rules.active_profit_target()
    if _target:
        _p2 = rules.challenge_type == "two_phase" and rules.phase == "p2"
        checks.append(Check(
            key="target",
            label="Objectif de profit",
            ok=profit_pct >= _target,
            breached=False,
            value=f"{float(profit_pct):+.2f} %",
            detail=f"objectif +{float(_target):.0f} %" + (" · phase 2" if _p2 else ""),
            pct=(float(max(profit_pct, ZERO) / _target) if _target else None),
        ))

    # 4. jours de trading minimum — selon la DÉFINITION du compte, et PLAFONNÉS :
    # 3/3 ne devient jamais 4/3. Ils ne s'appliquent qu'en challenge si le compte
    # l'a précisé (min_days_scope), sinon aussi une fois financé.
    _days_actifs = rules.min_trading_days and not (
        rules.is_funded and rules.min_days_scope == "challenge")
    if _days_actifs:
        _atteints = min(len(jours), rules.min_trading_days)
        _defs = {"position": "une position ouverte",
                 "gain": f"un gain ≥ {float(rules.trading_day_threshold_pct):.2f} %",
                 "loss": f"une perte ≥ {float(rules.trading_day_threshold_pct):.2f} %"}
        checks.append(Check(
            key="days",
            label="Jours de trading min.",
            ok=len(jours) >= rules.min_trading_days,
            breached=False,
            value=f"{_atteints} / {rules.min_trading_days} requis",
            detail=f"un jour compte avec {_defs.get(rules.trading_day_rule, 'une clôture')}",
            pct=min(1.0, len(jours) / rules.min_trading_days),
        ))

    # (la règle « position le week-end » a été retirée sur décision de Paul.)

    # 6. cohérence : aucune firme ne l'appelle une infraction avant la
    # validation, mais toutes la vérifient à ce moment-là. Donc : alerte, jamais
    # « breach ».
    if rules.consistency_pct and best_share is not None:
        checks.append(Check(
            key="consistency",
            label="Cohérence (consistency)",
            ok=best_share <= rules.consistency_pct,
            breached=False,
            value=f"{float(best_share):.0f} %",
            detail=(f"ton meilleur jour pèse {float(best_share):.0f} % du profit "
                    f"total · reste sous {float(rules.consistency_pct):.0f} %"),
            pct=float(best_share / rules.consistency_pct),
        ))

    return Compliance(
        rules=rules, equity=eq, balance=balance, day=today,
        daily_pnl=daily_pnl, daily_pct=daily_pct, daily_limit_pct=limite_j,
        drawdown_pct=dd_pct, drawdown_limit_pct=rules.max_drawdown_pct,
        floor=floor, margin_to_floor=marge, profit_pct=profit_pct,
        trading_days=len(jours), best_day_share=best_share,
        open_symbols=sorted({o.symbol for o in opens}),
        daily_allow_amount=daily_allow_amount, daily_allow_pct=daily_allow_pct,
        payout_amount=payout_amount,
        checks=checks,
    )
