import "server-only";
import { PropRules } from "@releve/core";
import { createClient } from "@/lib/supabase/server";

type SettingsData = {
  accounts?: Record<string, unknown>[];
  active_uid?: string;
  watchlist?: string[];
};

// Watchlist MT5 par défaut (miroir de core/symbols.DEFAULT_WATCHLIST), inline
// pour ne pas tirer le module fs de core dans l'app.
export const DEFAULT_WATCHLIST = [
  "EURUSD", "GBPUSD", "USDJPY", "BTCUSD", "NDX100",
  "SPX500", "US30", "USOUSD", "UKOUSD", "XAUUSD",
];

type Client = Awaited<ReturnType<typeof createClient>>;

async function readRow(supabase: Client, userId: string): Promise<SettingsData> {
  const { data } = await supabase.from("settings").select("data").eq("user_id", userId).maybeSingle();
  return ((data?.data as SettingsData) ?? {}) as SettingsData;
}

/** Fusionne un patch dans les réglages existants (ne perd jamais le reste). */
async function writeData(supabase: Client, userId: string, patch: Partial<SettingsData>): Promise<void> {
  const current = await readRow(supabase, userId);
  const data = { ...current, ...patch };
  const { error } = await supabase
    .from("settings")
    .upsert({ user_id: userId, data, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Enregistrement des réglages : ${error.message}`);
}

// ---------------------------------------------------------------- comptes

export async function getAccounts(supabase: Client, userId: string): Promise<PropRules[]> {
  const row = await readRow(supabase, userId);
  return (row.accounts ?? []).map((a) => PropRules.from_dict(a));
}

export async function getActiveAccount(supabase: Client, userId: string): Promise<PropRules | null> {
  const row = await readRow(supabase, userId);
  const accounts = (row.accounts ?? []).map((a) => PropRules.from_dict(a));
  if (!accounts.length) return null;
  return accounts.find((a) => a.uid === row.active_uid) ?? accounts[0]!;
}

/** Ajoute ou remplace un compte (par uid), sans toucher aux autres réglages. */
export async function saveAccount(supabase: Client, userId: string, rules: PropRules): Promise<void> {
  const row = await readRow(supabase, userId);
  const accounts = (row.accounts ?? []).map((a) => PropRules.from_dict(a));
  const idx = accounts.findIndex((a) => a.uid === rules.uid);
  if (idx >= 0) accounts[idx] = rules;
  else accounts.push(rules);
  await writeData(supabase, userId, {
    accounts: accounts.map((a) => a.to_dict()),
    active_uid: rules.uid,
  });
}

export async function setActiveAccount(supabase: Client, userId: string, uid: string): Promise<void> {
  await writeData(supabase, userId, { active_uid: uid });
}

export async function removeAccount(supabase: Client, userId: string, uid: string): Promise<void> {
  const row = await readRow(supabase, userId);
  const accounts = (row.accounts ?? []).filter((a) => a["uid"] !== uid);
  const active = row.active_uid === uid ? (accounts[0]?.["uid"] as string | undefined) : row.active_uid;
  await writeData(supabase, userId, { accounts, active_uid: active });
}

// ---------------------------------------------------------------- watchlist

export async function getWatchlist(supabase: Client, userId: string): Promise<string[]> {
  const row = await readRow(supabase, userId);
  const w = row.watchlist;
  return (w && w.length ? w : DEFAULT_WATCHLIST).map((s) => s.toUpperCase());
}

export async function setWatchlist(supabase: Client, userId: string, symbols: Iterable<string>): Promise<void> {
  const cleaned = [...new Set([...symbols].map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
  await writeData(supabase, userId, { watchlist: cleaned });
}

/** Apprend des symboles vus à l'import (le broker fait foi) — merge sans doublon. */
export async function learnSymbols(supabase: Client, userId: string, symbols: Iterable<string>): Promise<void> {
  const row = await readRow(supabase, userId);
  const current = new Set((row.watchlist ?? DEFAULT_WATCHLIST).map((s) => s.toUpperCase()));
  let added = false;
  for (const s of symbols) {
    const u = s.trim().toUpperCase();
    if (u && !current.has(u)) {
      current.add(u);
      added = true;
    }
  }
  if (added) await writeData(supabase, userId, { watchlist: [...current].sort() });
}
