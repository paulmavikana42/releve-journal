"""
Métriques.

Deux principes tiennent tout ce module :

  1. L'UNITÉ D'ANALYSE EST L'IDÉE, PAS LE TICKET.
     MT5 compte 3 tickets là où tu as pris 1 décision. Compter les tickets
     gonfle mécaniquement le taux de réussite, puisque chaque renforcement
     gagnant d'une idée perdante compte comme une victoire indépendante.

  2. ON AFFICHE TOUJOURS L'INCERTITUDE.
     Un Sharpe sur 3 trades n'est pas un Sharpe, c'est du bruit avec une
     décimale. Chaque estimateur sort avec sa taille d'échantillon et, quand
     c'est possible, son intervalle de confiance.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import Enum
from statistics import mean, stdev
from typing import Optional, Sequence

from .models import (
    GOOD_PROCESS_MIN, Deal, Idea, Quadrant, RiskSource, ThesisOutcome,
)

TRADING_DAYS = 252


def _f(x) -> float:
    return float(x) if x is not None else float("nan")


# ---------------------------------------------------------------- distribution

@dataclass
class Distribution:
    n: int
    mean: float
    median: float
    std: float
    best: float
    worst: float

    @classmethod
    def of(cls, xs: Sequence[float]) -> Optional["Distribution"]:
        xs = [x for x in xs if x is not None and not math.isnan(x)]
        if not xs:
            return None
        s = sorted(xs)
        mid = len(s) // 2
        med = s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2
        return cls(
            n=len(xs), mean=mean(xs), median=med,
            std=stdev(xs) if len(xs) > 1 else 0.0,
            best=max(xs), worst=min(xs),
        )


# ------------------------------------------------------------------ expectancy

@dataclass
class Expectancy:
    """Espérance de gain, exprimée en R. La seule métrique qui décide."""
    n: int
    expectancy_r: float
    win_rate: float
    avg_win_r: float
    avg_loss_r: float
    payoff: float          # gain moyen / perte moyenne
    profit_factor: float
    total_r: float

    @classmethod
    def of(cls, r_multiples: Sequence[float]) -> Optional["Expectancy"]:
        rs = [r for r in r_multiples if r is not None and not math.isnan(r)]
        if not rs:
            return None
        wins = [r for r in rs if r > 0]
        losses = [r for r in rs if r <= 0]
        avg_w = mean(wins) if wins else 0.0
        avg_l = mean(losses) if losses else 0.0
        gross_w = sum(wins)
        gross_l = abs(sum(losses))
        return cls(
            n=len(rs),
            expectancy_r=mean(rs),
            win_rate=len(wins) / len(rs),
            avg_win_r=avg_w,
            avg_loss_r=avg_l,
            payoff=(avg_w / abs(avg_l)) if avg_l else float("inf"),
            profit_factor=(gross_w / gross_l) if gross_l else float("inf"),
            total_r=sum(rs),
        )


def r_multiples(ideas: Sequence[Idea],
                only_reliable: bool = True) -> list[float]:
    """
    Les R des idées exécutées.

    only_reliable=True exclut les R reconstitués après coup (backfilled). Une
    donnée pré-engagée et une donnée reconstruite de mémoire n'ont pas le même
    poids probatoire, et on ne les mélange pas en silence.
    """
    out = []
    for i in ideas:
        if not i.is_executed:
            continue
        if only_reliable and i.risk_source != RiskSource.COMPUTED:
            continue
        r = i.r_multiple()
        if r is not None:
            out.append(float(r))
    return out


# -------------------------------------------- justesse (le marché a-t-il tranché)

@dataclass
class CorrectnessRate:
    """
    Taux de JUSTESSE : la part des paris où le marché t'a donné raison,
    indépendamment du P&L.

    Un taux de réussite au P&L et un taux de justesse ne mesurent pas la même
    chose : une thèse correcte mal exécutée reste correcte, une thèse fausse qui
    a payé reste fausse. Les mélanger, c'est confondre « j'avais raison » et
    « j'ai gagné » — la distinction que tout l'outil sert à protéger.
    """
    n: int              # nombre d'unités dont le marché a tranché le sort
    n_correct: int
    rate: float         # 0..1

    @classmethod
    def of(cls, verdicts: Sequence[Optional[bool]]) -> Optional["CorrectnessRate"]:
        tranches = [v for v in verdicts if v is not None]
        if not tranches:
            return None
        n_ok = sum(1 for v in tranches if v)
        return cls(n=len(tranches), n_correct=n_ok, rate=n_ok / len(tranches))


def ideas_correct_rate(ideas: Sequence[Idea]) -> Optional[CorrectnessRate]:
    """
    Parmi les idées EXÉCUTÉES et relues dont le marché a tranché la thèse, la
    part où il t'a donné raison. C'est ton taux de justesse d'analyse, séparé de
    ton P&L : il dit si tu LIS bien le marché, pas si tu as bien tradé.
    """
    return CorrectnessRate.of([
        i.review.thesis_outcome == ThesisOutcome.CORRECT
        for i in ideas
        if i.is_executed and i.review is not None
        and i.review.thesis_outcome != ThesisOutcome.UNTESTED
    ])


@dataclass
class OutcomeBreakdown:
    """
    Ventilation des idées exécutées et relues selon le verdict du marché :
    correcte / fausse / non testée (sortie avant que le marché tranche).
    """
    correct: int
    wrong: int
    untested: int

    @property
    def judged(self) -> int:
        """Celles que le marché a réellement tranchées (correcte + fausse)."""
        return self.correct + self.wrong

    @property
    def correct_rate(self) -> Optional[float]:
        return self.correct / self.judged if self.judged else None


def outcome_breakdown(ideas: Sequence[Idea]) -> OutcomeBreakdown:
    """Combien d'idées exécutées et relues sont correctes / fausses / non testées ?"""
    b = OutcomeBreakdown(0, 0, 0)
    for i in ideas:
        if not i.is_executed or i.review is None:
            continue
        o = i.review.thesis_outcome
        if o == ThesisOutcome.CORRECT:
            b.correct += 1
        elif o == ThesisOutcome.WRONG:
            b.wrong += 1
        else:
            b.untested += 1
    return b


# ------------------------------------------------------------- courbe d'equity

@dataclass
class EquityPoint:
    d: date
    balance: float


def equity_curve(deals: Sequence[Deal]) -> list[EquityPoint]:
    """
    Solde de FIN DE JOURNÉE. Sert aux rendements, donc à Sharpe et Sortino.

    Les jours sans trade ne sont pas interpolés : ils n'existent pas. Forcer un
    rendement de 0 % ces jours-là écraserait la volatilité, et gonflerait donc
    mécaniquement le Sharpe.

    /!\\ NE SERT PAS AU DRAWDOWN. Voir deal_curve() ci-dessous.
    """
    by_day: dict[date, float] = {}
    for d in sorted(deals, key=lambda x: x.time):
        by_day[d.time.date()] = float(d.balance)
    return [EquityPoint(d=k, balance=v) for k, v in sorted(by_day.items())]


def deal_curve(deals: Sequence[Deal]) -> list[EquityPoint]:
    """
    Solde après CHAQUE transaction. C'est LA courbe du drawdown.

    Pourquoi pas la courbe journalière : sur le compte de référence, le solde
    est descendu à 99 014.06 à 09h59 avant de remonter à 99 411.26 à 10h51. En
    clôture de journée, ce creux est invisible.

        DD vu en fin de journée      : 0.59 %
        DD réellement touché          : 0.99 %   <- ce que voit MT5
                                                 <- ce que voit ta prop firm

    Une prop firm contrôle le drawdown en continu, pas à la clôture. Un outil
    qui affiche 0.59 % pendant que la firme en voit 0.99 % te ferait sauter un
    challenge en te croyant à l'abri. Le drawdown se calcule ici.
    """
    return [EquityPoint(d=d.time.date(), balance=float(d.balance))
            for d in sorted(deals, key=lambda x: x.time)]


def daily_returns(curve: Sequence[EquityPoint]) -> list[float]:
    out = []
    for prev, cur in zip(curve, curve[1:]):
        if prev.balance:
            out.append(cur.balance / prev.balance - 1.0)
    return out


# --------------------------------------------------------------------- ratios

@dataclass
class RatioResult:
    value: float
    n: int
    ci_low: Optional[float] = None
    ci_high: Optional[float] = None

    @property
    def is_meaningful(self) -> bool:
        """En dessous de ~30 observations, le chiffre ne dit rien."""
        return self.n >= 30

    def __str__(self):
        s = f"{self.value:.2f}"
        if self.ci_low is not None:
            s += f"  [{self.ci_low:.2f} ; {self.ci_high:.2f}]"
        if not self.is_meaningful:
            s += f"  (n={self.n} — non significatif)"
        return s


def sharpe(returns: Sequence[float], rf_annual: float = 0.0,
           periods: int = TRADING_DAYS) -> Optional[RatioResult]:
    """
    Sharpe annualisé sur rendements journaliers.

    Ce n'est PAS le « Sharpe » que sortent la plupart des journaux de trading,
    qui le calculent sur la série des P&L par trade — un chiffre qui n'est
    comparable à rien. Ici : equity -> rendements journaliers -> annualisation.
    C'est celui que tu pourras présenter dans dix ans.

    L'intervalle de confiance suit Lo (2002) :  SE(SR) ≈ √((1 + SR²/2) / n)
    """
    rs = [r for r in returns if not math.isnan(r)]
    n = len(rs)
    if n < 2:
        return None
    sd = stdev(rs)
    if sd == 0:
        return None

    rf_daily = rf_annual / periods
    sr_daily = (mean(rs) - rf_daily) / sd
    sr = sr_daily * math.sqrt(periods)

    se_daily = math.sqrt((1 + 0.5 * sr_daily ** 2) / n)
    se = se_daily * math.sqrt(periods)
    return RatioResult(value=sr, n=n, ci_low=sr - 1.96 * se, ci_high=sr + 1.96 * se)


def sortino(returns: Sequence[float], mar_annual: float = 0.0,
            periods: int = TRADING_DAYS) -> Optional[RatioResult]:
    """
    Sortino : même numérateur que Sharpe, mais le dénominateur ne pénalise que
    la volatilité BAISSIÈRE (downside deviation sous le MAR).

    Le downside deviation se divise par n TOTAL (définition Sortino/Satchell),
    et non par le seul nombre de jours négatifs. C'est l'erreur d'implémentation
    la plus répandue : elle gonfle le dénominateur et écrase donc le ratio.
    Sur la série de test : 81.83 avec la bonne formule, 47.25 avec la mauvaise.
    Quelle que soit la direction de l'erreur, deux Sortino calculés autrement ne
    sont pas comparables — d'où le fait de figer la convention ici, une fois.
    """
    rs = [r for r in returns if not math.isnan(r)]
    n = len(rs)
    if n < 2:
        return None

    mar_daily = mar_annual / periods
    downside = [min(0.0, r - mar_daily) ** 2 for r in rs]
    dd = math.sqrt(sum(downside) / n)
    if dd == 0:
        return None

    sr = ((mean(rs) - mar_daily) / dd) * math.sqrt(periods)
    return RatioResult(value=sr, n=n)


# ---------------------------------------------------------------- drawdown

@dataclass
class DrawdownStats:
    max_dd_pct: float
    max_dd_abs: float
    avg_dd_pct: float          # moyenne SUR LES PÉRIODES EN DD, pas sur tout
    current_dd_pct: float
    longest_days: int
    series: list[tuple[date, float]]


def drawdown(curve: Sequence[EquityPoint]) -> Optional[DrawdownStats]:
    """
    DD = (solde − plus haut historique) / plus haut historique.

    À alimenter avec deal_curve(), PAS avec equity_curve() : le drawdown se
    mesure sur chaque transaction, comme le fait ta prop firm.

    Le DD moyen se calcule sur les seules périodes en drawdown. Le moyenner sur
    toute la série (y compris les jours au plus haut, où le DD vaut 0) donnerait
    un chiffre qui ne veut rien dire et qui flatte.
    """
    if not curve:
        return None

    peak = curve[0].balance
    series: list[tuple[date, float]] = []
    max_dd = 0.0
    max_dd_abs = 0.0
    in_dd = 0
    longest = 0

    for pt in curve:
        peak = max(peak, pt.balance)
        dd = (pt.balance - peak) / peak if peak else 0.0
        series.append((pt.d, dd))
        max_dd = min(max_dd, dd)
        max_dd_abs = max(max_dd_abs, peak - pt.balance)
        if dd < 0:
            in_dd += 1
            longest = max(longest, in_dd)
        else:
            in_dd = 0

    negatives = [d for _, d in series if d < 0]
    return DrawdownStats(
        max_dd_pct=abs(max_dd) * 100,
        max_dd_abs=max_dd_abs,
        avg_dd_pct=abs(mean(negatives)) * 100 if negatives else 0.0,
        current_dd_pct=abs(series[-1][1]) * 100,
        longest_days=longest,
        series=series,
    )


# ------------------------------------------- LA matrice thèse × exécution

@dataclass
class Cell:
    label: str
    n: int
    expectancy_r: float
    total_r: float


@dataclass
class Matrix:
    """
                        Exécution propre (5/5)   Exécution dégradée (≤3/5)
    Thèse correcte      ton vrai edge            ce que tu laisses sur la table
    Thèse fausse        coût normal du business  zone rouge
    """
    clean_correct: Cell
    dirty_correct: Cell
    clean_wrong: Cell
    dirty_wrong: Cell
    cost_of_indiscipline: Optional[float]  # en R, sur les thèses correctes

    @property
    def cells(self) -> list[Cell]:
        return [self.clean_correct, self.dirty_correct,
                self.clean_wrong, self.dirty_wrong]


def thesis_execution_matrix(ideas: Sequence[Idea],
                            clean_threshold: int = 5,
                            dirty_threshold: int = 3) -> Optional[Matrix]:
    """
    Croise la justesse de l'analyse avec la qualité de l'exécution.

    C'est la métrique qui répond à la seule question qui vaille : est-ce que ce
    qui me coûte de l'argent, c'est mon analyse, ou c'est moi ?
    """
    buckets: dict[tuple[bool, bool], list[float]] = {
        (True, True): [], (False, True): [],
        (True, False): [], (False, False): [],
    }

    for i in ideas:
        if not i.is_executed or i.review is None:
            continue
        if i.review.thesis_outcome == ThesisOutcome.UNTESTED:
            continue
        r = i.r_multiple()
        if r is None:
            continue
        clean = i.review.discipline_score >= clean_threshold
        dirty = i.review.discipline_score <= dirty_threshold
        if not (clean or dirty):
            continue  # score 4 : zone grise, on ne force pas
        correct = i.review.thesis_outcome == ThesisOutcome.CORRECT
        buckets[(clean, correct)].append(float(r))

    if not any(buckets.values()):
        return None

    def cell(key, label) -> Cell:
        xs = buckets[key]
        return Cell(label=label, n=len(xs),
                    expectancy_r=mean(xs) if xs else 0.0,
                    total_r=sum(xs))

    cc = cell((True, True), "Thèse correcte · exécution propre")
    dc = cell((False, True), "Thèse correcte · exécution dégradée")
    cw = cell((True, False), "Thèse fausse · exécution propre")
    dw = cell((False, False), "Thèse fausse · exécution dégradée")

    cost = None
    if cc.n and dc.n:
        cost = cc.expectancy_r - dc.expectancy_r   # R perdus par indiscipline

    return Matrix(cc, dc, cw, dw, cost)


# ------------------------------------------------------ L'UNITÉ D'ANALYSE

class Unit(str, Enum):
    """
    Sur QUOI compte-t-on un résultat ?

    THESIS (défaut) — une thèse macro compte pour UNE décision, pas pour trois.
        Si tu joues « dollar fort » en short EURUSD, long USDJPY et short XAUUSD,
        tu as pris UNE décision. La compter trois fois triple mécaniquement ton
        échantillon, et fait passer pour trois confirmations ce qui n'est qu'un
        seul pari. Les idées rattachées à une thèse ne comptent donc PAS
        séparément : seul l'agrégat de la thèse entre dans les statistiques.

    IDEA — chaque idée compte pour elle-même, thèse ou pas. Utile pour juger
        l'exécution instrument par instrument, trompeur pour juger l'edge.

    Une idée SANS thèse compte pour elle-même dans les deux modes : sinon la
    somme des unités ne ferait pas le total du compte.
    """
    THESIS = "these"
    IDEA = "idee"


@dataclass
class AnalysisRow:
    """Une unité d'analyse : une thèse agrégée, ou une idée seule."""
    label: str
    is_campaign: bool
    r: Optional[float]
    pnl: float
    closed_at: Optional[date]
    n_ideas: int = 1
    reviewed: bool = False
    good_process: Optional[bool] = None
    campaign_id: Optional[str] = None
    idea_id: Optional[str] = None

    @property
    def won(self) -> bool:
        return self.pnl > 0


def analysis_rows(ideas: Sequence[Idea], campaigns: dict = None,
                  unit: Unit = Unit.THESIS, spec_book=None) -> list[AnalysisRow]:
    """
    Découpe l'historique en unités d'analyse, selon le mode choisi.

    C'est LE point d'entrée des statistiques : espérance, réussite, profit
    factor, matrice et calendrier partent tous d'ici, donc changer de mode
    change tout d'un bloc et sans incohérence entre deux écrans.
    """
    campaigns = campaigns or {}
    executees = [i for i in ideas if i.is_executed]
    lignes: list[AnalysisRow] = []
    vues: set = set()

    if unit == Unit.THESIS:
        for cid, camp in campaigns.items():
            if getattr(camp, "abandoned", False):
                continue
            membres = [i for i in executees if i.campaign_id == cid]
            if not membres:
                continue
            vues.update(id(i) for i in membres)
            rs = [i.r_multiple(spec_book) for i in membres]
            relues = [i for i in membres if i.review is not None]
            lignes.append(AnalysisRow(
                label=camp.display_name,
                is_campaign=True,
                # R d'une thèse = SOMME des R de ses idées (convention figée) ;
                # None dès qu'une seule jambe n'est pas calculable, parce qu'une
                # somme partielle serait pire qu'une absence.
                r=float(sum(rs)) if rs and all(r is not None for r in rs) else None,
                pnl=float(sum((i.pnl_net for i in membres), Decimal(0))),
                closed_at=max((i.closed_at.date() for i in membres if i.closed_at),
                              default=None),
                n_ideas=len(membres),
                reviewed=bool(relues) and len(relues) == len(membres),
                good_process=(all(i.review.discipline_score >= GOOD_PROCESS_MIN
                                  for i in relues) if relues and
                              len(relues) == len(membres) else None),
                campaign_id=cid,
            ))

    for i in executees:
        if id(i) in vues:
            continue
        r = i.r_multiple(spec_book)
        lignes.append(AnalysisRow(
            label=i.display_name,
            is_campaign=False,
            r=float(r) if r is not None else None,
            pnl=float(i.pnl_net),
            closed_at=i.closed_at.date() if i.closed_at else None,
            reviewed=i.review is not None,
            good_process=(i.review.discipline_score >= GOOD_PROCESS_MIN
                          if i.review else None),
            idea_id=i.id,
        ))

    return sorted(lignes, key=lambda l: l.closed_at or date.min)


def expectancy_of(rows: Sequence[AnalysisRow],
                  only_reliable: bool = False) -> Optional[Expectancy]:
    """L'espérance des unités d'analyse, en R."""
    return Expectancy.of([l.r for l in rows if l.r is not None])


def pct_results(rows: Sequence[AnalysisRow], equity_ref) -> list[float]:
    """
    Les résultats en POURCENTAGE du compte, pour quand le R ne suffit pas.

    Le R mesure l'edge en neutralisant la taille ; le pourcentage mesure ce que
    ça a fait au compte. Les deux sont vrais, ils ne répondent pas à la même
    question — d'où le choix laissé à l'écran plutôt qu'un arbitrage caché.
    """
    base = float(equity_ref) or 1.0
    return [l.pnl / base * 100 for l in rows]


# ------------------------------------------------------- courbe sans le broker

def daily_returns_from_rows(rows: Sequence[AnalysisRow],
                            start_balance) -> list[float]:
    """
    Rendements journaliers reconstitués depuis les CLÔTURES, quand le broker n'a
    pas fourni ses soldes.

    Moins précis que la vraie courbe (aveugle aux creux intrajournaliers), mais
    suffisant pour un Sharpe — qui se lit de toute façon en ordre de grandeur.
    L'écran dit toujours d'où vient le chiffre.
    """
    par_jour: dict[date, float] = {}
    for l in rows:
        if l.closed_at is None:
            continue
        par_jour[l.closed_at] = par_jour.get(l.closed_at, 0.0) + l.pnl

    solde = float(start_balance) or 1.0
    out = []
    for jour in sorted(par_jour):
        gain = par_jour[jour]
        if solde:
            out.append(gain / solde)
        solde += gain
    return out


def daily_pnl(rows: Sequence[AnalysisRow]) -> dict:
    """P&L par jour de clôture de l'UNITÉ D'ANALYSE. Sert aux agrégats."""
    par_jour: dict[date, float] = {}
    for l in rows:
        if l.closed_at is None:
            continue
        par_jour[l.closed_at] = par_jour.get(l.closed_at, 0.0) + l.pnl
    return par_jour


def daily_pnl_realise(ideas: Sequence[Idea], deals: Sequence[Deal] = ()) -> dict:
    """
    Le P&L RÉELLEMENT tombé sur le compte, jour par jour. C'est le calendrier.

    Deux sources, dans cet ordre :

    1. LES TRANSACTIONS, quand le broker les fournit. Chaque sortie — partielle
       ou finale — y figure avec sa date et son montant. Une position sortie en
       deux fois donne donc deux jours : le premier porte ce qui est sorti ce
       jour-là, le second porte le RESTE, c'est-à-dire le résultat de la
       position moins ce qui en était déjà sorti. C'est arithmétique, pas une
       estimation : les deux montants sont ceux du broker.

    2. LES TICKETS, à défaut. Chacun tombe au jour de sa clôture. Si le broker
       scinde les sorties partielles en lignes distinctes, le résultat est le
       même ; sinon, l'information n'existe pas et le calendrier ne peut pas
       l'inventer — la position entière tombe au jour de sa clôture finale.
    """
    sorties = [d for d in deals if d.entry == "out" and d.is_trading]
    if sorties:
        par_jour: dict[date, float] = {}
        for d in sorties:
            j = d.time.date()
            net = float(d.profit + d.commission + d.swap)
            par_jour[j] = par_jour.get(j, 0.0) + net
        return par_jour
    return daily_pnl_by_ticket(ideas)


def daily_pnl_by_ticket(ideas: Sequence[Idea]) -> dict:
    """
    P&L par jour, TICKET PAR TICKET. C'est la vue du calendrier.

    Pourquoi pas par idée : une idée dont tu sors en deux fois est clôturée
    partiellement un jour, et totalement un autre. Ranger la totalité de son
    résultat sur le second jour effacerait ce qui s'est passé le premier — or ce
    jour-là, de l'argent est bien tombé sur le compte, et ta prop firm l'a vu.

    Chaque ticket porte donc son résultat au jour où IL s'est refermé. Les
    métriques, elles, restent agrégées à l'idée : c'est toujours une seule
    décision, même sortie en deux fois.

    Limite honnête : si ton broker ne scinde pas les sorties partielles en
    lignes distinctes dans l'export, l'information n'existe pas et le calendrier
    ne peut pas l'inventer.
    """
    par_jour: dict[date, float] = {}
    for i in ideas:
        for p in i.positions:
            j = p.close_time.date()
            par_jour[j] = par_jour.get(j, 0.0) + float(p.pnl_net)
    return par_jour


# --------------------------------------------- LA matrice décision × résultat

@dataclass
class QuadrantCell:
    quadrant: Quadrant
    label: str
    n: int
    total_r: float
    pnl: float
    # Part du capital de référence. None quand le capital n'est pas connu —
    # jamais 0, qui se lirait comme « ça n'a rien coûté ».
    pct: Optional[float] = None


@dataclass
class DecisionMatrix:
    """
                        MAUVAIS PROCESS        BON PROCESS
        GAIN            chance ⚠               maîtrise ✓
        PERTE           erreur ✗               aléa OK

    Différente de la matrice thèse × exécution, et complémentaire :

      - thèse × exécution répond à « est-ce mon ANALYSE ou MOI ? » et a besoin
        d'un verdict sur la thèse (le marché m'a-t-il donné raison), donc d'un
        échantillon et d'une review complète ;
      - décision × résultat répond à « ce trade-là, je le rejoue ou pas ? ». Elle
        se lit sur UN trade, dès la review faite.

    Le quadrant le plus important n'est pas « erreur », c'est CHANCE : un
    mauvais process qui a payé est celui qu'on répète.
    """
    cells: dict[Quadrant, QuadrantCell]
    n_reviewed: int
    n_pending: int

    def get(self, q: Quadrant) -> QuadrantCell:
        return self.cells[q]

    @property
    def good_process_share(self) -> Optional[float]:
        """Part des trades relus où le process a tenu. 0..1."""
        if not self.n_reviewed:
            return None
        bons = self.cells[Quadrant.MASTERY].n + self.cells[Quadrant.VARIANCE].n
        return bons / self.n_reviewed


_QUADRANT_LABELS = {
    Quadrant.MASTERY: "Gain / bon process",
    Quadrant.LUCK: "Gain / mauvais process",
    Quadrant.ERROR: "Perte / mauvais process",
    Quadrant.VARIANCE: "Perte / bon process",
}


def decision_matrix(ideas: Sequence[Idea], campaigns: dict = None,
                    unit: Unit = Unit.IDEA, spec_book=None,
                    equity_ref=None) -> DecisionMatrix:
    """
    Range chaque unité clôturée ET relue dans son quadrant.

    Les unités non relues ne sont pas réparties « au mieux » : elles sont
    comptées à part. Deviner le process d'un trade non relu reviendrait à
    inventer la seule donnée que l'outil ne peut pas produire tout seul.

    En mode THÈSE, une thèse n'est classée que si TOUTES ses jambes sont
    relues : un process « à moitié jugé » n'est pas un process jugé.
    """
    rows = analysis_rows(ideas, campaigns, unit, spec_book)
    buckets: dict[Quadrant, list[AnalysisRow]] = {q: [] for q in _QUADRANT_LABELS}
    pending = 0

    for l in rows:
        if not l.reviewed or l.good_process is None:
            pending += 1
            continue
        if l.won:
            q = Quadrant.MASTERY if l.good_process else Quadrant.LUCK
        else:
            q = Quadrant.VARIANCE if l.good_process else Quadrant.ERROR
        buckets[q].append(l)

    base = float(equity_ref) if equity_ref else 0.0
    cells = {}
    for q, lst in buckets.items():
        pnl = sum(l.pnl for l in lst)
        cells[q] = QuadrantCell(
            quadrant=q, label=_QUADRANT_LABELS[q], n=len(lst),
            total_r=sum(l.r for l in lst if l.r is not None),
            pnl=pnl,
            pct=(pnl / base * 100) if base else None,
        )

    return DecisionMatrix(cells=cells,
                          n_reviewed=sum(c.n for c in cells.values()),
                          n_pending=pending)


# ---------------------------------------------------------------- calibration

@dataclass
class CalibrationPoint:
    conviction: int
    n: int
    expectancy_r: float


def conviction_calibration(ideas: Sequence[Idea]) -> list[CalibrationPoint]:
    """
    Tes trades conviction 5 surperforment-ils réellement tes conviction 2 ?

    Si la relation est plate ou inversée, ta perception de conviction est du
    bruit — information majeure, parce que tu sizes probablement dessus.
    """
    by_conv: dict[int, list[float]] = {}
    for i in ideas:
        if not i.is_executed or i.thesis is None or i.thesis.conviction is None:
            continue
        r = i.r_multiple()
        if r is None:
            continue
        by_conv.setdefault(i.thesis.conviction, []).append(float(r))

    return [CalibrationPoint(conviction=c, n=len(v), expectancy_r=mean(v))
            for c, v in sorted(by_conv.items())]


# --------------------------------------------------------- plan vs hors-plan

@dataclass
class PlanComparison:
    planned: Optional[Expectancy]
    off_plan: Optional[Expectancy]
    off_plan_ratio: float


def plan_vs_offplan(ideas: Sequence[Idea]) -> PlanComparison:
    """
    Le chiffre le plus dur que produira cet outil.

    Il tombe gratuitement de l'architecture : puisque la thèse précède l'import,
    une position sans thèse est, par construction, un trade que tu n'avais pas
    prévu.
    """
    executed = [i for i in ideas if i.is_executed]
    # Seul compte le fait qu'une idée ait été ÉCRITE ou non. Le moment où on l'a
    # saisie (le matin avant d'entrer, ou le soir en journalisant) ne change pas
    # le fait qu'elle existe : ranger les journalisations différées avec les
    # trades improvisés vidait la comparaison de son sens.
    planned = [i for i in executed if not i.off_plan]
    offplan = [i for i in executed if i.off_plan]
    return PlanComparison(
        planned=Expectancy.of(r_multiples(planned, only_reliable=False)),
        off_plan=Expectancy.of(r_multiples(offplan, only_reliable=False)),
        off_plan_ratio=len(offplan) / len(executed) if executed else 0.0,
    )


# ------------------------------------------------------ qualité du pyramidage

@dataclass
class AddsAnalysis:
    n_ideas_with_adds: int
    pnl_initial: float      # P&L des tickets initiaux seuls
    pnl_adds: float         # P&L des renforcements seuls
    verdict: str


def adds_analysis(ideas: Sequence[Idea]) -> Optional[AddsAnalysis]:
    """
    Tes renforcements te rapportent-ils, ou te coûtent-ils ?

    Question posable uniquement parce qu'on a séparé Idée et Ticket. Sur une
    seule idée, le calcul est anecdotique ; sur cinquante, il tranche.
    """
    with_adds = [i for i in ideas if i.is_executed and i.adds]
    if not with_adds:
        return None

    pnl_init = float(sum(i.pnl_initial for i in with_adds))
    pnl_adds = float(sum(i.pnl_adds for i in with_adds))

    if pnl_adds > 0:
        verdict = "Tes renforcements ajoutent de la performance."
    elif pnl_init > 0 > pnl_init + pnl_adds:
        verdict = ("Tes renforcements transforment des idées gagnantes en "
                   "idées perdantes. C'est le signal le plus coûteux du tableau.")
    else:
        verdict = "Tes renforcements dégradent la performance."

    return AddsAnalysis(len(with_adds), pnl_init, pnl_adds, verdict)


# ------------------------------------------------------------------ conformité

def size_conformity_stats(ideas: Sequence[Idea],
                          equity_ref: Decimal) -> Optional[Distribution]:
    """
    Risque réellement engagé / risque annoncé dans la thèse.
    1.0 = conforme. Mesuré, jamais auto-déclaré.
    """
    xs = []
    for i in ideas:
        if not i.is_executed:
            continue
        c = i.size_conformity(equity_ref)
        if c is not None:
            xs.append(float(c))
    return Distribution.of(xs)
