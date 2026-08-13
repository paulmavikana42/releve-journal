"""
Reprendre un journal écrit par une version précédente.

------------------------------------------------------------------------------
POURQUOI ÇA MARCHE SANS RIEN CONVERTIR

Le format n'a jamais changé : il a grandi. Une ligne reste un événement JSON, et
la règle tenue depuis le premier jour est que **toute évolution doit rester
rétrocompatible en lecture** — un champ absent prend sa valeur par défaut, un
type d'événement inconnu est ignoré sans faire tomber le journal.

C'est exactement la propriété qui rend cette reprise possible : il n'y a pas de
migration à écrire, pas de schéma à faire évoluer, pas de script à lancer une
seule fois et à ne jamais rejouer. On copie le fichier, on le relit.

Ce module ne fait donc PAS une conversion. Il fait trois choses qu'un copier-
coller ne fait pas :

  1. il REGARDE le fichier avant d'y toucher, et dit ce qu'il contient ;
  2. il refuse ce qui n'est pas un journal, au lieu d'écraser en silence ;
  3. il SAUVEGARDE ce qui est déjà là avant de le remplacer.

------------------------------------------------------------------------------
FUSIONNER OU REMPLACER

Remplacer est le cas normal : « voilà mon vrai journal, prends-le ».

Fusionner sert au cas où deux machines ont chacune une moitié de l'histoire. Les
lignes STRICTEMENT identiques ne sont pas ajoutées deux fois. Au-delà, rejouer
un événement en double est de toute façon presque toujours sans effet : les
idées et les positions sont indexées par identifiant, un rattachement en double
est ignoré. C'est une propriété du journal, pas une chance.
"""
from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from . import paths, settings

# Les types d'événements que cette version sait relire. Un type inconnu n'est
# pas une erreur — il vient peut-être d'une version PLUS récente — mais il est
# signalé, parce que l'ignorer en silence ferait disparaître de la donnée.
CONNUS = {
    "thesis_created", "thesis_updated", "idea_abandoned", "position_imported",
    "deal_imported", "position_linked", "position_unlinked", "add_secured",
    "review_completed", "campaign_created", "campaign_updated", "idea_attached",
    "idea_detached", "ticket_stop_set", "idea_marked_late", "idea_missed",
    "campaign_abandoned", "trade_opened", "trade_updated", "trade_cancelled",
    "capture_added", "capture_removed",
}


class MigrationError(Exception):
    pass


@dataclass
class Apercu:
    """Ce que contient le fichier, AVANT d'y toucher."""
    lignes: int = 0
    evenements: int = 0
    illisibles: int = 0
    par_type: dict = field(default_factory=dict)
    types_inconnus: set = field(default_factory=set)
    premiere: Optional[datetime] = None
    derniere: Optional[datetime] = None
    demo: int = 0

    @property
    def idees(self) -> int:
        return self.par_type.get("thesis_created", 0)

    @property
    def tickets(self) -> int:
        return self.par_type.get("position_imported", 0)

    @property
    def reviews(self) -> int:
        return self.par_type.get("review_completed", 0)

    @property
    def utilisable(self) -> bool:
        return self.evenements > 0


def _texte(source) -> str:
    raw = Path(source).read_bytes() if isinstance(source, (str, Path)) else source
    if isinstance(raw, str):
        return raw
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    for enc in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def inspect(source) -> Apercu:
    """
    Lit le fichier sans rien écrire. Lève si ce n'est manifestement pas un
    journal — mieux vaut un refus clair qu'un journal écrasé par un CSV.
    """
    texte = _texte(source)
    ap = Apercu()

    for ligne in texte.splitlines():
        ligne = ligne.strip()
        if not ligne:
            continue
        ap.lignes += 1
        try:
            ev = json.loads(ligne)
        except json.JSONDecodeError:
            ap.illisibles += 1
            continue
        if not isinstance(ev, dict) or "type" not in ev:
            ap.illisibles += 1
            continue

        ap.evenements += 1
        t = ev["type"]
        ap.par_type[t] = ap.par_type.get(t, 0) + 1
        if t not in CONNUS:
            ap.types_inconnus.add(t)
        if ev.get("demo"):
            ap.demo += 1

        ts = ev.get("ts")
        if ts:
            try:
                d = datetime.fromisoformat(ts)
            except ValueError:
                continue
            ap.premiere = d if ap.premiere is None else min(ap.premiere, d)
            ap.derniere = d if ap.derniere is None else max(ap.derniere, d)

    if not ap.utilisable:
        raise MigrationError(
            "Ce fichier ne ressemble pas à un journal Relevé : aucune ligne "
            "exploitable. Attendu : un fichier .jsonl dont chaque ligne est un "
            "événement JSON avec un champ « type ».")
    return ap


def inspect_actuel_count(store) -> int:
    """Combien d'événements dans le journal en cours d'utilisation."""
    try:
        return len(store.events())
    except Exception:
        return 0


def sauvegarder(journal: Path) -> Optional[Path]:
    """Met le journal actuel de côté, daté. Renvoie le chemin, ou None s'il n'existe pas."""
    if not journal.exists() or journal.stat().st_size == 0:
        return None
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = journal.with_name(f"{journal.stem}.{stamp}.remplace{journal.suffix}")
    shutil.copy2(journal, dest)
    return dest


def install(source, mode: str = "remplacer") -> tuple[Apercu, int, Optional[Path]]:
    """
    Installe un journal existant. Renvoie (aperçu, lignes écrites, sauvegarde).

        mode="remplacer"  le fichier devient TON journal. L'ancien est sauvegardé.
        mode="ajouter"    ses lignes rejoignent le journal actuel, sans doublon
                          strict.

    Dans les deux cas, la démonstration est quittée : de vraies données entrent,
    elle n'a plus lieu d'être.
    """
    if mode not in ("remplacer", "ajouter"):
        raise MigrationError(f"mode inconnu : {mode}")

    ap = inspect(source)
    texte = _texte(source)
    journal = paths.journal_path(demo=False)
    sauvegarde = None

    lignes = [l.strip() for l in texte.splitlines() if l.strip()]

    if mode == "remplacer":
        sauvegarde = sauvegarder(journal)
        journal.write_text("\n".join(lignes) + "\n", encoding="utf-8")
        ecrites = len(lignes)
    else:
        deja = set()
        if journal.exists():
            deja = {l.strip() for l in journal.read_text(encoding="utf-8").splitlines()
                    if l.strip()}
        neuves = [l for l in lignes if l not in deja]
        if neuves:
            with journal.open("a", encoding="utf-8") as f:
                f.write("\n".join(neuves) + "\n")
        ecrites = len(neuves)

    # De vraies données sont là : la démonstration n'a plus de raison d'être, et
    # le premier lancement est derrière nous.
    data = settings.read()
    data["demo_mode"] = False
    data["onboarded"] = True
    settings.write(data)
    (paths.data_dir() / "demo.jsonl").unlink(missing_ok=True)

    return ap, ecrites, sauvegarde
