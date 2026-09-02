// Client Supabase côté NAVIGATEUR (composants client). Sert surtout au login
// OAuth ; toute la donnée métier passe par le serveur (RLS + SupabaseStore).
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

export function createClient() {
  return createBrowserClient(SUPABASE_URL!, SUPABASE_KEY!);
}
