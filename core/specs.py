"""
Valeur du point : apprise depuis TES trades, jamais configurée à la main.

    pv = profit_brut / (volume × déplacement_prix)

Aucune table de spécifications à maintenir. Le jour où tu passes sur NAS100 ou
US30, l'outil apprend tout seul dès le premier trade clôturé.

Deux subtilités traitées ici :

  - ARRONDI. MT5 arrondit ses profits au centime. Sur BTCUSD, la valeur vraie
    est 1.0 mais le rétro-calcul sort 0.9999973. On « snappe » vers la valeur
    propre la plus proche quand l'écart est sous le bruit d'arrondi.

  - PAIRES EN JPY. Leur valeur de point dépend du taux de change au moment du
    trade : elle n'est pas constante. On garde donc la valeur déduite POSITION
    PAR POSITION pour le calcul du risque, et la médiane par symbole seulement
    comme repli quand une position ne permet pas la déduction (profit nul,
    scratch).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from statistics import median
from typing import Optional, Sequence

from .models import Position

# Valeurs « propres » vers lesquelles snapper si on en est très proche.
_CLEAN = [
    Decimal("0.01"), Decimal("0.1"), Decimal("1"), Decimal("10"),
    Decimal("100"), Decimal("1000"), Decimal("100000"),
]

# Tolérance relative : au-delà, on ne snappe pas (c'est une vraie valeur exotique).
_SNAP_TOL = Decimal("0.001")   # 0.1 %


def snap(pv: Decimal) -> Decimal:
    """0.9999973 -> 1. 99.87 -> 99.87 (trop loin, on n'invente rien)."""
    for c in _CLEAN:
        if c == 0:
            continue
        if abs(pv - c) / c <= _SNAP_TOL:
            return c
    return pv


@dataclass
class SymbolSpec:
    symbol: str
    point_value: Decimal      # médiane, snappée
    samples: int
    dispersion: Decimal       # écart max/min relatif — élevé = valeur non constante

    @property
    def is_stable(self) -> bool:
        """
        Une dispersion forte signale un symbole dont la valeur du point varie
        (typiquement les paires en JPY, converties au taux du moment).
        """
        return self.dispersion < Decimal("0.01")


class SpecBook:
    """Le carnet de specs, appris depuis l'historique."""

    def __init__(self, positions: Sequence[Position] = ()):
        self._specs: dict[str, SymbolSpec] = {}
        if positions:
            self.learn(positions)

    def learn(self, positions: Sequence[Position]) -> "SpecBook":
        by_symbol: dict[str, list[Decimal]] = defaultdict(list)
        for p in positions:
            pv = p.point_value
            if pv is not None and pv > 0:
                by_symbol[p.symbol].append(pv)

        for sym, pvs in by_symbol.items():
            med = Decimal(str(median(sorted(pvs))))
            lo, hi = min(pvs), max(pvs)
            disp = (hi - lo) / med if med else Decimal(0)
            self._specs[sym] = SymbolSpec(
                symbol=sym, point_value=snap(med),
                samples=len(pvs), dispersion=disp,
            )
        return self

    def get(self, symbol: str) -> Optional[SymbolSpec]:
        return self._specs.get(symbol)

    def point_value_for(self, symbol: str) -> Optional[Decimal]:
        """
        Valeur du point pour un SYMBOLE, sans position pour la déduire.

        Sert aux trades encore ouverts : ils n'ont pas de profit clôturé, donc
        rien à rétro-calculer. On se rabat sur ce que l'historique a appris — et
        s'il n'a rien appris sur ce symbole, on renvoie None plutôt qu'un 1
        arbitraire qui produirait un risque faux.
        """
        spec = self._specs.get((symbol or "").upper()) or self._specs.get(symbol)
        return spec.point_value if spec else None

    def point_value(self, position: Position) -> Optional[Decimal]:
        """
        Valeur du point à utiliser pour CETTE position.

        Priorité à la valeur déduite de la position elle-même : c'est la seule
        exacte pour les symboles dont le point varie (JPY). Le carnet ne sert
        que de repli.
        """
        own = position.point_value
        if own is not None and own > 0:
            spec = self._specs.get(position.symbol)
            # Symbole stable -> on préfère la médiane snappée, plus propre
            # que la valeur bruitée d'un trade isolé.
            if spec and spec.is_stable:
                return spec.point_value
            return own

        spec = self._specs.get(position.symbol)
        return spec.point_value if spec else None

    def __iter__(self):
        return iter(sorted(self._specs.values(), key=lambda s: s.symbol))

    def __len__(self):
        return len(self._specs)
