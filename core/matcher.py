"""
Appariement position MT5 -> idée.

L'outil PROPOSE. Tu DÉCIDES. Rien n'est jamais fusionné sans ton clic — deux
thèses distinctes sur le même instrument peuvent se chevaucher par hasard, et
une fusion à tort pollue définitivement tes statistiques.

Une position sans idée candidate n'est pas une erreur : c'est un trade que tu
n'avais pas écrit. On l'appelle HORS-PLAN, et c'est une métrique à part entière.

--- L'ANTÉRIORITÉ : un drapeau, plus un mur -------------------------------

Le principe « la thèse précède le trade » reste le cœur de l'outil : une thèse
écrite AVANT l'entrée est une prédiction ; écrite après, c'est une justification.

Mais l'antériorité STRICTE punit un cas parfaitement légitime : tu trades le
matin, tu journalises le soir. Ta thèse existait dans ta tête, tu ne l'as
saisie qu'après. La rejeter te classerait le trade en hors-plan à tort.

Donc : une thèse postérieure au trade reste RATTACHABLE, mais le candidat est
marqué `late`. Tu gardes la mécanique — les thèses réellement écrites avant
comptent comme des prédictions, les tardives sont signalées comme telles et
n'usurpent pas ce statut. Tu perds seulement le blocage.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal

from .models import Idea, IdeaStatus, Position

# Fenêtre de tolérance autour d'un trade pour qu'une thèse en soit candidate.
# 30 jours : large, pour absorber un rythme irrégulier (études, journalisation
# différée) sans rapprocher par erreur deux thèses vraiment distinctes.
DEFAULT_WINDOW = timedelta(days=30)


@dataclass
class Candidate:
    idea: Idea
    score: float
    reason: str
    late: bool = False          # thèse écrite APRÈS le trade : rattachable, signalée
    # "execution"  premier ticket de l'idée
    # "add"        renforcement : nouvelle entrée pendant que l'idée vit
    # "fragment"   morceau du noyau : même heure ET même prix qu'un ticket déjà
    #              rattaché — une sortie partielle scinde la position en deux
    #              lignes. Ce n'est PAS un add : rien à saisir, il hérite du stop
    #              du noyau. Le confondre avec un add faussait l'exposition.
    kind: str = "execution"

    @property
    def is_add(self) -> bool:
        return self.kind == "add"

    @property
    def is_fragment(self) -> bool:
        """Un fragment de noyau (sortie partielle), pas un renforcement."""
        return self.kind == "fragment"


def candidates(position: Position, ideas: list[Idea],
               window: timedelta = DEFAULT_WINDOW) -> list[Candidate]:
    """
    Idées plausibles pour cette position, les plus probables d'abord.

    Critères DURS (éliminatoires) :
      - même symbole
      - même sens
      - idée non abandonnée, non revue
      - dans la fenêtre de tolérance temporelle
      - si l'idée a déjà des tickets : le nouveau doit s'ouvrir PENDANT qu'au
        moins un d'entre eux est encore ouvert. Sinon ce n'est pas un
        renforcement, c'est un autre trade — donc une autre idée.

    Critère SOUPLE (signalé, non éliminatoire) :
      - la thèse a-t-elle été écrite avant ou après le trade ? (`late`)
    """
    out: list[Candidate] = []

    # --- LE TICKET DÉCLARÉ TRANCHE, ET IL TRANCHE SEUL ------------------
    # Si tu as déclaré ce numéro de ticket à l'ouverture, il n'y a plus rien à
    # deviner : c'est un fait, pas une ressemblance. Aucun autre critère — ni le
    # prix, ni l'heure — n'a le droit de le contredire, et aucune autre idée
    # n'est proposée.
    #
    # Ce chemin sert quand le rapprochement automatique n'a pas eu lieu : ticket
    # importé avant d'avoir été déclaré, numéro de compte différent entre
    # l'export et la déclaration, ou rattachement défait à la main.
    declarees = [i for i in ideas
                 if any(o.ticket == position.position_id for o in i.open_trades)]
    if declarees:
        return [Candidate(idea=i, score=100.0,
                          reason="tu as déclaré ce numéro de ticket à l'ouverture",
                          late=False)
                for i in declarees]

    for idea in ideas:
        if idea.status in (IdeaStatus.ABANDONED, IdeaStatus.REVIEWED):
            continue
        if idea.thesis is None:
            continue
        if idea.thesis.instrument.upper() != position.symbol.upper():
            continue
        if idea.thesis.direction != position.direction:
            continue

        # Les deux dates vivent dans le même référentiel : heure serveur, sans
        # fuseau (voir core/clock.py).
        created = idea.created_at
        opened = position.open_time

        # ANTÉRIORITÉ : un drapeau, pas une élimination.
        late = created > opened
        gap = abs((opened - created).total_seconds())

        # Hors fenêtre dans les DEUX sens : là, on élimine (thèse sans rapport).
        if gap > window.total_seconds() and not idea.positions:
            continue

        # Scoring : plus la thèse est proche du trade, plus elle est probable.
        # Une thèse tardive est pénalisée, mais reste candidate.
        score = 1.0 / (1.0 + gap / 86400)
        if late:
            score *= 0.5

        if idea.positions:
            # --- UN RENFORCEMENT S'OUVRE PENDANT QUE L'IDÉE VIT ---------
            #
            # C'est la règle qui manquait, et son absence a coûté cher : deux
            # trades du même instrument, l'un clôturé au breakeven le vendredi
            # matin, l'autre ouvert le vendredi après-midi, se retrouvaient dans
            # la MÊME idée — le second passant pour un « add » du premier.
            #
            # Conséquences : le risque de l'idée additionnait deux paris
            # indépendants, le R devenait faux, et la conviction déclarée sur la
            # seconde idée (3/5) disparaissait au profit de la première (5/5).
            #
            # Le critère est objectif, pas heuristique : un renforcement est un
            # ticket ouvert ALORS QU'UN AUTRE TICKET DE L'IDÉE EST ENCORE
            # OUVERT. Si tous étaient déjà clos, c'est un nouveau trade — donc
            # une nouvelle idée, avec sa propre thèse et sa propre conviction.
            chevauche = any(p.open_time <= opened <= p.close_time
                            for p in idea.positions)
            if not chevauche:
                continue

            # --- FRAGMENT DE NOYAU vs VRAI RENFORCEMENT ------------------
            # Une sortie partielle scinde la position en deux lignes qui
            # partagent la MÊME heure et le MÊME prix d'entrée : la moitié
            # sortie tôt, et le reste. La seconde ligne a un autre numéro de
            # ticket (que tu n'as pas déclaré), donc elle arrive ici — mais ce
            # n'est pas un renforcement, c'est le même engagement, pris au même
            # instant, au même prix.
            #
            # Le confondre avec un add était une faute silencieuse : l'assistant
            # réclamait un stop d'add et proposait la case « noyau au breakeven »
            # (cochée par défaut). Un simple clic mettait le noyau à zéro dans le
            # calcul d'exposition simultanée — 120 affiché au lieu de 240. C'est
            # la seule direction d'erreur que l'outil s'interdit.
            #
            # Le test est celui des métriques (est_du_noyau) : même heure ET même
            # prix qu'un ticket DÉJÀ rattaché. Un vrai add en diffère toujours.
            fragment = any(p.open_time == opened and p.open_price == position.open_price
                           for p in idea.positions)
            score += 1.0
            if fragment:
                out.append(Candidate(
                    idea=idea, score=score + 0.5, late=late, kind="fragment",
                    reason="même entrée qu'un ticket de cette idée — "
                           "sortie partielle du noyau, rien à saisir"))
                continue
            reason = (f"s'ouvre pendant que {len(idea.positions)} ticket(s) de "
                      f"cette idée sont encore en cours")
        else:
            jours = int(gap // 86400)
            reason = (f"idée écrite {jours} j après le trade" if late
                      else f"idée armée {jours} j avant le trade")

            # --- LE PRIX D'ENTRÉE DÉPARTAGE ------------------------------
            # Deux idées armées sur le même instrument et le même sens, écrites
            # à quelques heures d'écart, obtiennent des scores temporels
            # quasi identiques : l'ordre proposé devient arbitraire, et c'est
            # l'humain fatigué qui tranche à la place de la donnée.
            #
            # Or l'entrée VISÉE de chaque idée est écrite noir sur blanc, et
            # celle du ticket est un fait. Quand les deux coïncident à 0,5 %
            # près, le doute n'existe plus.
            #
            # Indice de CLASSEMENT, jamais d'élimination : entrer loin de son
            # prix visé reste une exécution valable, et souvent la plus
            # instructive.
            vise = idea.thesis.entry_planned
            if vise and position.open_price and vise > 0:
                ecart = abs(position.open_price - vise) / vise
                if ecart <= Decimal("0.005"):
                    score += 1.5
                    reason += f" · entrée à {float(ecart) * 100:.2f} % du prix visé"

        kind = "add" if idea.positions else "execution"
        out.append(Candidate(idea=idea, score=score, reason=reason, late=late,
                             kind=kind))

    return sorted(out, key=lambda c: c.score, reverse=True)


def best(position: Position, ideas: list[Idea]) -> Candidate | None:
    c = candidates(position, ideas)
    return c[0] if c else None
