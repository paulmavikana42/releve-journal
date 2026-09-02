// Les variables publiques Supabase, lues une fois et vérifiées. La clé est
// publiable (sécurisée par la RLS côté base) — jamais la service_role ici.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY doivent être définis (voir apps/web/.env.local).",
  );
}
