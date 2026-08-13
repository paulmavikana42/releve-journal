"""
Stockage : journal d'événements JSONL, append-only.

On n'écrase JAMAIS une ligne. Chaque action est un événement ajouté en fin de
fichier. L'état courant se reconstruit en rejouant le journal.

Pourquoi :
  - Aucune corruption possible. Une écriture interrompue perd au pire la
    dernière ligne, jamais le fichier.
  - Historique complet. Si tu modifies une thèse APRÈS avoir vu le résultat,
    le journal le sait, et l'outil peut te le dire.
  - Réparable au bloc-notes. Une ligne = un JSON. Pas de binaire, pas de base.

Ce fichier est ton vrai patrimoine. Le code se réécrit en un week-end ; trois
ans de thèses annotées, non. C'est pour ça que le format est du JSON brut,
lisible dans dix ans avec n'importe quel langage.
"""
from __future__ import annotations

import json
import shutil
from dataclasses import asdict, fields, is_dataclass
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from .clock import to_server_naive
from .models import (
    Attachment, Campaign, CaptureKind, Deal, Direction, Idea, IdeaStatus,
    MissedOutcome, MissedReview, OpenTrade, Position, Review, RiskSource,
    StopEvidence, Thesis, ThesisOutcome,
)

SCHEMA_VERSION = 1


# ------------------------------------------------------------- (dé)sérialisation

def _encode(o: Any) -> Any:
    if isinstance(o, Decimal):
        return {"$dec": str(o)}
    if isinstance(o, datetime):
        return {"$dt": o.isoformat()}
    if isinstance(o, Enum):
        return o.value
    if is_dataclass(o):
        return {k: _encode(v) for k, v in asdict(o).items()}
    if isinstance(o, dict):
        return {k: _encode(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_encode(v) for v in o]
    return o


def _decode(o: Any) -> Any:
    if isinstance(o, dict):
        if "$dec" in o:
            return Decimal(o["$dec"])
        if "$dt" in o:
            return datetime.fromisoformat(o["$dt"])
        return {k: _decode(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_decode(v) for v in o]
    return o


def _build(cls, data: dict):
    """Reconstruit une dataclass en ignorant les champs inconnus (migrations)."""
    if data is None:
        return None
    known = {f.name for f in fields(cls)}
    kwargs = {k: v for k, v in data.items() if k in known}
    return cls(**kwargs)


def _thesis_from(d: Optional[dict]) -> Optional[Thesis]:
    if not d:
        return None
    t = _build(Thesis, d)
    t.direction = Direction(t.direction)
    t.risk_source = RiskSource(t.risk_source)
    return t


def _open_trade_from(d: dict) -> OpenTrade:
    t = _build(OpenTrade, d)
    return replace_enum_direction(t)


def replace_enum_direction(t: OpenTrade) -> OpenTrade:
    """OpenTrade est frozen : on reconstruit plutôt que de muter."""
    from dataclasses import replace
    return replace(t, direction=Direction(t.direction))


def _attachment_from(d: dict) -> Attachment:
    a = _build(Attachment, d)
    from dataclasses import replace
    return replace(a, kind=CaptureKind(a.kind))


def _review_from(d: Optional[dict]) -> Optional[Review]:
    if not d:
        return None
    r = _build(Review, d)
    r.thesis_outcome = ThesisOutcome(r.thesis_outcome)
    return r


# --------------------------------------------------------------------- journal

class Store:
    """
    Journal d'événements.

    Types d'événements :
      thesis_created      une idée naît (thèse écrite avant le trade)
      thesis_updated      la thèse est modifiée  <- horodaté, donc auditable
      idea_abandoned      thèse jamais exécutée
      trade_opened        tu déclares l'ouverture d'un ticket : l'idée passe
                          « en cours » et son numéro de ticket devient la clé
                          que l'import viendra clôturer
      trade_updated       stop déplacé, cours saisi, note — pendant que ça vit
      trade_cancelled     ticket déclaré par erreur, jamais ouvert
      capture_added       une image jointe à une idée ou à une thèse
      capture_removed     retirée de l'affichage — le fichier, lui, reste
      position_imported   un ticket MT5 entre dans le système
      deal_imported       une transaction MT5 (sert à la courbe de solde)
      position_linked     un ticket est rattaché à une idée (validé par toi)
      add_secured         pour un renforcement : le noyau était-il déjà au BE ?
      position_unlinked   rattachement annulé
      review_completed    la review post-trade est faite
      campaign_created    une thèse macro naît (regroupe plusieurs idées)
      campaign_updated    elle est modifiée
      idea_attached       une idée rejoint une thèse macro
      idea_detached       elle la quitte
      ticket_stop_set     tu saisis à la main le stop d'un ticket
      idea_marked_late    l'idée a été écrite après le trade (journalisation différée)
      idea_missed         review d'une idée armée puis jamais exécutée
      campaign_abandoned  une thèse abandonnée (marquée, jamais effacée)

    TOUS LES AJOUTS SONT RÉTROCOMPATIBLES. Un journal écrit avant leur existence
    se relit sans erreur : les champs absents prennent leur valeur par défaut, et
    une idée sans campagne se comporte exactement comme avant.
    """

    def __init__(self, path="data/events.jsonl", demo: bool = False):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Marque chaque événement écrit par ce store comme fabriqué pour la
        # DÉMONSTRATION. C'est ce drapeau qui permettra plus tard de laisser la
        # démo derrière sans toucher à ce que l'utilisateur a écrit lui-même
        # (voir core/onboarding.py).
        self.demo = demo

    # --- écriture

    def append(self, event_type: str, payload: dict) -> dict:
        ev = {
            "v": SCHEMA_VERSION,
            "ts": datetime.now(timezone.utc).isoformat(),
            "type": event_type,
            "payload": _encode(payload),
        }
        if self.demo:
            ev["demo"] = True
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")
        return ev

    # --- lecture

    def events(self) -> list[dict]:
        if not self.path.exists():
            return []
        out = []
        for i, line in enumerate(self.path.read_text(encoding="utf-8").splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                # Une ligne corrompue ne doit jamais faire tomber le journal.
                print(f"[store] ligne {i} illisible, ignorée")
        return out

    # --- reconstruction de l'état

    def load(self) -> tuple[dict[str, Idea], dict[str, Position], list[Deal]]:
        ideas: dict[str, Idea] = {}
        positions: dict[str, Position] = {}
        deals: dict[str, Deal] = {}
        self._campaigns: dict[str, Campaign] = {}
        # trades déclarés ouverts : clé = uid, valeur = (idea_id, OpenTrade)
        opens: dict[str, tuple[str, OpenTrade]] = {}
        # captures : clé = id de la pièce jointe
        attachments: dict[str, Attachment] = {}

        for ev in self.events():
            t = ev["type"]
            p = _decode(ev["payload"])

            if t == "position_imported":
                pos = _build(Position, p)
                pos.__dict__["direction"] = Direction(pos.direction)
                from .models import ExitReason
                pos.__dict__["exit_reason"] = ExitReason(pos.exit_reason)
                positions[pos.uid] = pos

            elif t == "deal_imported":
                d = _build(Deal, p)
                deals[d.deal_id] = d

            elif t == "thesis_created":
                idea = Idea(
                    id=p["id"],
                    # Migration : les événements écrits avant la correction du
                    # référentiel temporel portent des dates UTC avec fuseau.
                    # On les normalise ici, sans réécrire le journal.
                    created_at=to_server_naive(p["created_at"]),
                    thesis=_thesis_from(p.get("thesis")),
                    status=IdeaStatus(p.get("status", "armee")),
                    off_plan=p.get("off_plan", False),
                    label=p.get("label", ""),
                    campaign_id=p.get("campaign_id"),
                    late_thesis=p.get("late_thesis", False),
                    account_id=p.get("account_id", ""),
                )
                ideas[idea.id] = idea

            elif t == "thesis_updated" and p["id"] in ideas:
                ideas[p["id"]].thesis = _thesis_from(p.get("thesis"))
                if p.get("label") is not None:
                    ideas[p["id"]].label = p["label"]

            elif t == "idea_abandoned" and p["id"] in ideas:
                ideas[p["id"]].status = IdeaStatus.ABANDONED

            elif t == "trade_opened" and p["idea_id"] in ideas:
                tr = _open_trade_from(p["trade"])
                opens[tr.uid] = (p["idea_id"], tr)

            elif t == "trade_updated" and p["uid"] in opens:
                from dataclasses import replace as _replace
                iid, tr = opens[p["uid"]]
                champs = {k: v for k, v in p.items()
                          if k not in ("uid", "idea_id")
                          and k in {f.name for f in fields(OpenTrade)}}
                opens[p["uid"]] = (iid, _replace(tr, **champs))

            elif t == "trade_cancelled":
                opens.pop(p["uid"], None)

            elif t == "capture_added":
                a = _attachment_from(p["attachment"])
                attachments[a.id] = a

            elif t == "capture_removed" and p["id"] in attachments:
                from dataclasses import replace as _replace
                attachments[p["id"]] = _replace(attachments[p["id"]], removed=True)

            elif t == "position_linked" and p["idea_id"] in ideas:
                idea = ideas[p["idea_id"]]
                if p["position_uid"] not in idea.position_uids:
                    idea.position_uids.append(p["position_uid"])

            elif t == "add_secured" and p["idea_id"] in ideas:
                ideas[p["idea_id"]].secured_on_add[p["position_uid"]] = bool(p["secured"])

            elif t == "position_unlinked" and p["idea_id"] in ideas:
                idea = ideas[p["idea_id"]]
                if p["position_uid"] in idea.position_uids:
                    idea.position_uids.remove(p["position_uid"])

            elif t == "review_completed" and p["id"] in ideas:
                ideas[p["id"]].review = _review_from(p.get("review"))
                ideas[p["id"]].status = IdeaStatus.REVIEWED

            elif t == "campaign_created":
                c = _build(Campaign, p)
                c.created_at = to_server_naive(c.created_at)
                self._campaigns[c.id] = c

            elif t == "campaign_updated" and p["id"] in self._campaigns:
                c = self._campaigns[p["id"]]
                for k, v in p.items():
                    if k not in ("id", "created_at", "ideas", "attachments") \
                            and hasattr(c, k):
                        setattr(c, k, v)

            elif t == "idea_attached" and p["idea_id"] in ideas:
                ideas[p["idea_id"]].campaign_id = p["campaign_id"]

            elif t == "idea_detached" and p["idea_id"] in ideas:
                ideas[p["idea_id"]].campaign_id = None

            elif t == "idea_marked_late" and p["id"] in ideas:
                ideas[p["id"]].late_thesis = bool(p.get("late", True))

            elif t == "idea_missed" and p["id"] in ideas:
                # Conservé pour relire les anciens journaux : ces événements ne
                # sont plus produits (la review d'abandon a été retirée).
                mr = _build(MissedReview, p.get("review") or {})
                if mr:
                    mr.setup_appeared = MissedOutcome(mr.setup_appeared)
                ideas[p["id"]].missed_review = mr
                ideas[p["id"]].status = IdeaStatus.ABANDONED

            elif t == "campaign_abandoned" and p["id"] in self._campaigns:
                self._campaigns[p["id"]].abandoned = True
                # Rétrocompatible : les anciens événements n'ont pas ce champ.
                self._campaigns[p["id"]].abandon_correct = p.get("correct")

            elif t == "ticket_stop_set" and p["idea_id"] in ideas:
                idea = ideas[p["idea_id"]]
                idea.manual_stops[p["position_uid"]] = p["stop"]
                # Les événements écrits avant l'ajout de la preuve n'ont pas ce
                # champ : on les considère comme des captures (le défaut).
                idea.stop_evidence[p["position_uid"]] = StopEvidence(
                    p.get("evidence", StopEvidence.CAPTURE.value))

        # résolution des campagnes
        for c in self._campaigns.values():
            c.ideas = []
        for idea in ideas.values():
            if idea.campaign_id and idea.campaign_id in self._campaigns:
                self._campaigns[idea.campaign_id].ideas.append(idea)

        # --- LE TICKET IMPORTÉ CONSOMME LE TRADE OUVERT ------------------
        # Aucun événement « trade_closed » n'existe, et c'est volontaire : la
        # clôture EST l'arrivée de la position. Un trade déclaré ouvert dont le
        # ticket a été importé n'est plus ouvert, point. Rien à synchroniser,
        # donc rien à désynchroniser.
        closed_uids = set(positions)
        # ticket -> comptes sur lesquels ce ticket a été importé
        closed_tickets: dict[str, set[str]] = {}
        for p in positions.values():
            closed_tickets.setdefault(p.position_id, set()).add(p.account_id)

        still_open: dict[str, list[OpenTrade]] = {}
        for uid, (idea_id, tr) in opens.items():
            comptes = closed_tickets.get(tr.ticket)
            # Le cas nominal : même compte, même ticket.
            ferme = uid in closed_uids
            # Le cas réel : l'un des deux côtés ignore le numéro de compte. Un
            # CSV n'a presque jamais de colonne « compte », et personne ne le
            # ressaisit à 2 h du matin sur un téléphone. Quand un seul côté le
            # connaît, le ticket seul tranche — la collision inter-comptes ne
            # peut se produire que si les DEUX côtés sont renseignés, et là on
            # ne se rabat pas.
            if not ferme and comptes:
                ferme = not tr.account_id or "" in comptes
            if ferme:
                continue
            still_open.setdefault(idea_id, []).append(tr)

        # --- captures
        by_owner: dict[str, list[Attachment]] = {}
        for a in attachments.values():
            by_owner.setdefault(a.owner_id, []).append(a)
        for lst in by_owner.values():
            lst.sort(key=lambda x: x.added_at or datetime.min)
        for cid, c in self._campaigns.items():
            c.attachments = by_owner.get(cid, [])

        # résolution des positions + recalcul des statuts
        for idea in ideas.values():
            idea.positions = [positions[u] for u in idea.position_uids if u in positions]
            idea.open_trades = sorted(still_open.get(idea.id, []),
                                      key=lambda o: o.open_time)
            idea.attachments = by_owner.get(idea.id, [])
            if idea.status in (IdeaStatus.ABANDONED, IdeaStatus.REVIEWED):
                continue
            if idea.open_trades:
                # Un trade encore ouvert prime sur les tickets déjà clôturés :
                # une idée pyramidée dont un seul ticket vit encore n'est pas
                # « clôturée », et la présenter ainsi appellerait une review
                # sur un trade en cours.
                idea.status = IdeaStatus.RUNNING
            elif idea.positions:
                idea.status = IdeaStatus.CLOSED
            elif idea.thesis:
                idea.status = IdeaStatus.ARMED

        return ideas, positions, sorted(deals.values(), key=lambda d: d.time)

    # --- API haut niveau

    def create_thesis(self, thesis: Thesis, label: str = "",
                      off_plan: bool = False, account_id: str = "",
                      created_at: Optional[datetime] = None) -> Idea:
        """
        `created_at` n'est là que pour l'amorçage de la démonstration, qui doit
        fabriquer des idées ANTÉRIEURES à leurs trades — sinon le matcher les
        traiterait à juste titre comme des justifications d'après-coup.
        Personne d'autre ne devrait le passer : une idée est datée de l'instant
        où on l'écrit, et c'est toute sa valeur.
        """
        idea = Idea(thesis=thesis, status=IdeaStatus.ARMED,
                    off_plan=off_plan, label=label, account_id=account_id)
        if created_at is not None:
            idea.created_at = created_at
        self.append("thesis_created", {
            "id": idea.id,
            "created_at": idea.created_at,
            "thesis": thesis,
            "status": idea.status,
            "off_plan": off_plan,
            "label": label,
            "account_id": account_id,
        })
        return idea

    # --- le trade vivant -----------------------------------------------------

    def open_trade(self, idea_id: str, trade: OpenTrade) -> OpenTrade:
        """
        Déclare l'ouverture d'un ticket. L'idée passe « en cours ».

        C'est le seul moment où le stop RÉELLEMENT placé peut être enregistré :
        dès le premier déplacement, le broker l'aura écrasé pour toujours.
        """
        self.append("trade_opened", {"idea_id": idea_id, "trade": trade})
        return trade

    def update_trade(self, uid: str, **champs):
        """
        Met à jour un trade en cours : stop déplacé, cours saisi, note.

        Les cours saisis sont horodatés et n'engagent que toi : l'outil n'a
        aucun flux de prix, et ne prétend pas en avoir.
        """
        self.append("trade_updated", {"uid": uid, **champs})

    def cancel_trade(self, uid: str, reason: str = ""):
        """Ticket déclaré par erreur (faute de frappe, ordre jamais exécuté)."""
        self.append("trade_cancelled", {"uid": uid, "reason": reason})

    # --- les captures --------------------------------------------------------

    def add_capture(self, attachment: Attachment) -> Attachment:
        self.append("capture_added", {"attachment": attachment})
        return attachment

    def remove_capture(self, attachment_id: str):
        """
        Retire une capture de l'affichage.

        Le FICHIER n'est pas effacé : le journal est append-only, et une image
        supprimée par erreur ne se reconstitue pas. Elle disparaît de l'écran,
        elle reste sur le disque.
        """
        self.append("capture_removed", {"id": attachment_id})

    def update_thesis(self, idea_id: str, thesis: Thesis, label: Optional[str] = None):
        self.append("thesis_updated",
                    {"id": idea_id, "thesis": thesis, "label": label})

    def abandon(self, idea_id: str):
        self.append("idea_abandoned", {"id": idea_id})

    def import_report(self, positions: list[Position],
                      deals: list[Deal]) -> list[Position]:
        """
        Idempotent : une position ou une transaction déjà connue n'est jamais
        réimportée. Tu peux déposer dix fois le même fichier, ou un fichier plus
        large qui recouvre l'ancien — rien ne bouge.
        """
        _, known_pos, known_deals = self.load()
        known_deal_ids = {d.deal_id for d in known_deals}

        fresh = [p for p in positions if p.uid not in known_pos]
        for p in fresh:
            self.append("position_imported", p)

        for d in deals:
            if d.deal_id not in known_deal_ids:
                self.append("deal_imported", d)

        return fresh

    def link(self, idea_id: str, position_uid: str):
        self.append("position_linked",
                    {"idea_id": idea_id, "position_uid": position_uid})

    def mark_late(self, idea_id: str, late: bool = True):
        """La thèse a été écrite après le trade — rattachable, mais signalée."""
        self.append("idea_marked_late", {"id": idea_id, "late": late})

    def unlink(self, idea_id: str, position_uid: str):
        self.append("position_unlinked",
                    {"idea_id": idea_id, "position_uid": position_uid})

    def set_secured(self, idea_id: str, position_uid: str, secured: bool):
        """
        « Quand j'ai ouvert ce renforcement, mon noyau était-il déjà au breakeven ? »

        Répondu à chaud, au moment de l'appariement. Sans réponse, l'outil suppose
        le pire et affiche un majorant plutôt qu'une mesure.
        """
        self.append("add_secured", {"idea_id": idea_id,
                                    "position_uid": position_uid,
                                    "secured": secured})

    def complete_review(self, idea_id: str, review: Review):
        self.append("review_completed", {"id": idea_id, "review": review})

    # --- thèses macro (optionnelles)

    def campaigns(self) -> dict[str, Campaign]:
        self.load()
        return getattr(self, "_campaigns", {})

    def create_campaign(self, campaign: Campaign) -> Campaign:
        self.append("campaign_created", campaign)
        return campaign

    def update_campaign(self, campaign: Campaign):
        self.append("campaign_updated", campaign)

    def abandon_campaign(self, campaign_id: str, correct: Optional[bool] = None):
        """
        Abandonne une THÈSE (macro). Marquée, jamais effacée — le journal est
        append-only, et une thèse abandonnée reste une donnée.

        `correct` : review d'abandon simplifiée — le marché a-t-il fini par
        donner raison à la thèse ? None = indécis / non jugé. Elle alimente la
        métrique « thèses abandonnées : justesse ».
        """
        self.append("campaign_abandoned", {"id": campaign_id, "correct": correct})

    def review_missed(self, idea_id: str, review: MissedReview):
        """
        Review d'une idée armée puis jamais exécutée.

        La question n'est pas « avais-je raison » mais « ai-je eu l'occasion » :
        un setup qui ne s'est jamais présenté ne dit rien de toi, une hésitation
        devant un setup valide dit tout.
        """
        self.append("idea_missed", {"id": idea_id, "review": review})

    def attach(self, idea_id: str, campaign_id: str):
        self.append("idea_attached",
                    {"idea_id": idea_id, "campaign_id": campaign_id})

    def detach(self, idea_id: str):
        self.append("idea_detached", {"idea_id": idea_id})

    # --- stops saisis à la main

    def set_ticket_stop(self, idea_id: str, position_uid: str, stop: Decimal,
                        evidence: StopEvidence = StopEvidence.CAPTURE):
        """
        Le stop d'origine d'un ticket, quand MT5 l'a perdu.

        Sans lui, un seul ticket indéterminable fait disparaître le R de l'idée
        entière. Avec lui, tu combles le trou.

        `evidence` dit d'où vient le chiffre — capture du ticket (pré-engagé) ou
        souvenir (reconstitué). Ce n'est pas une suspicion sur ta parole : c'est la
        seule information qui permette à l'outil de savoir ce qu'il peut prouver.
        """
        self.append("ticket_stop_set", {"idea_id": idea_id,
                                        "position_uid": position_uid,
                                        "stop": stop,
                                        "evidence": evidence})

    # --- exploitation

    def pending_trades(self) -> dict[str, tuple[str, OpenTrade]]:
        """
        Tous les trades déclarés ouverts et non encore clôturés.

        Clé : le NUMÉRO DE TICKET. C'est la clé de rapprochement de l'import —
        pas le symbole, pas l'heure, pas une heuristique. Un ticket est unique
        et sort du terminal : il ne se trompe jamais.
        """
        ideas, _, _ = self.load()
        out: dict[str, tuple[str, OpenTrade]] = {}
        for idea in ideas.values():
            for tr in idea.open_trades:
                out[tr.ticket] = (idea.id, tr)
        return out

    def orphans(self) -> list[Position]:
        """Positions importées, rattachées à aucune idée. À traiter."""
        ideas, positions, _ = self.load()
        linked = {u for i in ideas.values() for u in i.position_uids}
        return [p for uid, p in positions.items() if uid not in linked]

    def backup(self) -> Path:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        dest = self.path.with_suffix(f".{stamp}.bak")
        if self.path.exists():
            shutil.copy2(self.path, dest)
        return dest
