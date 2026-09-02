// Appariement position MT5 -> idée — port de core/matcher.py.
//
// L'outil PROPOSE, l'humain DÉCIDE : rien n'est jamais fusionné sans un clic.
// Une position sans candidate n'est pas une erreur, c'est un trade HORS-PLAN.
// L'antériorité (thèse écrite avant/après le trade) est un DRAPEAU (`late`), pas
// un mur : on trade le matin, on journalise le soir.
import { Decimal } from "./decimal";
import { Idea, IdeaStatus, Position } from "./models";

// Fenêtre de tolérance : 30 jours. Large pour absorber une journalisation
// différée, sans rapprocher deux thèses vraiment distinctes.
export const DEFAULT_WINDOW_DAYS = 30;
const DAY_SECONDS = 86400;

export type CandidateKind = "execution" | "add" | "fragment";

export class Candidate {
  idea: Idea;
  score: number;
  reason: string;
  late: boolean;
  kind: CandidateKind;

  constructor(init: {
    idea: Idea;
    score: number;
    reason: string;
    late?: boolean;
    kind?: CandidateKind;
  }) {
    this.idea = init.idea;
    this.score = init.score;
    this.reason = init.reason;
    this.late = init.late ?? false;
    this.kind = init.kind ?? "execution";
  }

  get is_add(): boolean {
    return this.kind === "add";
  }

  /** Un fragment de noyau (sortie partielle), pas un renforcement. */
  get is_fragment(): boolean {
    return this.kind === "fragment";
  }
}

export function candidates(
  position: Position,
  ideas: readonly Idea[],
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Candidate[] {
  const out: Candidate[] = [];

  // LE TICKET DÉCLARÉ TRANCHE, ET IL TRANCHE SEUL. Aucun autre critère n'a le
  // droit de le contredire, aucune autre idée n'est proposée.
  const declarees = ideas.filter((i) =>
    i.open_trades.some((o) => o.ticket === position.position_id),
  );
  if (declarees.length) {
    return declarees.map(
      (i) =>
        new Candidate({
          idea: i,
          score: 100.0,
          reason: "tu as déclaré ce numéro de ticket à l'ouverture",
          late: false,
        }),
    );
  }

  const windowSeconds = windowDays * DAY_SECONDS;

  for (const idea of ideas) {
    if (idea.status === IdeaStatus.ABANDONED || idea.status === IdeaStatus.REVIEWED) continue;
    if (idea.thesis === null) continue;
    if (idea.thesis.instrument.toUpperCase() !== position.symbol.toUpperCase()) continue;
    if (idea.thesis.direction !== position.direction) continue;

    const created = idea.created_at;
    const opened = position.open_time;

    const late = created.getTime() > opened.getTime();
    const gap = Math.abs((opened.getTime() - created.getTime()) / 1000);

    // Hors fenêtre dans les DEUX sens : on élimine (thèse sans rapport).
    if (gap > windowSeconds && idea.positions.length === 0) continue;

    let score = 1.0 / (1.0 + gap / DAY_SECONDS);
    if (late) score *= 0.5;

    let reason: string;
    let kind: CandidateKind;

    if (idea.positions.length) {
      // UN RENFORCEMENT S'OUVRE PENDANT QUE L'IDÉE VIT — critère objectif : un
      // ticket ouvert alors qu'un autre de l'idée est ENCORE ouvert.
      const chevauche = idea.positions.some(
        (p) => p.open_time.getTime() <= opened.getTime() && opened.getTime() <= p.close_time.getTime(),
      );
      if (!chevauche) continue;

      // FRAGMENT DE NOYAU vs VRAI RENFORCEMENT : même heure ET même prix qu'un
      // ticket déjà rattaché = sortie partielle, pas un add.
      const fragment = idea.positions.some(
        (p) => p.open_time.getTime() === opened.getTime() && p.open_price.eq(position.open_price),
      );
      score += 1.0;
      if (fragment) {
        out.push(
          new Candidate({
            idea,
            score: score + 0.5,
            late,
            kind: "fragment",
            reason: "même entrée qu'un ticket de cette idée — sortie partielle du noyau, rien à saisir",
          }),
        );
        continue;
      }
      reason = `s'ouvre pendant que ${idea.positions.length} ticket(s) de cette idée sont encore en cours`;
      kind = "add";
    } else {
      const jours = Math.floor(gap / DAY_SECONDS);
      reason = late ? `idée écrite ${jours} j après le trade` : `idée armée ${jours} j avant le trade`;

      // LE PRIX D'ENTRÉE DÉPARTAGE — indice de classement, jamais d'élimination.
      const vise = idea.thesis.entry_planned;
      if (vise && position.open_price && vise.gt(0)) {
        const ecart = position.open_price.minus(vise).abs().div(vise);
        if (ecart.lte(new Decimal("0.005"))) {
          score += 1.5;
          reason += ` · entrée à ${(Number(ecart) * 100).toFixed(2)} % du prix visé`;
        }
      }
      kind = "execution";
    }

    out.push(new Candidate({ idea, score, reason, late, kind }));
  }

  return out.sort((a, b) => b.score - a.score);
}

export function best(position: Position, ideas: readonly Idea[]): Candidate | null {
  const c = candidates(position, ideas);
  return c.length ? c[0]! : null;
}
