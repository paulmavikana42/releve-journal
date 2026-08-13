"""
L'horloge.

Un système qui mélange deux référentiels temporels produit des bugs silencieux.
Celui-ci en avait DEUX, et le second était bien plus grave que le premier.

--- BUG 1 : le crash (visible, donc bénin) ---------------------------------

    Idea.created_at        -> datetime aware (UTC)
    Position.open_time     -> datetime naive (heure serveur MT5)

Python REFUSE de comparer les deux :

    TypeError: can't compare offset-naive and offset-aware datetimes

Il plantait au tri des idées. Un crash, c'est visible : on le corrige.

--- BUG 2 : la thèse valide rejetée (invisible, donc dangereux) -------------

Même en supprimant les fuseaux, il restait une erreur de fond.

Ton terminal est en GMT+1. Le serveur FundedNext est en UTC+3. Le rapport MT5
est horodaté en HEURE SERVEUR. Tes logs le prouvent :

    local 11:39:57 (GMT+1, soit 10:39:57 UTC)
    -> le journal rapporte  "authorization performed on 2026.07.12 13:39:56"

    serveur = UTC + 3.

Or le matcher DISQUALIFIE une thèse postérieure à l'ouverture du ticket — une
thèse écrite après le trade n'est pas une prédiction, c'est une justification.

Si created_at avait été pris en heure locale et comparé à une heure serveur, une
thèse écrite DEUX HEURES AVANT ton entrée aurait paru postérieure. Elle aurait
été rejetée, et ton trade classé HORS-PLAN.

Autrement dit : l'outil t'aurait accusé d'improviser des trades que tu avais
planifiés. Silencieusement. Et il aurait pollué à jamais ta métrique la plus
importante.

--- LA RÈGLE ----------------------------------------------------------------

Tout le domaine vit en HEURE SERVEUR, sans fuseau. Un seul référentiel, celui
du broker, celui du rapport. La conversion se fait ici, et nulle part ailleurs.

Les horodatages du journal d'événements (le champ "ts") restent en UTC : ce sont
des métadonnées d'audit, jamais comparées aux dates MT5.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

# Décalage du serveur du broker par rapport à UTC.
# FundedNext = UTC+3 (déduit des logs du terminal, voir ci-dessus).
# Modifiable dans data/settings.json si tu changes de broker.
DEFAULT_SERVER_UTC_OFFSET = 3


def server_utc_offset() -> int:
    from . import settings
    try:
        return int(settings.read()["server_utc_offset"])
    except Exception:
        return DEFAULT_SERVER_UTC_OFFSET


def set_server_utc_offset(hours: int) -> None:
    from . import settings
    settings.set("server_utc_offset", int(hours))


def server_now() -> datetime:
    """
    L'instant présent, exprimé dans le référentiel du broker, SANS fuseau.

    C'est la seule fonction autorisée à produire un « maintenant » dans le
    domaine. Tout le reste compare des naive entre eux, dans le même référentiel.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None) + \
        timedelta(hours=server_utc_offset())


def to_server_naive(dt: datetime) -> datetime:
    """
    Normalise n'importe quelle date vers le référentiel serveur, sans fuseau.

    Sert aussi de MIGRATION : les événements écrits avant cette correction
    portaient des dates UTC avec fuseau. Elles sont converties ici, à la lecture,
    sans qu'on ait à réécrire le journal (qui est append-only, donc immuable).
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt                      # déjà dans le bon référentiel
    return dt.astimezone(timezone.utc).replace(tzinfo=None) + \
        timedelta(hours=server_utc_offset())


# --------------------------------------------------------- jours ouvrés

# Tu ne portes jamais une position sur le week-end : le potentiel d'une thèse
# est donc plafonné à 5 jours ouvrés, quel que soit son timeframe. Une thèse D1
# n'a pas trois semaines pour se réaliser — elle a la semaine.
THESIS_WINDOW_DAYS = 5


def add_business_days(start: datetime, days: int) -> datetime:
    """
    Ajoute N jours OUVRÉS. Samedi et dimanche sont sautés.

    5 jours calendaires depuis un mercredi tomberaient un lundi en comptant le
    week-end comme du temps de marché — alors qu'il ne s'y passe rien.
    """
    d = start
    restants = days
    while restants > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:          # 0=lundi … 4=vendredi
            restants -= 1
    return d


def business_days_between(a: datetime, b: datetime) -> int:
    """Nombre de jours ouvrés écoulés entre deux instants (négatif si b < a)."""
    if b < a:
        return -business_days_between(b, a)
    n, d = 0, a
    while d.date() < b.date():
        d += timedelta(days=1)
        if d.weekday() < 5:
            n += 1
    return n


def thesis_deadline(created_at: datetime,
                    days: int = THESIS_WINDOW_DAYS) -> datetime:
    """L'échéance au-delà de laquelle une thèse armée doit être tranchée."""
    return add_business_days(created_at, days)


def is_expired(created_at: datetime, now: datetime = None,
               days: int = THESIS_WINDOW_DAYS) -> bool:
    return (now or server_now()) >= thesis_deadline(created_at, days)


# --------------------------------------------------------- jours ouvrés

# Aucune position n'est portée sur le week-end : une idée armée a donc au plus
# 5 JOURS OUVRÉS pour se réaliser. Cette contrainte est plus forte que l'horizon
# du timeframe — une thèse D1 n'a pas trois semaines, elle a la semaine.
REVIEW_WINDOW_BUSINESS_DAYS = 5


def business_days_between(start: datetime, end: datetime) -> int:
    """
    Jours ouvrés écoulés entre deux instants, week-ends exclus.

    Compter en jours calendaires ferait expirer une idée armée le jeudi en plein
    week-end, alors qu'elle n'a eu que deux séances pour se réaliser.
    """
    if end <= start:
        return 0
    d0, d1 = start.date(), end.date()
    days = 0
    cur = d0
    while cur < d1:
        cur += timedelta(days=1)
        if cur.weekday() < 5:          # 0-4 = lundi..vendredi
            days += 1
    return days


def add_business_days(start: datetime, n: int) -> datetime:
    """L'instant situé n jours ouvrés après start."""
    cur = start
    left = n
    while left > 0:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            left -= 1
    return cur


def review_due(armed_at: datetime, now: Optional[datetime] = None) -> bool:
    """Une idée armée a-t-elle dépassé sa fenêtre de 5 jours ouvrés ?"""
    now = now or server_now()
    return business_days_between(armed_at, now) >= REVIEW_WINDOW_BUSINESS_DAYS


def business_days_left(armed_at: datetime, now: Optional[datetime] = None) -> int:
    now = now or server_now()
    used = business_days_between(armed_at, now)
    return max(0, REVIEW_WINDOW_BUSINESS_DAYS - used)
