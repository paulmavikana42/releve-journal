import "server-only";
import { cache } from "react";
import {
  MemoryBackend,
  SupabaseStore,
  supabaseBackend,
  type Attachment,
  type SupabaseClientLike,
} from "@releve/core";
import { createClient } from "@/lib/supabase/server";
import { DEV_PREVIEW, devEvents, devUser } from "@/lib/devPreview";

const devUrl = (p: string) => `/dev-capture/${p.split("/").map(encodeURIComponent).join("/")}`;

/** URLs signées (bucket privé) pour afficher les captures non retirées. Clé = id.
 *  En aperçu de dev, on sert les fichiers locaux via /dev-capture. */
export async function signedCaptureUrls(
  supabase: Awaited<ReturnType<typeof createClient>>,
  attachments: readonly Attachment[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const active = attachments.filter((a) => !a.removed);
  if (!active.length) return out;
  if (DEV_PREVIEW) {
    for (const a of active) out.set(a.id, devUrl(a.path));
    return out;
  }
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

/** URLs signées pour une liste de CHEMINS (images de blocs). Clé = chemin. */
export async function signedUrlsForPaths(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(paths.filter(Boolean))];
  if (!uniq.length) return out;
  if (DEV_PREVIEW) {
    for (const p of uniq) out.set(p, devUrl(p));
    return out;
  }
  const { data } = await supabase.storage.from("captures").createSignedUrls(uniq, 3600);
  if (data) {
    data.forEach((d: { signedUrl?: string | null }, i: number) => {
      if (d.signedUrl) out.set(uniq[i]!, d.signedUrl);
    });
  }
  return out;
}

/**
 * Le client Supabase serveur + l'utilisateur courant (ou null).
 * - `cache()` : appelé une seule fois par requête (dédup client + auth).
 * - `getSession()` (lecture cookie, SANS réseau) au lieu de `getUser()` : le
 *   middleware valide et rafraîchit déjà la session à chaque requête, donc on
 *   évite un aller-retour réseau par page.
 */
export const currentUser = cache(async () => {
  const supabase = await createClient();
  if (DEV_PREVIEW) return { supabase, user: devUser() };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user) return { supabase, user: session.user };
  // Repli (session absente du cookie) : validation réseau, évite une fausse
  // déconnexion.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
});

/**
 * Ouvre un SupabaseStore pour l'utilisateur : hydrate son journal depuis la
 * table `events` (RLS → seules SES lignes reviennent). Le client supabase-js
 * satisfait structurellement SupabaseClientLike (from/select/order/insert).
 */
export const openStore = cache(async function openStore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  // `cache()` : une seule hydratation du journal par requête, même si plusieurs
  // composants/serveurs l'ouvrent (même client + même userId → une seule liste).
  if (DEV_PREVIEW) {
    // Aperçu local : journal en mémoire alimenté par data/events.jsonl.
    return SupabaseStore.open(new MemoryBackend(devEvents(), "dev-preview"));
  }
  const backend = supabaseBackend(supabase as unknown as SupabaseClientLike, userId);
  return SupabaseStore.open(backend);
});
