"""
Les captures d'écran.

POURQUOI ELLES NE SONT PAS DE LA DÉCORATION
-------------------------------------------

Une capture prise AU MOMENT de l'entrée est une donnée pré-engagée : l'image
horodate ce que tu voyais, où était ton stop, quelle structure tu lisais. C'est
le même raisonnement que `StopEvidence.CAPTURE` — elle entre par une autre porte
qu'un champ du broker, mais elle vaut autant, et elle ne dégrade rien.

Une capture ajoutée trois semaines plus tard ne prouve rien de tel : elle
illustre. L'outil garde donc l'horodatage d'AJOUT à côté de l'horodatage de
l'idée, et te laisse voir l'écart. Il ne le cache pas et ne le juge pas.

OÙ VIVENT LES FICHIERS
----------------------

    data/captures/<owner_id>/<attachment_id>.<ext>

Sur le disque, en clair, pas en base64 dans le journal. Deux raisons :

  1. `events.jsonl` doit rester lisible et réparable au bloc-notes dans dix ans.
     Une image encodée sur 400 000 caractères au milieu d'une ligne le rendrait
     impraticable.
  2. Une image est un fichier. Le jour où l'outil disparaît, tes captures
     s'ouvrent quand même — c'est le même principe que le JSON brut.

Le journal ne stocke que le chemin relatif. Rien n'est jamais effacé : retirer
une capture la marque `removed`, le fichier reste.
"""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

from .clock import server_now
from .models import Attachment, CaptureKind

# Formats acceptés. Rien d'exotique : ce sont ceux que produisent une capture
# Windows, un partage TradingView et un screenshot de téléphone.
ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

# 12 Mo : au-delà, ce n'est plus une capture d'écran. La limite protège surtout
# le dossier data/, qu'il faut pouvoir sauvegarder d'un glisser-déposer.
MAX_BYTES = 12 * 1024 * 1024


class CaptureError(Exception):
    pass


def _root(data_dir) -> Path:
    return Path(data_dir) / "captures"


def save(data_dir, owner_type: str, owner_id: str, filename: str,
         content: bytes, kind: CaptureKind = CaptureKind.OTHER,
         caption: str = "") -> Attachment:
    """
    Écrit le fichier et renvoie la pièce jointe à journaliser.

    N'écrit RIEN dans le journal : c'est l'appelant qui décide (store.add_capture).
    Séparer les deux évite l'orphelin classique — un événement écrit alors que
    l'écriture disque a échoué.
    """
    ext = Path(filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise CaptureError(
            f"Format non accepté ({ext or 'inconnu'}). "
            f"Attendu : {', '.join(sorted(ALLOWED_EXT))}.")
    if not content:
        raise CaptureError("Fichier vide.")
    if len(content) > MAX_BYTES:
        raise CaptureError(
            f"{len(content) / 1_048_576:.1f} Mo — au-delà de la limite de "
            f"{MAX_BYTES // 1_048_576} Mo. Réduis la capture avant de la joindre.")

    aid = uuid.uuid4().hex[:12]
    folder = _root(data_dir) / owner_id
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"{aid}{ext}"
    dest.write_bytes(content)

    return Attachment(
        id=aid,
        owner_type=owner_type,
        owner_id=owner_id,
        path=f"captures/{owner_id}/{aid}{ext}",
        original_name=filename,
        kind=kind,
        caption=caption,
        added_at=server_now(),
    )


def resolve(data_dir, attachment: Attachment) -> Optional[Path]:
    """Le chemin absolu du fichier, ou None s'il a disparu du disque."""
    p = Path(data_dir) / attachment.path
    return p if p.exists() else None


def read(data_dir, attachment: Attachment) -> Optional[bytes]:
    p = resolve(data_dir, attachment)
    return p.read_bytes() if p else None
