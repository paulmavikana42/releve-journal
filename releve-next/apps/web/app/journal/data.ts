import "server-only";
import {
  SupabaseStore,
  supabaseBackend,
  type Attachment,
  type SupabaseClientLike,
} from "@releve/core";
import { createClient } from "@/lib/supabase/server";

/** URLs signées (bucket privé) pour afficher les captures non retirées. */
export async function signedCaptureUrls(
  supabase: Awaited<ReturnType<typeof createClient>>,
  attachments: readonly Attachment[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const active = attachments.filter((a) => !a.removed);
  if (!active.length) return out;
  const { data } = await supabase.storage
    .from("captures")
    .createSignedUrls(active.map((a) => a.path), 3600);
  if (data) {
    data.forEach((d: { signedUrl?: string | null }, i: number) => {
      if (d.signedUrl) out.set(active[i]!.id, d.signedUrl);
    });
  }
  return out;
}

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
