import "server-only";
import {
  SupabaseStore,
  supabaseBackend,
  type SupabaseClientLike,
} from "@releve/core";
import { createClient } from "@/lib/supabase/server";

/** Le client Supabase serveur + l'utilisateur courant (ou null). */
export async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * Ouvre un SupabaseStore pour l'utilisateur : hydrate son journal depuis la
 * table `events` (RLS → seules SES lignes reviennent). Le client supabase-js
 * satisfait structurellement SupabaseClientLike (from/select/order/insert).
 */
export async function openStore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const backend = supabaseBackend(supabase as unknown as SupabaseClientLike, userId);
  return SupabaseStore.open(backend);
}
