"""
Le registre des symboles.

Le problème qu'il résout : tu penses « NASDAQ », « BRENT », « USOIL ». Ton
broker écrit NDX100, UKOUSD, USOUSD. Une thèse écrite avec TON vocabulaire ne
matchera jamais un ticket écrit avec le SIEN — et le trade part en hors-plan
alors qu'il était planifié. C'est arrivé, ça fausse la métrique la plus dure de
l'outil.

La solution n'est pas d'apprendre des alias (deviner que « BRENT » = UKOUSD est
un pari, et un pari faux se paie cher). C'est de ne JAMAIS te laisser taper un
symbole à la main : tu choisis dans une liste, celle de ton terminal.

Deux sources, fusionnées :
  1. Ta watchlist MT5, saisie une fois (data/settings.json)
  2. Tout symbole vu dans un rapport importé — appris automatiquement

Un symbole importé est la VÉRITÉ du broker : il entre dans la liste sans
discussion.
"""
from __future__ import annotations

from typing import Iterable, Sequence

from . import settings as _st

# Watchlist MT5 par défaut. Modifiable dans l'app (Réglages) ou directement
# dans data/settings.json.
DEFAULT_WATCHLIST = [
    "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "NDX100",
    "SPX500", "US30", "USOUSD", "UKOUSD", "XAUUSD",
]


def watchlist() -> list[str]:
    """Les symboles que tu suis. Défaut : la watchlist MT5 classique."""
    lst = _st.read().get("watchlist")
    if not lst:
        return list(DEFAULT_WATCHLIST)
    return [s.upper() for s in lst]


def set_watchlist(symbols: Iterable[str]) -> None:
    _st.set("watchlist",
            sorted({s.strip().upper() for s in symbols if s.strip()}))


def learn(symbols: Iterable[str]) -> list[str]:
    """
    Enregistre des symboles vus dans un rapport MT5.

    Un symbole importé vient du broker : c'est la vérité, il entre sans
    condition. Renvoie les nouveaux.
    """
    current = set(watchlist())
    fresh = sorted({s.strip().upper() for s in symbols if s.strip()} - current)
    if fresh:
        set_watchlist(current | set(fresh))
    return fresh


def known(positions: Sequence = ()) -> list[str]:
    """
    La liste à proposer dans les menus : watchlist + tout ce qui a été tradé.
    Triée, sans doublon.
    """
    out = set(watchlist())
    for p in positions:
        sym = getattr(p, "symbol", None)
        if sym:
            out.add(sym.upper())
    return sorted(out)
