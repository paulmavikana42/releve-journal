import "server-only";
import { PropRules } from "@releve/core";
import { createClient } from "@/lib/supabase/server";

type SettingsData = {
  accounts?: Record<string, unknown>[];
  active_uid?: string;
};

async function readRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<SettingsData> {
  const { data } = await supabase
    .from("settings")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  return ((data?.data as SettingsData) ?? {}) as SettingsData;
}

/** Les comptes déclarés par l'utilisateur (vide s'il n'a rien configuré). */
export async function getAccounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<PropRules[]> {
  const row = await readRow(supabase, userId);
  return (row.accounts ?? []).map((a) => PropRules.from_dict(a));
}

/** Le compte actif, ou null si aucun compte n'a été configuré (décision [U]). */
export async function getActiveAccount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<PropRules | null> {
  const row = await readRow(supabase, userId);
  const accounts = (row.accounts ?? []).map((a) => PropRules.from_dict(a));
  if (!accounts.length) return null;
  return accounts.find((a) => a.uid === row.active_uid) ?? accounts[0]!;
}

/** Enregistre/remplace le compte (une seule fiche pour l'instant). */
export async function saveAccount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  rules: PropRules,
): Promise<void> {
  const data: SettingsData = { accounts: [rules.to_dict()], active_uid: rules.uid };
  const { error } = await supabase
    .from("settings")
    .upsert({ user_id: userId, data, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Enregistrement des réglages : ${error.message}`);
}
