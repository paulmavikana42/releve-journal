// Le registre des symboles — port de core/symbols.py.
//
// Le broker fait foi : jamais de saisie libre, on choisit dans une liste (la
// watchlist saisie une fois + tout symbole vu à l'import, appris sans condition).
import * as settings from "./settings";

export const DEFAULT_WATCHLIST = [
  "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "NDX100",
  "SPX500", "US30", "USOUSD", "UKOUSD", "XAUUSD",
];

export function watchlist(): string[] {
  const lst = settings.read()["watchlist"] as string[] | undefined;
  if (!lst || lst.length === 0) return [...DEFAULT_WATCHLIST];
  return lst.map((s) => s.toUpperCase());
}

export function setWatchlist(symbols: Iterable<string>): void {
  const cleaned = new Set(
    [...symbols].map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0),
  );
  settings.set("watchlist", [...cleaned].sort());
}

export function learn(symbols: Iterable<string>): string[] {
  const current = new Set(watchlist());
  const incoming = new Set(
    [...symbols].map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0),
  );
  const fresh = [...incoming].filter((s) => !current.has(s)).sort();
  if (fresh.length) setWatchlist(new Set([...current, ...fresh]));
  return fresh;
}

export function known(positions: readonly { symbol?: string }[] = []): string[] {
  const out = new Set(watchlist());
  for (const p of positions) {
    if (p.symbol) out.add(p.symbol.toUpperCase());
  }
  return [...out].sort();
}
