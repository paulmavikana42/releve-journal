// Client Supabase côté SERVEUR (composants serveur, actions, route handlers).
// Lie la session à des cookies via @supabase/ssr. Next 15 : cookies() est async.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL!, SUPABASE_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        // Dans un composant serveur pur, l'écriture de cookies lève : c'est le
        // middleware qui rafraîchit la session, donc on ignore sans risque.
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          /* appelé depuis un Server Component : ignoré */
        }
      },
    },
  });
}
