"""
Le premier lancement, et la mort de la démonstration.

------------------------------------------------------------------------------
LE PROBLÈME

Un outil qui s'ouvre sur un écran vide ne s'explique pas tout seul : on ne voit
ni à quoi ressemble une idée, ni ce que produit une matrice, ni pourquoi le R
compte. Une démonstration règle ça.

Mais une démonstration qui se mélange aux vraies données est un poison : dans
six mois, personne ne saura plus quelles lignes étaient inventées, et toutes les
statistiques seront fausses de manière invisible.

------------------------------------------------------------------------------
LA SOLUTION : DEUX FICHIERS, JAMAIS UN SEUL

    data/demo.jsonl     la démonstration. Jetable par construction.
    data/events.jsonl   TON journal. Il n'a jamais contenu une ligne de démo.

Tant que le mode démo est actif, l'application lit `demo.jsonl`. Au premier
import de VRAIS trades, on bascule : ce que TU as écrit pendant la démo est
recopié dans `events.jsonl`, et le décor fabriqué est effacé.

Ce que ça garantit, et qu'un « nettoyage » du vrai journal n'aurait jamais
donné : `events.jsonl` reste APPEND-ONLY. On n'y supprime jamais rien, puisqu'il
n'a jamais rien contenu de faux. La promesse centrale du format tient.

Et `demo.jsonl`, lui, est SUPPRIMÉ à la bascule. Ce fichier n'est l'actif de
personne : le garder reviendrait à laisser dans le dossier de données de
quelqu'un un trade BTC qui n'a jamais été le sien.
"""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from . import paths, settings

# Marqueur posé sur CHAQUE événement fabriqué par l'amorçage. C'est lui qui
# distingue « inventé pour la démonstration » de « écrit par l'utilisateur »,
# y compris quand les deux vivent dans le même fichier.
DEMO_FLAG = "demo"


def demo_mode() -> bool:
    return bool(settings.read().get("demo_mode", False))


def configured() -> bool:
    """
    Le premier lancement est-il passé ?

    On ne regarde pas si le journal existe : quelqu'un qui n'écrit rien pendant
    trois jours reverrait l'écran d'accueil à chaque ouverture. On regarde si un
    choix a été FAIT.
    """
    return bool(settings.read().get("onboarded", False))


def start_blank() -> Path:
    """Démarrer vierge : aucun journal préexistant, aucune règle supposée."""
    data = settings.read()
    data["onboarded"] = True
    data["demo_mode"] = False
    settings.write(data)
    p = paths.journal_path(demo=False)
    p.touch(exist_ok=True)
    return p


def start_demo() -> Path:
    """
    Démarrer avec la démonstration.

    Le journal de démo est (re)construit dans son propre fichier. `events.jsonl`
    n'est pas touché — il n'existe peut-être même pas encore.
    """
    data = settings.read()
    data["onboarded"] = True
    data["demo_mode"] = True
    settings.write(data)
    return paths.journal_path(demo=True)


def current_journal() -> Path:
    return paths.journal_path(demo=demo_mode())


def has_real_positions(journal: Path) -> bool:
    """Le journal contient-il au moins un ticket importé qui n'est pas de démo ?"""
    if not journal.exists():
        return False
    for ligne in journal.read_text(encoding="utf-8").splitlines():
        ligne = ligne.strip()
        if not ligne:
            continue
        try:
            ev = json.loads(ligne)
        except json.JSONDecodeError:
            continue
        if ev.get("type") == "position_imported" and not ev.get(DEMO_FLAG):
            return True
    return False


def leave_demo() -> tuple[Path, int]:
    """
    Quitter la démonstration. Renvoie (journal réel, nb d'événements conservés).

    Ce que TU as écrit pendant la démo (idées, captures, tickets déclarés) est
    recopié dans le vrai journal. Le décor fabriqué — la campagne BTC de
    démonstration et son trade en cours — est SUPPRIMÉ : `demo.jsonl` disparaît
    du disque.

    Pourquoi le supprimer au lieu de le garder « au cas où » : ce fichier n'est
    l'actif de personne. Le laisser traîner, c'est laisser dans le dossier de
    données de quelqu'un un trade BTC qui n'a jamais été le sien, et qui
    ressemblera à une vraie donnée le jour où il ouvrira le dossier. La seule
    précaution qui compte est l'ORDRE : on n'efface qu'APRÈS avoir écrit ce
    qu'il faut garder.

    Appelée AVANT le premier import réel : le nouveau ticket sera donc écrit
    dans `events.jsonl`, jamais dans la démo.
    """
    reel = paths.journal_path(demo=False)

    # Garde-fou : appelée une seconde fois (deuxième import), elle recopierait
    # une seconde fois les mêmes lignes et dupliquerait les idées de
    # l'utilisateur. On ne quitte la démonstration qu'une fois.
    if not demo_mode():
        reel.touch(exist_ok=True)
        return reel, 0

    demo = paths.journal_path(demo=True)
    gardes = []
    if demo.exists():
        for ligne in demo.read_text(encoding="utf-8").splitlines():
            ligne = ligne.strip()
            if not ligne:
                continue
            try:
                ev = json.loads(ligne)
            except json.JSONDecodeError:
                continue
            if not ev.get(DEMO_FLAG):
                gardes.append(ligne)

    if gardes:
        # Le vrai journal peut déjà exister (démo relancée après coup) : on
        # ajoute, on ne remplace jamais.
        with reel.open("a", encoding="utf-8") as f:
            f.write("\n".join(gardes) + "\n")
            f.flush()
            os.fsync(f.fileno())     # écrit sur le disque AVANT d'effacer
    else:
        reel.touch(exist_ok=True)

    # Le décor s'en va. Après l'écriture, jamais avant.
    demo.unlink(missing_ok=True)

    data = settings.read()
    data["demo_mode"] = False
    data["onboarded"] = True
    settings.write(data)
    return reel, len(gardes)


def reset_all(backup: bool = True) -> None:
    """
    Repartir totalement de zéro : journal, réglages, captures.

    Le VRAI journal est sauvegardé à côté avant d'être écarté, jamais supprimé :
    quelqu'un qui clique « repartir de zéro » à 2 h du matin ne mérite pas de
    perdre trois ans d'idées sur un malentendu.

    La démonstration, elle, part à la poubelle sans cérémonie — la conserver
    n'aurait aucun sens, et un `demo.<date>.jsonl` traînant dans le dossier
    ressemblerait à une donnée qu'on n'ose plus supprimer.
    """
    d = paths.data_dir()
    for nom in ("events.jsonl", "demo.jsonl", "settings.json"):
        f = d / nom
        if not f.exists():
            continue
        if nom == "demo.jsonl":
            f.unlink()
            continue
        if backup:
            from datetime import datetime
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            shutil.move(str(f), str(d / f"{f.stem}.{stamp}.avant-remise-a-zero{f.suffix}"))
        else:
            f.unlink()
