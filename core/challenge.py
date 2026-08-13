"""
Pilotage du challenge : périodes mensuelles + règles FundedNext.

Deux principes, tous deux dictés par des contraintes réelles :

  1. LE MOIS EST L'UNITÉ D'ANALYSE, mais posé comme une LENTILLE sur le journal,
     pas comme un stockage séparé. Un seul events.jsonl, découpé à la lecture.
     Un trade appartient au mois de sa CLÔTURE (quand le résultat tombe).
     Le mois suit l'heure serveur (UTC+3), comme toutes les dates du domaine.

  2. LES STATS SONT MENSUELLES, MAIS L'ALERTE DE SURVIE EST GLOBALE.
     Le plancher FundedNext (90 000 $ sur un compte 100k, drawdown fixe 10 %)
     est ABSOLU : il ne se remet pas à zéro chaque mois. Calculer la marge sur
     le seul mois courant dirait « tu es large » alors que le mois précédent t'a
     déjà rapproché du plancher. On mélange les deux et on te fait sauter le
     challenge en te croyant à l'abri. Donc : marge de survie = toujours globale.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, Sequence

from .models import Deal, Idea

# --- règles du compte (paramétrables) --------------------------------------
START_BALANCE = Decimal("100000")
MAX_DRAWDOWN_PCT = Decimal("10")            # perte totale max, FIXE base 100k
FLOOR = START_BALANCE * (1 - MAX_DRAWDOWN_PCT / 100)   # 90 000 $ : tu sautes ici


# ---------------------------------------------------------------- périodes

@dataclass(frozen=True)
class Period:
    """Une période d'analyse. year/month = None -> tout l'historique."""
    year: Optional[int] = None
    month: Optional[int] = None

    @property
    def is_all(self) -> bool:
        return self.year is None

    @property
    def label(self) -> str:
        if self.is_all:
            return "Tout l'historique"
        mois = ["", "janvier", "février", "mars", "avril", "mai", "juin",
                "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
        return f"{mois[self.month]} {self.year}"

    def contains(self, dt: datetime) -> bool:
        if self.is_all:
            return True
        return dt.year == self.year and dt.month == self.month


def month_of(dt: datetime) -> Period:
    return Period(year=dt.year, month=dt.month)


def available_periods(ideas: Sequence[Idea]) -> list[Period]:
    """
    Les mois où au moins une idée a été CLÔTURÉE, du plus récent au plus ancien.
    Toujours suivi de « Tout l'historique ».
    """
    months = set()
    for i in ideas:
        if i.is_executed and i.closed_at:
            months.add((i.closed_at.year, i.closed_at.month))
    ordered = [Period(y, m) for y, m in sorted(months, reverse=True)]
    return ordered + [Period()]      # None = tout


def ideas_in(ideas: Sequence[Idea], period: Period) -> list[Idea]:
    """Les idées exécutées dont la CLÔTURE tombe dans la période."""
    return [i for i in ideas
            if i.is_executed and i.closed_at and period.contains(i.closed_at)]


def deals_in(deals: Sequence[Deal], period: Period) -> list[Deal]:
    return [d for d in deals if period.contains(d.time)]


# ---------------------------------------------------------------- challenge

@dataclass
class ChallengeState:
    # --- global (survie) : toujours calculé sur tout l'historique ---
    balance: Decimal                 # dernier solde connu
    balance_date: Optional[date]     # de quand date ce solde
    floor: Decimal                   # plancher fatal (90 000 $)
    margin_to_floor: Decimal         # $ avant de sauter
    margin_pct: Decimal              # marge en % du compte
    drawdown_from_start_pct: Decimal # perte depuis 100k, vs limite 10 %
    lowest_ever: Decimal             # plus bas touché, tout l'historique
    lowest_ever_date: Optional[date]

    # --- période (performance) : calculé sur le mois sélectionné ---
    period_label: str
    period_low: Optional[Decimal]    # plus bas de la période
    period_low_date: Optional[date]
    peak_drawdown_pct: Decimal       # DD depuis le plus-haut, sur la période

    @property
    def survival_tone(self) -> str:
        """vert / ocre / rouge selon la marge restante avant le plancher."""
        pct = float(self.margin_pct)
        if pct <= 2:
            return "loss"
        if pct <= 4:
            return "warn"
        return "gain"


def _balance_series(deals: Sequence[Deal]) -> list[tuple[datetime, Decimal]]:
    return [(d.time, d.balance) for d in sorted(deals, key=lambda x: x.time)]


def compute(all_deals: Sequence[Deal], period: Period) -> Optional[ChallengeState]:
    """
    all_deals : TOUTES les transactions (la survie a besoin de l'historique
    complet, quelle que soit la période affichée).
    """
    if not all_deals:
        return None

    glob = _balance_series(all_deals)

    # --- survie : global, non filtré ---
    balance = glob[-1][1]
    balance_date = glob[-1][0].date()
    margin = balance - FLOOR
    margin_pct = margin / START_BALANCE * 100
    dd_from_start = (START_BALANCE - balance) / START_BALANCE * 100

    lowest_ever = min(b for _, b in glob)
    lowest_ever_date = next(t for t, b in glob if b == lowest_ever).date()

    # --- performance : sur la période ---
    period_deals = deals_in(all_deals, period)
    pser = _balance_series(period_deals) if period_deals else []

    period_low = period_low_date = None
    peak_dd = Decimal(0)
    if pser:
        period_low = min(b for _, b in pser)
        period_low_date = next(t for t, b in pser if b == period_low).date()
        # drawdown depuis le plus-haut ATTEINT dans la période
        peak = pser[0][1]
        for _, b in pser:
            peak = max(peak, b)
            dd = (peak - b) / peak * 100 if peak else Decimal(0)
            peak_dd = max(peak_dd, dd)

    return ChallengeState(
        balance=balance, balance_date=balance_date, floor=FLOOR,
        margin_to_floor=margin, margin_pct=margin_pct,
        drawdown_from_start_pct=dd_from_start,
        lowest_ever=lowest_ever, lowest_ever_date=lowest_ever_date,
        period_label=period.label,
        period_low=period_low, period_low_date=period_low_date,
        peak_drawdown_pct=peak_dd,
    )


# --------------------------------------------- vue « thèses » du tableau de bord

@dataclass
class ThesisLine:
    """
    Une ligne de la section Thèses.

    Deux origines possibles, volontairement mélangées :
      - une vraie thèse (Campaign) regroupant plusieurs idées
      - une idée SANS thèse, qui compte alors pour elle-même

    Sans ce mélange, la somme des lignes ne ferait pas le total du compte, et la
    section mentirait par omission : tes idées non rattachées disparaîtraient.
    """
    label: str
    is_campaign: bool
    n_ideas: int
    instruments: list
    pnl_net: Decimal
    r_total: Optional[Decimal]
    campaign_id: Optional[str] = None
    idea_id: Optional[str] = None


def thesis_lines(ideas: Sequence[Idea], campaigns: dict,
                 spec_book=None) -> list[ThesisLine]:
    """
    Le niveau thèse, pour la période déjà filtrée.

    R d'une thèse = SOMME des R de ses idées (convention retenue : « combien de
    R cette conviction m'a rapporté »).
    """
    out: list[ThesisLine] = []
    used: set = set()

    for cid, camp in campaigns.items():
        if getattr(camp, "abandoned", False):
            continue
        membres = [i for i in ideas if i.campaign_id == cid]
        if not membres:
            continue
        used.update(id(i) for i in membres)
        rs = [i.r_multiple(spec_book) for i in membres]
        out.append(ThesisLine(
            label=camp.display_name,
            is_campaign=True,
            n_ideas=len(membres),
            instruments=sorted({i.symbol for i in membres}),
            pnl_net=sum((i.pnl_net for i in membres), Decimal(0)),
            r_total=sum(rs, Decimal(0)) if rs and all(r is not None for r in rs) else None,
            campaign_id=cid,
        ))

    # les idées orphelines comptent pour elles-mêmes
    for i in ideas:
        if id(i) in used:
            continue
        out.append(ThesisLine(
            label=i.display_name,
            is_campaign=False,
            n_ideas=1,
            instruments=[i.symbol],
            pnl_net=i.pnl_net,
            r_total=i.r_multiple(spec_book),
            idea_id=i.id,
        ))

    return sorted(out, key=lambda l: l.pnl_net, reverse=True)
