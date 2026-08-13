"""
Les réglages : un seul fichier, `data/settings.json`.

Il contient ce qui CONFIGURE l'outil (décalage serveur, watchlist, comptes et
leurs règles), jamais ce qui le NOURRIT (les idées, les trades, les captures —
tout cela vit dans events.jsonl, append-only).

La distinction compte le jour d'une sauvegarde : `events.jsonl` est
irremplaçable, `settings.json` se retape en deux minutes.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import paths


def path() -> Path:
    """
    Résolu à CHAQUE appel, jamais figé au chargement du module.

    Une constante calculée à l'import serait fausse dès qu'un test change
    `RELEVE_DATA` — et pire, elle pointerait vers le dossier du programme dans
    un `.exe`, où l'écriture est interdite.
    """
    return paths.settings_path()


def read() -> dict:
    p = path()
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            # Un fichier de réglages corrompu ne doit jamais empêcher l'outil de
            # démarrer : on repart des valeurs par défaut, le journal est intact.
            return {}
    return {}


def write(data: dict) -> None:
    p = path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def get(key: str, default: Any = None) -> Any:
    return read().get(key, default)


def set(key: str, value: Any) -> None:      # noqa: A001 (nom volontairement court)
    data = read()
    data[key] = value
    write(data)
