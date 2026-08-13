"""
Où vivent tes données.

------------------------------------------------------------------------------
POURQUOI CE FICHIER EXISTE

Tant que l'outil se lançait depuis son dossier source, `data/` à côté du code
suffisait. Dès qu'il est distribué en `.exe`, c'est faux et dangereux :

  - un programme installé dans `C:\\Program Files\\` n'a PAS le droit d'écrire
    à côté de lui — Windows refuse silencieusement, ou pire, redirige vers un
    dossier virtuel dont personne ne retrouve jamais le contenu ;
  - un `.exe` fabriqué avec PyInstaller en mode « un seul fichier » se
    décompresse dans un dossier TEMPORAIRE, effacé à la fermeture. Un journal
    écrit là serait perdu à chaque session — le pire bug imaginable pour cet
    outil précis.

La règle est donc : **le journal ne vit jamais à côté du programme**. Il vit
dans le profil de l'utilisateur, un endroit dont il est propriétaire et qui
survit aux mises à jour du logiciel.

    Windows   %LOCALAPPDATA%\\Releve\\data
    macOS     ~/Library/Application Support/Releve/data
    Linux     ~/.local/share/releve/data

En développement (lancé depuis les sources), on garde `data/` du dépôt : c'est
pratique, et un `git clone` reste autonome.

`RELEVE_DATA` force le dossier, quoi qu'il arrive. C'est ce qui permet aux tests
de ne jamais toucher aux vraies données, et de mettre son journal sur une clé
USB si on le souhaite.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "Releve"


def is_frozen() -> bool:
    """Tourne-t-on depuis un .exe fabriqué par PyInstaller ?"""
    return getattr(sys, "frozen", False)


def _user_data_root() -> Path:
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return Path(base) / APP_NAME
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    return Path(os.environ.get("XDG_DATA_HOME",
                               Path.home() / ".local" / "share")) / APP_NAME.lower()


def repo_root() -> Path:
    """La racine des SOURCES (code, ressources). Jamais un endroit où écrire."""
    if is_frozen():
        # PyInstaller expose son dossier d'extraction ici.
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    """
    Le dossier des données, créé si besoin.

    C'est LE dossier à sauvegarder : il contient le journal et les captures.
    """
    forced = os.environ.get("RELEVE_DATA")
    if forced:
        d = Path(forced)
    elif is_frozen():
        d = _user_data_root() / "data"
    else:
        d = repo_root() / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d


def settings_path() -> Path:
    return data_dir() / "settings.json"


def journal_path(demo: bool = False) -> Path:
    """
    Le journal courant.

    Deux fichiers, jamais mélangés :

      events.jsonl   TON journal. Irremplaçable.
      demo.jsonl     les données de démonstration. Jetables par construction.

    Séparer les deux est ce qui permet de faire disparaître la démo sans jamais
    RÉÉCRIRE un journal — or ne jamais réécrire est la promesse centrale du
    format (voir core/store.py).
    """
    return data_dir() / ("demo.jsonl" if demo else "events.jsonl")
