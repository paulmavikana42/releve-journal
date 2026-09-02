// L'horloge — port de core/clock.py.
//
// Règle : tout le domaine vit en HEURE SERVEUR (UTC + offset), sans fuseau. En
// TypeScript, une Date est toujours un instant epoch ; on adopte la convention
// « les CHAMPS UTC d'une Date du domaine portent l'heure-mur serveur » (le parser
// construit ses dates via Date.UTC, cf. parser.ts). Les fonctions calendaires
// lisent donc getUTC*, ce qui reproduit exactement .date()/.weekday() de Python.
//
// L'offset serveur est découplé du fichier de réglages (le core reste pur) : la
// couche Node l'injecte au démarrage via setServerUtcOffset().

export const DEFAULT_SERVER_UTC_OFFSET = 3; // FundedNext = UTC+3

let _serverUtcOffset = DEFAULT_SERVER_UTC_OFFSET;

export function serverUtcOffset(): number {
  return _serverUtcOffset;
}

export function setServerUtcOffset(hours: number): void {
  _serverUtcOffset = Math.trunc(hours);
}

/** L'instant présent dans le référentiel du broker (champs UTC = heure serveur). */
export function serverNow(): Date {
  return new Date(Date.now() + _serverUtcOffset * 3_600_000);
}

/**
 * Normalise une date vers le référentiel serveur. Le store passe des instants
 * UTC (le champ `ts` des événements, ou d'anciennes dates horodatées) : on les
 * décale de l'offset pour que leurs champs UTC portent l'heure-mur serveur.
 * (La sémantique fine de migration sera reprise avec le port du store.)
 */
export function toServerNaive(dt: Date | null): Date | null {
  if (dt === null) return null;
  return new Date(dt.getTime() + _serverUtcOffset * 3_600_000);
}

// --------------------------------------------------------- jours ouvrés

// Une idée armée a au plus 5 JOURS OUVRÉS pour se réaliser (jamais de position
// le week-end).
export const REVIEW_WINDOW_BUSINESS_DAYS = 5;

/**
 * Jours ouvrés écoulés entre deux instants, week-ends exclus.
 *
 * TOUJOURS >= 0 : si `end <= start`, renvoie 0 (jamais un négatif) — c'est ce
 * que supposent ses deux appelants, `reviewDue` (comparaison à un seuil) et
 * `businessDaysLeft` (max(0, WINDOW - used)). Port de la version conservée de
 * core/clock.py (le doublon qui renvoyait un négatif a été supprimé côté Python).
 */
export function businessDaysBetween(start: Date, end: Date): number {
  if (end.getTime() <= start.getTime()) return 0;
  // Travailler en dates calendaires UTC (jour entier), comme .date() en Python.
  let cur = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  let days = 0;
  while (cur < last) {
    cur += 86_400_000;
    const wd = new Date(cur).getUTCDay(); // 0=dim … 6=sam
    if (wd >= 1 && wd <= 5) days += 1; // lundi..vendredi
  }
  return days;
}

export function reviewDue(armedAt: Date, now?: Date): boolean {
  const n = now ?? serverNow();
  return businessDaysBetween(armedAt, n) >= REVIEW_WINDOW_BUSINESS_DAYS;
}

export function businessDaysLeft(armedAt: Date, now?: Date): number {
  const n = now ?? serverNow();
  const used = businessDaysBetween(armedAt, n);
  return Math.max(0, REVIEW_WINDOW_BUSINESS_DAYS - used);
}
