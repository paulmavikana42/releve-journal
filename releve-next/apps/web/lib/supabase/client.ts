// Client Supabase côté NAVIGATEUR (composants client). Sert surtout au login
// OAuth ; toute la donnée métier passe par le serveur (RLS + SupabaseStore).
import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

export function createClient() {
  const { url, key } = supabaseEnv();
  return createBrowserClient(url, key);
}
