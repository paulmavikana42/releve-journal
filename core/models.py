"""
Modèles du domaine.

Règles non négociables :
  - Decimal partout où il y a de l'argent ou un prix. Jamais de float.
  - Position et Deal viennent de MT5 : ils sont IMMUABLES. Aucune méthode ne les modifie.
  - Thesis et Review viennent de toi : ils sont horodatés et versionnés.
  - Idea est le conteneur : 1 thèse -> N positions MT5.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Optional
import uuid

from . import clock as _clock


# ---------------------------------------------------------------- énumérations

class IdeaStatus(str, Enum):
    DRAFT = "brouillon"       # thèse en cours d'écriture
    ARMED = "armee"           # thèse figée, en attente d'exécution
    RUNNING = "en_cours"      # au moins un ticket ouvert
    CLOSED = "cloturee"       # tous les tickets fermés, review à faire
    REVIEWED = "revue"        # review faite
    ABANDONED = "abandonnee"  # jamais exécutée


class Direction(str, Enum):
    BUY = "buy"
    SELL = "sell"


class RiskSource(str, Enum):
    """Traçabilité : d'où vient le stop qui sert de dénominateur au R."""
    COMPUTED = "computed"      # stop saisi AVANT le trade -> R fiable
    BACKFILLED = "backfilled"  # stop reconstitué APRÈS coup -> R indicatif
    UNKNOWN = "unknown"        # pas de stop -> R non calculable


class StopEvidence(str, Enum):
    """
    La preuve derrière un stop saisi à la main.

    Le bon axe n'est PAS « automatique vs manuel ». C'est « pré-engagé vs
    reconstitué ».

    Un stop transcrit depuis une CAPTURE prise au moment du trade est une donnée
    pré-engagée : l'image l'horodate. Elle vaut un champ MT5 — elle entre juste
    par une autre porte. La traiter comme suspecte était une erreur.

    Un stop retrouvé DE MÉMOIRE trois semaines plus tard reste une reconstitution,
    et l'outil ne peut pas faire semblant du contraire sans perdre sa raison d'être.
    """
    CAPTURE = "capture"      # ta capture d'écran du ticket -> pré-engagé, fiable
    MEMORY = "memoire"       # retrouvé après coup -> indicatif


class StopProvenance(str, Enum):
    """
    D'où vient le stop d'un ticket, et peut-on lui faire confiance ?

    MT5 n'archive que le DERNIER stop. Mais en croisant la table Ordres (SL au
    moment du placement) avec la table Positions (SL final), on peut PROUVER
    qu'un stop n'a jamais bougé : s'ils sont identiques, le stop final EST le
    stop d'origine.
    """
    PROVEN = "prouve"        # SL placement == SL final -> jamais déplacé, FIABLE
    MOVED = "deplace"        # SL final != SL placement -> l'original est le SL du placement
    UNVERIFIED = "non_verifie"   # ordre au marché sans SL -> plausible, mais non prouvé
    SUSPECT_BE = "suspect_breakeven"  # stop collé à l'entrée -> c'est un breakeven, pas un stop
    DECLARED = "declare"     # vient de ta thèse -> la meilleure source
    NONE = "aucun"


# Un stop à moins de 0.15 % du prix d'entrée n'est pas un stop de départ :
# c'est un breakeven. Sur BTCUSD à 63 791, ça fait 96 points ; ton stop archivé
# était à 9 points. Les vrais stops de ton fichier sont à 0.8 %–1.2 %.
BREAKEVEN_TOLERANCE = Decimal("0.0015")


class RiskBasis(str, Enum):
    """
    À quoi rapporter le R d'une idée pyramidée ? Ce n'est pas une question
    technique, c'est une question de méthode. Les trois réponses sont légitimes.
    """
    SUM = "somme"                  # somme des risques de tous les tickets
    INITIAL_ONLY = "ticket_initial"  # seul le noyau porte le risque
    MAX_CONCURRENT = "max_simultane"  # le pire moment d'exposition


class MissedOutcome(str, Enum):
    """
    Verdict sur une idée armée puis abandonnée.

    La distinction qui compte n'est pas « ai-je eu raison » mais « ai-je eu
    l'occasion ». Deux situations radicalement différentes :

      NO_SETUP  le prix n'a jamais atteint ma zone. Non-événement : ça ne dit
                rien sur moi.
      HESITATED le setup s'est présenté et je n'ai pas tiré. Là, c'est une
                hésitation — et croisée avec le résultat, elle dit si ma
                prudence me protège ou me coûte.

    Sans cette distinction, la statistique d'abandon mélange « pas
    d'opportunité » et « peur », et ne veut plus rien dire.
    """
    NO_SETUP = "setup_absent"
    HESITATED = "hesitation"


class ThesisOutcome(str, Enum):
    """Le marché a-t-il donné raison à l'idée ? Indépendant du P&L."""
    CORRECT = "correcte"
    WRONG = "fausse"
    UNTESTED = "non_testee"    # sorti avant que le marché tranche


class ExitReason(str, Enum):
    STOP_LOSS = "sl"
    TAKE_PROFIT = "tp"
    MANUAL = "manual"
    UNKNOWN = "unknown"


class Quadrant(str, Enum):
    """
    Décision × résultat, pour UNE idée clôturée et relue.

    C'est la lecture la plus utile d'un trade isolé, et elle ne se confond pas
    avec la matrice thèse × exécution (qui, elle, agrège) :

        MAITRISE  gain  + process respecté  -> à répliquer
        CHANCE    gain  + process dégradé   -> le plus dangereux : ça paie
        ERREUR    perte + process dégradé   -> le seul coût évitable
        ALEA_OK   perte + process respecté  -> le coût normal du métier

    PENDING tant que le trade n'est pas clôturé ET relu : sans review, le
    process n'est pas jugé, et inventer un verdict serait pire que rien.
    """
    MASTERY = "maitrise"
    LUCK = "chance"
    ERROR = "erreur"
    VARIANCE = "alea_ok"
    PENDING = "en_attente"


# Un process est « respecté » à partir de 4 critères sur 5. Le seuil 5/5 sert à
# la matrice agrégée (où l'on veut du pur) ; sur un trade isolé, exiger le
# sans-faute classerait « erreur » un trade à 4/5, ce qui est faux.
GOOD_PROCESS_MIN = 4


class CaptureKind(str, Enum):
    """À quel moment du trade la capture a-t-elle été prise ?"""
    THESIS = "these"     # le graphique au moment où tu écris l'idée
    ENTRY = "entree"     # le ticket d'ordre / l'entrée
    MANAGE = "gestion"   # un déplacement de stop, un allègement
    EXIT = "sortie"      # la sortie
    OTHER = "autre"


# ------------------------------------------------------------------ MT5 (brut)

@dataclass(frozen=True)
class Deal:
    """Une transaction élémentaire MT5. Immuable."""
    deal_id: str
    time: datetime
    symbol: str
    deal_type: str          # buy | sell | charge | balance ...
    entry: str              # in | out | in/out
    volume: Optional[Decimal]
    price: Optional[Decimal]
    order_id: str
    commission: Decimal
    fee: Decimal
    swap: Decimal
    profit: Decimal
    balance: Decimal
    comment: str = ""
    # Le compte d'où vient cette transaction. Vide = compte par défaut. Cloisonne
    # la courbe de solde MESURÉE : deux comptes ne mélangent jamais leurs soldes.
    account_id: str = ""

    @property
    def is_trading(self) -> bool:
        return self.deal_type in ("buy", "sell")

    @property
    def is_funding(self) -> bool:
        """Dépôt, retrait, credit : impacte l'equity mais n'est pas un trade."""
        return not self.is_trading


@dataclass(frozen=True)
class Position:
    """
    Un cycle ouverture -> fermeture MT5. Immuable.

    /!\\ sl_final n'est PAS le stop initial. MT5 n'archive que le dernier stop
    connu. Sur un trade passé au breakeven, sl_final ~= open_price et tout R
    calculé dessus est faux. Le stop initial vient de la Thesis, jamais d'ici.
    """
    position_id: str
    account_id: str
    symbol: str
    direction: Direction
    volume: Decimal
    open_time: datetime
    open_price: Decimal
    close_time: datetime
    close_price: Decimal
    commission: Decimal
    swap: Decimal
    profit_gross: Decimal
    sl_final: Optional[Decimal] = None
    tp_final: Optional[Decimal] = None
    sl_at_placement: Optional[Decimal] = None   # depuis la table ORDRES
    exit_reason: ExitReason = ExitReason.UNKNOWN

    @property
    def uid(self) -> str:
        """Clé globale : un position_id peut se répéter d'un compte à l'autre."""
        return f"{self.account_id}:{self.position_id}"

    @property
    def pnl_net(self) -> Decimal:
        """Profit MT5 est BRUT. Le net inclut commission et swap."""
        return self.profit_gross + self.commission + self.swap

    @property
    def sign(self) -> int:
        return 1 if self.direction == Direction.BUY else -1

    @property
    def price_move(self) -> Decimal:
        """Déplacement du prix en ta faveur (négatif si contre toi)."""
        return (self.close_price - self.open_price) * self.sign

    @property
    def duration_hours(self) -> float:
        return (self.close_time - self.open_time).total_seconds() / 3600

    @property
    def stop_provenance(self) -> "StopProvenance":
        if self.sl_final is None:
            return StopProvenance.NONE
        if self.sl_at_placement is not None:
            if self.sl_at_placement == self.sl_final:
                return StopProvenance.PROVEN   # jamais déplacé : le SL final EST l'original
            return StopProvenance.MOVED        # l'original est celui du placement

        # Ordre au marché sans SL : le SL final est tout ce qu'on a. Mais s'il est
        # collé à l'entrée, ce n'est pas un stop — c'est un breakeven, et le risque
        # d'origine est irrécupérable. Mieux vaut REFUSER de calculer que mentir.
        if self.open_price and abs(self.sl_final - self.open_price) / self.open_price \
                < BREAKEVEN_TOLERANCE:
            return StopProvenance.SUSPECT_BE
        return StopProvenance.UNVERIFIED

    @property
    def stop_original(self) -> Optional[Decimal]:
        """
        Le stop d'ORIGINE de ce ticket, quand on peut le connaître.

        PROVEN      -> le SL final, car il n'a jamais bougé
        MOVED       -> le SL du placement, qui est bien l'original
        UNVERIFIED  -> le SL final, faute de mieux
        SUSPECT_BE  -> RIEN. Un breakeven n'est pas un stop de départ ; renvoyer
                       9 points de risque donnerait un R absurde (+63 R mesuré
                       sur un cas réel). On refuse de calculer, et on exige que
                       le stop vienne de ta thèse.
        """
        pr = self.stop_provenance
        if pr == StopProvenance.MOVED:
            return self.sl_at_placement
        if pr in (StopProvenance.PROVEN, StopProvenance.UNVERIFIED):
            return self.sl_final
        return None

    def risk(self, spec_book=None, stop_override: Optional[Decimal] = None
             ) -> Optional[Decimal]:
        """Risque de CE ticket : volume × distance au stop × valeur du point."""
        stop = stop_override if stop_override is not None else self.stop_original
        if stop is None:
            return None
        pv = spec_book.point_value(self) if spec_book else self.point_value
        if pv is None:
            return None
        r = self.volume * abs(self.open_price - stop) * pv
        return r if r > 0 else None

    @property
    def point_value(self) -> Optional[Decimal]:
        """
        Valeur d'un point de prix pour 1 lot, DÉDUITE de la position elle-même.

        pv = profit_brut / (volume * déplacement_prix)

        Aucune table de specs à maintenir : le chiffre se rétro-calcule sur
        chaque trade clôturé. Gère nativement les paires JPY, dont la valeur du
        point dépend du taux de change au moment du trade.
        """
        denom = self.volume * self.price_move
        if denom == 0 or self.profit_gross == 0:
            return None
        return self.profit_gross / denom


# ------------------------------------------------------- le trade encore ouvert

@dataclass(frozen=True)
class OpenTrade:
    """
    Un trade OUVERT, déclaré à la main au moment où tu entres.

    Pourquoi cet objet existe alors que Position suffisait :

    Un rapport de broker ne contient que des trades CLÔTURÉS. Tant que la
    position vit, elle n'existe nulle part dans l'outil — donc l'idée reste
    « armée », le journal ne montre rien, et la thèse n'est reliée à aucune
    exécution. En swing, ça dure des jours.

    En déclarant l'ouverture (30 secondes, sur mobile), trois choses deviennent
    vraies :
      1. le trade VIT dans l'outil à l'état « en cours » ;
      2. le stop réellement placé est enregistré AVANT le résultat — c'est la
         donnée que le broker écrasera au premier breakeven ;
      3. le NUMÉRO DE TICKET est connu, et c'est lui qui permettra à l'import
         de clôturer ce trade précis, sans ambiguïté et sans doublon.

    Immuable : toute correction passe par un nouvel événement.
    """
    ticket: str                       # LE numéro du broker : la clé de rapprochement
    symbol: str
    direction: Direction
    volume: Decimal
    open_time: datetime
    open_price: Decimal
    account_id: str = ""
    stop: Optional[Decimal] = None    # le stop RÉELLEMENT placé, pas celui rêvé
    take_profit: Optional[Decimal] = None
    last_price: Optional[Decimal] = None   # cours saisi à la main, pour le flottant
    last_price_at: Optional[datetime] = None
    note: str = ""

    @property
    def uid(self) -> str:
        """Même convention que Position : un ticket peut se répéter d'un compte à l'autre."""
        return f"{self.account_id}:{self.ticket}"

    @property
    def sign(self) -> int:
        return 1 if self.direction == Direction.BUY else -1

    def risk(self, point_value: Optional[Decimal] = None) -> Optional[Decimal]:
        """Risque engagé sur ce ticket, si le stop est connu."""
        if self.stop is None or point_value is None:
            return None
        r = self.volume * abs(self.open_price - self.stop) * point_value
        return r if r > 0 else None

    def floating_pnl(self, point_value: Optional[Decimal] = None) -> Optional[Decimal]:
        """
        Le flottant, à partir d'un cours SAISI À LA MAIN.

        L'outil n'a aucun flux de prix : ce chiffre vaut ce que vaut ta saisie,
        et il porte toujours son horodatage à l'écran. Sans cours saisi, on
        n'affiche rien plutôt qu'un zéro trompeur.
        """
        if self.last_price is None or point_value is None:
            return None
        return (self.last_price - self.open_price) * self.sign * self.volume * point_value


@dataclass(frozen=True)
class Attachment:
    """
    Une capture jointe à une idée ou à une thèse macro.

    Ce n'est pas de la décoration. Une capture prise AU MOMENT de l'entrée est
    une donnée PRÉ-ENGAGÉE : l'image horodate ce que tu voyais et ce que tu avais
    posé (stop compris). C'est exactement le raisonnement de StopEvidence.CAPTURE
    — l'image entre par une autre porte qu'un champ du broker, mais elle vaut
    autant.

    Le fichier vit dans data/captures/. Le journal ne stocke que le chemin :
    une image en base64 dans un JSONL rendrait le fichier illisible à la main,
    et c'est ce fichier qui doit survivre dix ans.
    """
    id: str
    owner_type: str                   # "idea" | "campaign"
    owner_id: str
    path: str                         # relatif à data/ : "captures/<owner>/<id>.png"
    original_name: str = ""
    kind: CaptureKind = CaptureKind.OTHER
    caption: str = ""
    added_at: Optional[datetime] = None
    removed: bool = False             # marquée, jamais effacée (journal append-only)


# ---------------------------------------------------------------- toi (annoté)

@dataclass
class Thesis:
    """Écrite AVANT d'entrer. C'est une prédiction falsifiable."""
    instrument: str
    direction: Direction

    # fonda
    macro_theme: str = ""          # catégoriel, agrégeable
    catalyst: str = ""             # l'événement attendu
    macro_note: str = ""           # texte libre (reflet à plat des blocs)

    # Le corps de l'idée en BLOCS ordonnés (même éditeur que la thèse macro,
    # texte/image façon Notion). `macro_note` reste renseigné (concat des blocs
    # texte) pour la recherche et la rétrocompatibilité : une ancienne idée sans
    # `blocks` se lit via macro_note/technical_note + captures. Le journal ne
    # stocke que le CHEMIN de l'image — archi [P].
    blocks: list = field(default_factory=list)

    # technique
    setup: str = ""                # catégoriel
    timeframe: str = ""
    technical_note: str = ""

    # risque — le seul champ vraiment obligatoire
    entry_planned: Optional[Decimal] = None
    stop_initial: Optional[Decimal] = None     # LE champ qui rend le R possible
    targets: list[Decimal] = field(default_factory=list)
    risk_pct: Optional[Decimal] = None         # contrôle croisé, pas le calcul

    # invalidation
    thesis_kill_switch: str = ""   # ce qui tue l'IDÉE, même si le prix ne touche pas le stop

    conviction: Optional[int] = None           # 1..5, pour la calibration
    risk_source: RiskSource = RiskSource.COMPUTED

    def risk_per_lot(self) -> Optional[Decimal]:
        """Distance entrée -> stop, en points de prix. Toujours positive."""
        if self.stop_initial is None or self.entry_planned is None:
            return None
        return abs(self.entry_planned - self.stop_initial)


@dataclass
class Review:
    """Écrite APRÈS. Le juge."""
    # discipline : 5 critères objectifs, pas un booléen auto-complaisant
    entry_in_zone: bool = False
    size_conforme: bool = False
    stop_at_invalidation: bool = False
    stop_never_widened: bool = False
    exit_per_plan: bool = False

    thesis_outcome: ThesisOutcome = ThesisOutcome.UNTESTED
    emotional_state: str = ""
    lesson: str = ""
    tags: list[str] = field(default_factory=list)

    @property
    def discipline_score(self) -> int:
        return sum([
            self.entry_in_zone,
            self.size_conforme,
            self.stop_at_invalidation,
            self.stop_never_widened,
            self.exit_per_plan,
        ])

    @property
    def is_clean(self) -> bool:
        return self.discipline_score == 5


# ---------------------------------------------------------------- le conteneur

@dataclass
class MissedReview:
    """
    Review d'une idée abandonnée.

    Aucun P&L ne viendra te contredire ici : c'est la donnée la plus
    autodéclarative de l'outil, donc la plus fragile. Elle vaut quand même,
    parce qu'aucun journal ne la collecte — et qu'elle répond à une question
    que personne ne se pose : « mes renoncements sont-ils justifiés ? »
    """
    setup_appeared: MissedOutcome = MissedOutcome.NO_SETUP
    would_have_won: Optional[bool] = None    # None = indécis / non jugeable
    reason: str = ""                         # pourquoi je n'ai pas pris
    note: str = ""


@dataclass
class Idea:
    """
    UNE décision de trading. C'est l'unité d'analyse.

    MT5 voit N tickets, toi tu as pris 1 décision. Toutes les statistiques se
    calculent ici. Les positions restent accessibles en dessous, pour une seule
    question : mes adds me rapportent-ils ou me coûtent-ils ?
    """
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    # Heure SERVEUR, sans fuseau — le même référentiel que les dates MT5.
    # Voir core/clock.py : mélanger deux référentiels rejetait silencieusement
    # des thèses valides et les classait hors-plan.
    created_at: datetime = field(default_factory=lambda: _clock.server_now())
    thesis: Optional[Thesis] = None
    review: Optional[Review] = None
    status: IdeaStatus = IdeaStatus.DRAFT
    position_uids: list[str] = field(default_factory=list)
    off_plan: bool = False        # position exécutée sans thèse préalable
    label: str = ""
    risk_basis: RiskBasis = RiskBasis.SUM

    # Rattachement OPTIONNEL à une thèse macro (Campaign). None = idée autonome,
    # comportement strictement identique à avant.
    campaign_id: Optional[str] = None

    # Thèse écrite APRÈS l'ouverture du trade (journalisation différée). L'idée
    # reste dans les statistiques, mais elle n'est PAS une prédiction pré-engagée :
    # son stop est de fait reconstitué, et elle ne doit pas gonfler tes trades
    # "planifiés". Voir risk_source et la métrique plan/hors-plan.
    late_thesis: bool = False

    # Review d'abandon : renseignée quand l'idée a été armée puis jamais exécutée.
    missed_review: Optional["MissedReview"] = None

    # Le compte sur lequel l'idée est jouée. Vide = compte par défaut. Sert à
    # cloisonner : deux challenges ne partagent ni leurs règles ni leurs stats.
    account_id: str = ""

    # Stops que tu renseignes toi-même, ticket par ticket. Nécessaires quand MT5 a
    # écrasé le stop d'origine — typiquement un renforcement passé au breakeven.
    manual_stops: dict = field(default_factory=dict)      # position_uid -> Decimal
    stop_evidence: dict = field(default_factory=dict)     # position_uid -> StopEvidence

    # Pour chaque renforcement : le noyau était-il DÉJÀ au breakeven quand tu l'as
    # ouvert ? Coché à la main au moment de l'appariement, à chaud.
    #
    # Le journal MT5 contiendrait l'horodatage exact des déplacements de stop, mais
    # il est écrit par le terminal PC. Sur mobile, il n'existe pas. Cette case est
    # donc la seule source possible — et elle suffit : le calcul n'a pas besoin de
    # l'HEURE du breakeven, seulement de savoir s'il était posé avant l'add.
    secured_on_add: dict = field(default_factory=dict)   # position_uid -> bool

    # --- résolu au chargement, pas persisté
    positions: list[Position] = field(default_factory=list, repr=False)
    open_trades: list[OpenTrade] = field(default_factory=list, repr=False)
    attachments: list[Attachment] = field(default_factory=list, repr=False)

    # ------------------------------------------------------------- agrégats MT5

    @property
    def is_executed(self) -> bool:
        return bool(self.positions)

    @property
    def is_running(self) -> bool:
        """Au moins un ticket déclaré ouvert et pas encore clôturé par un import."""
        return bool(self.open_trades)

    @property
    def captures(self) -> list[Attachment]:
        """Les captures encore attachées, dans l'ordre où elles ont été jointes."""
        return [a for a in self.attachments if not a.removed]

    @property
    def symbol(self) -> str:
        if self.positions:
            return self.positions[0].symbol
        if self.open_trades:
            return self.open_trades[0].symbol
        return self.thesis.instrument if self.thesis else "?"

    @property
    def opened_at(self) -> Optional[datetime]:
        """Première entrée réelle : tickets clôturés ET tickets encore ouverts."""
        times = [p.open_time for p in self.positions]
        times += [o.open_time for o in self.open_trades]
        return min(times, default=None)

    @property
    def closed_at(self) -> Optional[datetime]:
        return max((p.close_time for p in self.positions), default=None)

    @property
    def pnl_net(self) -> Decimal:
        return sum((p.pnl_net for p in self.positions), Decimal(0))

    @property
    def total_volume(self) -> Decimal:
        return sum((p.volume for p in self.positions), Decimal(0))

    @property
    def initial_position(self) -> Optional[Position]:
        """Le premier ticket. C'est lui qui porte le risque de l'idée."""
        if not self.positions:
            return None
        return min(self.positions, key=lambda p: p.open_time)

    def est_du_noyau(self, p: Position) -> bool:
        """
        Ce ticket fait-il partie de l'ENTRÉE INITIALE ?

        Une sortie partielle scinde la position en deux lignes qui partagent la
        même heure et le même prix d'ouverture : la moitié sortie tôt, et le
        reste. La seconde n'est pas un renforcement — c'est le même engagement,
        pris au même instant, au même prix.

        Sans cette distinction, le reste du noyau était traité comme un add :
        privé du stop de l'idée, il rendait le R de l'idée entière incalculable
        et gonflait le compte des « renforcements ».
        """
        init = self.initial_position
        if init is None:
            return False
        return p is init or (p.open_time == init.open_time
                             and p.open_price == init.open_price)

    @property
    def adds(self) -> list[Position]:
        return [p for p in self.positions if not self.est_du_noyau(p)]

    @property
    def tickets_disjoints(self) -> list[Position]:
        """
        Les tickets qui ne chevauchent AUCUN autre ticket de l'idée.

        Un renforcement s'ouvre pendant que l'idée vit. Un ticket ouvert après
        la clôture de tous les autres n'est donc pas un renforcement : c'est un
        autre trade, qui mérite sa propre idée, sa propre thèse et sa propre
        conviction.

        L'outil ne corrige pas tout seul — il ne peut pas savoir si tu as changé
        d'avis ou si tu t'es trompé de bouton. Il le SIGNALE, et propose de
        détacher. Sans ça, deux paris indépendants additionnent leurs risques :
        le R de l'idée devient faux, et il le devient en silence.
        """
        if len(self.positions) < 2:
            return []
        seuls = []
        for p in self.positions:
            # Un fragment du noyau n'est jamais suspect : c'est la même entrée.
            if self.est_du_noyau(p):
                continue
            if not any(q is not p and q.open_time <= p.open_time <= q.close_time
                       for q in self.positions):
                seuls.append(p)
        return seuls

    @property
    def pnl_initial(self) -> Decimal:
        p = self.initial_position
        return p.pnl_net if p else Decimal(0)

    @property
    def pnl_adds(self) -> Decimal:
        return sum((p.pnl_net for p in self.adds), Decimal(0))

    # ------------------------------------------------------------------ risque

    def stop_for(self, p: Position) -> tuple[Optional[Decimal], str]:
        """
        Le stop d'origine de CE ticket, et d'où il vient.

        Ordre de priorité :

          1. TON RELEVÉ          stop saisi à la main sur ce ticket précis
          2. TON IDÉE            pour le ticket INITIAL — écrit avant l'entrée
          3. LE BROKER (prouvé)  SL placement == SL final -> jamais déplacé
          4. LE BROKER (déplacé) le SL du placement, qui est bien l'original
          5. LE BROKER (non vér.) le SL final, faute de mieux
          6. TON IDÉE            le filet, pour tous les autres tickets

        Le point 2 ne bouge pas : le broker n'archive que le DERNIER stop, donc
        celui d'un trade passé au breakeven vaut 9 points et produirait un +63 R.
        Sur le ticket initial, le stop de l'idée gagne toujours.

        Le point 6 ne vaut QUE pour le ticket initial. Un ordre au marché sort
        de l'export sans SL, et sur le noyau le stop de l'idée est la bonne
        réponse : c'est celui qui a été écrit avant d'entrer.

        UN RENFORCEMENT, NON. Il peut être pris avec un stop plus serré que le
        noyau — c'est même fréquent. Lui faire hériter du stop de l'idée
        surestimerait son risque et sous-estimerait le R, en silence. Sur un
        add, l'outil préfère ne rien savoir et te le demander : une base vraie
        vaut mieux qu'une base plausible.
        """
        mine = self.manual_stops.get(p.uid)
        if mine is not None:
            return mine, "saisi"

        de_l_idee = self.thesis.stop_initial if self.thesis else None

        # Le noyau ET ses fragments (sorties partielles) prennent le stop de
        # l'idée : c'est un seul engagement, pris à un seul instant.
        if self.est_du_noyau(p):
            if de_l_idee is not None:
                return de_l_idee, "ton idée"
            propre = p.stop_original
            return ((propre, p.stop_provenance.value) if propre is not None
                    else (None, p.stop_provenance.value))

        propre = p.stop_original
        if propre is not None:
            return propre, p.stop_provenance.value

        return None, p.stop_provenance.value

    @property
    def has_reconstructed_stop(self) -> bool:
        """
        Conservé pour la relecture des anciens journaux, qui contiennent des
        événements `ticket_stop_set` portant une évidence. Ne dégrade plus rien :
        voir `risk_source`.
        """
        return any(e == StopEvidence.MEMORY for e in self.stop_evidence.values())

    def ticket_risks(self, spec_book=None) -> dict[str, Optional[Decimal]]:
        """Le risque de CHAQUE ticket, calculé depuis son propre stop."""
        out: dict[str, Optional[Decimal]] = {}
        for p in self.positions:
            stop, _ = self.stop_for(p)
            out[p.position_id] = p.risk(spec_book, stop_override=stop)
        return out

    def tickets_needing_stop(self) -> list[Position]:
        """
        Les tickets dont le stop est introuvable — et qui, sans toi, feraient
        disparaître le R de l'idée ENTIÈRE.

        Cas typique : un renforcement que tu as passé au breakeven. MT5 a écrasé
        son stop d'origine, ta thèse ne contient que celui du noyau. Personne ne
        le connaît, sauf toi.
        """
        return [p for p in self.positions if self.stop_for(p)[0] is None]

    def max_concurrent_risk(self, spec_book=None) -> Optional[Decimal]:
        """
        Le pire moment : combien de risque était exposé SIMULTANÉMENT ?

        C'est le chiffre que regarde ta prop firm, et que MT5 ne donne nulle part.

        Un ticket fermé ne compte plus. Deux tickets ouverts en même temps
        additionnent leur risque. ET — c'est tout l'objet de secured_on_add — un
        ticket passé au breakeven ne risque plus rien : son risque tombe à zéro à
        l'instant où tu ouvres le renforcement suivant.

        Sans la case cochée, on suppose le PIRE (le noyau risque encore tout). Le
        chiffre est alors un MAJORANT honnête, pas une mesure.
        """
        risks = self.ticket_risks(spec_book)
        ordered = sorted(self.positions, key=lambda p: p.open_time)

        events = []   # (instant, priorité, action, position)
        for p in ordered:
            events.append((p.open_time, 0, "open", p))
            events.append((p.close_time, 1, "close", p))
        events.sort(key=lambda e: (e[0], e[1]))

        live: dict[str, Decimal] = {}
        peak = Decimal(0)

        for _, _, action, p in events:
            if action == "open":
                # Le noyau était-il sécurisé quand CE ticket s'est ouvert ?
                # Si oui, tous les tickets déjà ouverts ne risquent plus rien.
                if self.secured_on_add.get(p.uid):
                    for uid in live:
                        live[uid] = Decimal(0)
                r = risks.get(p.position_id)
                if r is None:
                    return None      # un risque inconnu invalide tout le calcul
                live[p.uid] = r
            else:
                live.pop(p.uid, None)

            total = sum(live.values(), Decimal(0))
            peak = max(peak, total)

        return peak if peak > 0 else None

    def exposure_is_measured(self) -> bool:
        """
        L'exposition simultanée est-elle MESURÉE, ou seulement majorée ?

        Elle n'est mesurée que si chaque renforcement porte une réponse explicite
        à la question du breakeven. Sinon on affiche un majorant, et on le dit.
        """
        return all(a.uid in self.secured_on_add for a in self.adds)

    def risk_realized(self, spec_book=None,
                      basis: "RiskBasis" = None) -> Optional[Decimal]:
        """
        Le risque de l'IDÉE, en devise du compte.

        CORRECTION IMPORTANTE PAR RAPPORT À LA v1.

        Le modèle initial supposait que les renforcements étaient GRATUITS : le
        noyau passe au breakeven, donc seul le ticket initial porterait le risque.

        Les données du compte de référence disent le contraire. Sur la campagne short
        BTC, chaque add portait son propre stop complet :

            ticket initial   ~0.6 %  (stop passé au breakeven ensuite)
            add 1             0.45 %  (451.06 $ — stop PROUVÉ, jamais déplacé)
            add 2             0.51 %  (505.76 $)

        Les adds n'étaient pas gratuits : ils engageaient chacun un demi-pourcent
        neuf. Ne compter que le ticket initial donnait -1.18 R au lieu de -0.38 R.

        Trois bases sont donc proposées, et le choix est une question de méthode,
        pas de technique. Défaut : SUM.
        """
        basis = basis or self.risk_basis

        if basis == RiskBasis.MAX_CONCURRENT:
            return self.max_concurrent_risk(spec_book)

        risks = self.ticket_risks(spec_book)

        if basis == RiskBasis.INITIAL_ONLY:
            init = self.initial_position
            return risks.get(init.position_id) if init else None

        # SUM : somme de tous les risques engagés sur l'idée
        vals = [r for r in risks.values() if r is not None]
        if not vals or len(vals) < len(self.positions):
            return None      # un seul ticket sans stop connu invalide le total
        total = sum(vals, Decimal(0))
        return total if total > 0 else None

    def risk_planned(self, equity_ref: Decimal) -> Optional[Decimal]:
        """Le risque que tu VOULAIS prendre : risk_pct × capital de référence."""
        if self.thesis is None or self.thesis.risk_pct is None:
            return None
        return (self.thesis.risk_pct / Decimal(100)) * equity_ref

    def r_multiple(self, spec_book=None, basis: "RiskBasis" = None) -> Optional[Decimal]:
        """R = résultat net de l'idée / risque réellement engagé."""
        risk = self.risk_realized(spec_book, basis)
        if risk is None or risk == 0:
            return None
        return self.pnl_net / risk

    def r_normalized(self, equity_ref: Decimal) -> Optional[Decimal]:
        """R comparable dans le temps malgré tes changements de taille."""
        risk = self.risk_planned(equity_ref)
        if risk is None or risk == 0:
            return None
        return self.pnl_net / risk

    def size_conformity(self, equity_ref: Decimal, spec_book=None) -> Optional[Decimal]:
        """
        risque réel / risque voulu.
        1.0 = conforme. 1.8 = tu as pris 80 % de risque de plus que prévu.
        Mesuré, pas auto-déclaré.
        """
        real, plan = self.risk_realized(spec_book), self.risk_planned(equity_ref)
        if real is None or plan is None or plan == 0:
            return None
        return real / plan

    @property
    def risk_source(self) -> RiskSource:
        """
        Le R est-il calculable ? Oui dès qu'un stop existe.

        L'outil ne dégrade plus une idée en « reconstituée » parce qu'elle a été
        écrite après le trade ou parce qu'un stop a été saisi à la main. La
        journalisation différée est la règle, pas l'exception — on trade le
        matin et on journalise le soir — et un export sans SL n'a rien
        d'exceptionnel non plus. Ces trades sont des trades comme les autres.

        La seule chose qui reste vraie, et elle est mécanique : sans aucun stop,
        aucun R n'est calculable.
        """
        if self.thesis is None or self.thesis.stop_initial is None:
            return RiskSource.UNKNOWN
        return self.thesis.risk_source

    @property
    def discipline_score(self) -> Optional[int]:
        return self.review.discipline_score if self.review else None

    @property
    def quadrant(self) -> "Quadrant":
        """
        Le verdict décision × résultat de CETTE idée.

        Il exige une review : sans elle, le process n'est pas jugé. Un trade
        gagnant non relu n'est donc pas « maîtrise » — il est en attente. C'est
        volontairement inconfortable : c'est ce qui pousse à faire la review.
        """
        if not self.is_executed or self.review is None:
            return Quadrant.PENDING
        bon = self.review.discipline_score >= GOOD_PROCESS_MIN
        gain = self.pnl_net > 0
        if gain:
            return Quadrant.MASTERY if bon else Quadrant.LUCK
        return Quadrant.VARIANCE if bon else Quadrant.ERROR

    # ------------------------------------------------------- pendant le trade

    def floating_pnl(self, spec_book=None) -> Optional[Decimal]:
        """
        Le flottant des tickets encore ouverts, depuis les cours que TU as saisis.

        Aucun flux de prix n'existe dans l'outil. Sans cours saisi, on renvoie
        None — pas zéro : un zéro se lirait comme « à l'équilibre », ce qui
        serait une information inventée.
        """
        vals = []
        for o in self.open_trades:
            pv = spec_book.point_value_for(o.symbol) if spec_book else None
            v = o.floating_pnl(pv)
            if v is not None:
                vals.append(v)
        return sum(vals, Decimal(0)) if vals else None

    def risk_open(self, spec_book=None) -> Optional[Decimal]:
        """
        Le risque engagé par les tickets ENCORE OUVERTS, en devise du compte.

        Il utilise le stop réellement déclaré à l'ouverture, et à défaut celui
        de l'idée. Si la valeur du point du symbole n'a pas encore été apprise
        (aucun trade clôturé dessus), on renvoie None : un risque calculé avec
        une valeur de point inventée serait faux, pas approximatif.
        """
        if not self.open_trades:
            return None
        total = Decimal(0)
        for o in self.open_trades:
            pv = spec_book.point_value_for(o.symbol) if spec_book else None
            stop = o.stop if o.stop is not None else (
                self.thesis.stop_initial if self.thesis else None)
            if stop is None or pv is None:
                return None
            r = o.volume * abs(o.open_price - stop) * pv
            if r <= 0:
                return None
            total += r
        return total

    def floating_r(self, spec_book=None) -> Optional[Decimal]:
        """Le flottant exprimé en R, rapporté au risque des tickets ouverts."""
        pnl = self.floating_pnl(spec_book)
        risque = self.risk_open(spec_book)
        if pnl is None or not risque:
            return None
        return pnl / risque

    @property
    def display_name(self) -> str:
        if self.label:
            return self.label
        if self.thesis and self.thesis.macro_theme:
            return f"{self.symbol} {self.thesis.direction.value} — {self.thesis.macro_theme}"
        return f"{self.symbol} (hors-plan)" if self.off_plan else f"{self.symbol}"


# ------------------------------------------- le chapeau multi-instruments

@dataclass
class Campaign:
    """
    Une THÈSE MACRO : une conviction, exprimée sur PLUSIEURS instruments.

        Campagne « Dollar fort — Fed hawkish »
          ├── Idée   EURUSD sell   (ticket + adds)   -0.4 R
          └── Idée   USDJPY buy    (ticket + adds)   +1.2 R

    Pourquoi une couche de plus, et pas simplement une idée multi-symboles :

      - Le R, le pyramidage, le breakeven, l'exposition simultanée reposent tous
        sur des tickets CORRÉLÉS À 100 % — ce qui est vrai par construction sur un
        seul instrument, et faux entre deux. Additionner les risques d'un EURUSD et
        d'un USDJPY comme s'ils étaient indépendants serait une erreur silencieuse.

      - « Ticket initial » et « renforcement » n'ont aucun sens entre deux
        instruments : ton EURUSD n'est pas un add de ton USDJPY, c'est une JAMBE.

    L'Idée reste donc mono-symbole, et toute la mécanique fine reste prouvée.
    La Campagne agrège par-dessus, en devise du compte — sommable sans ambiguïté.

    ENTIÈREMENT OPTIONNELLE : une idée sans campagne fonctionne exactement comme
    avant. Rien de ce qui existe déjà n'est cassé.
    """
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    created_at: datetime = field(default_factory=lambda: _clock.server_now())
    name: str = ""
    macro_theme: str = ""
    catalyst: str = ""
    note: str = ""
    # Le corps de la thèse en BLOCS ordonnés (écriture façon Notion, #184) :
    #   {"type": "text",  "text": "..."}
    #   {"type": "image", "path": "captures/<owner>/<id>.png", "caption": "..."}
    # `note` reste renseigné (concat des blocs texte) pour la recherche et la
    # rétrocompatibilité : un ancien journal sans `blocks` se lit toujours via
    # `note` + `captures`. Le journal ne stocke que le CHEMIN de l'image, jamais
    # l'image elle-même — archi [P], auditable dix ans.
    blocks: list = field(default_factory=list)
    conviction: Optional[int] = None
    kill_switch: str = ""
    closed: bool = False
    abandoned: bool = False      # jamais exécutée, marquée — jamais effacée
    # Review d'abandon, simplifiée : conservée pour relire les anciens journaux.
    # La review d'abandon a été retirée ; ce champ n'est plus renseigné.
    abandon_correct: Optional[bool] = None
    # Le compte sur lequel la thèse est jouée. Vide = compte par défaut. Cloisonne
    # les thèses comme les idées : deux challenges ne partagent rien.
    account_id: str = ""

    # résolu au chargement, pas persisté
    ideas: list = field(default_factory=list, repr=False)
    attachments: list = field(default_factory=list, repr=False)

    @property
    def captures(self) -> list:
        """Les captures de la thèse macro : le graphique du dollar, le COT…"""
        return [a for a in self.attachments if not a.removed]

    @property
    def executed_ideas(self) -> list:
        return [i for i in self.ideas if i.is_executed]

    @property
    def instruments(self) -> list[str]:
        return sorted({i.symbol for i in self.executed_ideas})

    @property
    def pnl_net(self) -> Decimal:
        return sum((i.pnl_net for i in self.executed_ideas), Decimal(0))

    def risk_total(self, spec_book=None) -> Optional[Decimal]:
        """Somme des risques engagés, en devise du compte."""
        vals = [i.risk_realized(spec_book) for i in self.executed_ideas]
        if not vals or any(v is None for v in vals):
            return None
        return sum(vals, Decimal(0))

    def r_total(self, spec_book=None) -> Optional[Decimal]:
        """
        Le R de la campagne = SOMME des R de chaque idée.

        C'est la définition demandée : « combien de R cette thèse m'a rapporté ».
        Une idée à +1.2 R et une à -0.4 R donnent +0.8 R sur la thèse.
        """
        rs = [i.r_multiple(spec_book) for i in self.executed_ideas]
        if not rs or any(r is None for r in rs):
            return None
        return sum(rs, Decimal(0))

    def r_weighted(self, spec_book=None) -> Optional[Decimal]:
        """
        L'autre lecture, différente et complémentaire : P&L total / risque total.

        r_total répond à « combien de R ai-je gagné ».
        r_weighted répond à « combien ai-je gagné PAR UNITÉ DE RISQUE engagée ».

        Elles divergent dès que tes idées n'engagent pas le même risque. Une petite
        idée à +3 R pèse autant qu'une grosse dans r_total, beaucoup moins dans
        r_weighted. Les deux sont affichées.
        """
        risk = self.risk_total(spec_book)
        if risk is None or risk == 0:
            return None
        return self.pnl_net / risk

    @property
    def display_name(self) -> str:
        if self.name:
            return self.name
        if self.macro_theme:
            return self.macro_theme
        return "Thèse macro sans nom"


# ------------------------------------------------------------- sérialisation

def _enc(o):
    if isinstance(o, Decimal):
        return {"__dec__": str(o)}
    if isinstance(o, datetime):
        return {"__dt__": o.isoformat()}
    if isinstance(o, Enum):
        return o.value
    raise TypeError(f"non sérialisable : {type(o)}")


def _dec_hook(d: dict):
    if "__dec__" in d:
        return Decimal(d["__dec__"])
    if "__dt__" in d:
        return datetime.fromisoformat(d["__dt__"])
    return d


def to_dict(obj) -> dict:
    return asdict(obj)
