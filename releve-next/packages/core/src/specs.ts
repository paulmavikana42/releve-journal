// Valeur du point apprise depuis les trades — port de core/specs.py.
//
//   pv = profit_brut / (volume × déplacement_prix)
//
// Aucune table de specs. Deux subtilités : l'ARRONDI MT5 (on « snappe » vers la
// valeur propre proche) et les PAIRES JPY (valeur du point variable → on garde
// la valeur déduite position par position, le carnet ne sert que de repli).
import { Decimal } from "./decimal";
import type { Position, SpecBookLike } from "./models";

// Valeurs « propres » vers lesquelles snapper si on en est très proche.
const CLEAN = [
  new Decimal("0.01"),
  new Decimal("0.1"),
  new Decimal("1"),
  new Decimal("10"),
  new Decimal("100"),
  new Decimal("1000"),
  new Decimal("100000"),
];

// Tolérance relative : au-delà, on ne snappe pas (vraie valeur exotique).
const SNAP_TOL = new Decimal("0.001"); // 0.1 %

export function snap(pv: Decimal): Decimal {
  for (const c of CLEAN) {
    if (c.isZero()) continue;
    if (pv.minus(c).abs().div(c).lte(SNAP_TOL)) return c;
  }
  return pv;
}

function median(sorted: Decimal[]): Decimal {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid]!;
  return sorted[mid - 1]!.plus(sorted[mid]!).div(2);
}

export class SymbolSpec {
  constructor(
    readonly symbol: string,
    readonly point_value: Decimal, // médiane, snappée
    readonly samples: number,
    readonly dispersion: Decimal, // écart max/min relatif
  ) {}

  /** Dispersion forte = valeur du point variable (paires JPY typiquement). */
  get is_stable(): boolean {
    return this.dispersion.lt("0.01");
  }
}

export class SpecBook implements SpecBookLike {
  private specs = new Map<string, SymbolSpec>();

  constructor(positions: readonly Position[] = []) {
    if (positions.length) this.learn(positions);
  }

  learn(positions: readonly Position[]): this {
    const bySymbol = new Map<string, Decimal[]>();
    for (const p of positions) {
      const pv = p.point_value;
      if (pv !== null && pv.gt(0)) {
        const arr = bySymbol.get(p.symbol) ?? [];
        arr.push(pv);
        bySymbol.set(p.symbol, arr);
      }
    }
    for (const [sym, pvs] of bySymbol) {
      const sorted = [...pvs].sort((a, b) => a.cmp(b));
      const med = median(sorted);
      const lo = sorted[0]!;
      const hi = sorted[sorted.length - 1]!;
      const disp = med.isZero() ? new Decimal(0) : hi.minus(lo).div(med);
      this.specs.set(sym, new SymbolSpec(sym, snap(med), pvs.length, disp));
    }
    return this;
  }

  get(symbol: string): SymbolSpec | null {
    return this.specs.get(symbol) ?? null;
  }

  /** Valeur du point pour un SYMBOLE, sans position pour la déduire (trades ouverts). */
  point_value_for(symbol: string): Decimal | null {
    const spec = this.specs.get((symbol || "").toUpperCase()) ?? this.specs.get(symbol);
    return spec ? spec.point_value : null;
  }

  /** Valeur du point pour CETTE position : priorité à la valeur déduite d'elle-même. */
  point_value(position: Position): Decimal | null {
    const own = position.point_value;
    if (own !== null && own.gt(0)) {
      const spec = this.specs.get(position.symbol);
      // Symbole stable -> médiane snappée, plus propre qu'un trade isolé bruité.
      if (spec && spec.is_stable) return spec.point_value;
      return own;
    }
    const spec = this.specs.get(position.symbol);
    return spec ? spec.point_value : null;
  }

  get size(): number {
    return this.specs.size;
  }
}
