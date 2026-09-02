// Les réglages : un seul fichier, data/settings.json — port de core/settings.py.
//
// Il CONFIGURE l'outil (décalage serveur, watchlist, comptes et règles), jamais
// ce qui le NOURRIT (idées, trades, captures → events.jsonl, append-only).
// Module Node (fs) : local/serveur uniquement.
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { settingsPath } from "./paths";
import { PropRules } from "./prop";

export function path(): string {
  // Résolu à CHAQUE appel, jamais figé à l'import (RELEVE_DATA peut changer).
  return settingsPath();
}

export function read(): Record<string, unknown> {
  const p = path();
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    } catch {
      // Un fichier corrompu ne doit jamais empêcher l'outil de démarrer.
      return {};
    }
  }
  return {};
}

export function write(data: Record<string, unknown>): void {
  const p = path();
  fs.mkdirSync(nodePath.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

export function get<T = unknown>(key: string, fallback: T | null = null): T | null {
  const v = read()[key];
  return v === undefined ? fallback : (v as T);
}

export function set(key: string, value: unknown): void {
  const data = read();
  data[key] = value;
  write(data);
}

// ---------------------------------------------------------------- les comptes
// (adossés au fichier ; en Python ils vivent dans prop.py, mais prop.ts reste
// pur pour ne pas tirer node:fs dans le bundle navigateur.)

export const DEFAULT_ACCOUNT = new PropRules({ account_id: "", label: "FundedNext" });

export function accounts(): PropRules[] {
  const raw = (get<Record<string, unknown>[]>("accounts") as Record<string, unknown>[]) || [];
  const out = raw.map((a) => PropRules.from_dict(a));
  // Rétrocompat : un compte d'avant l'uid n'en a pas ; from_dict en a généré un,
  // on le PERSISTE une fois pour qu'il reste stable (sinon le cloisonnement saute).
  if (out.length && raw.some((a) => !a["uid"])) {
    saveAccounts(out);
  }
  return out.length ? out : [DEFAULT_ACCOUNT];
}

export function saveAccounts(rules: readonly PropRules[]): void {
  set("accounts", rules.map((r) => r.to_dict()));
}

export function rulesForActive(accountId: string): PropRules {
  const accts = accounts();
  for (const a of accts) if (a.account_id === (accountId || "")) return a;
  return accts[0]!;
}
