// Les variables publiques Supabase (clé publiable, sécurisée par la RLS — jamais
// la service_role). On NE lève PAS à l'import : sinon le build Next casse en
// évaluant les modules pendant « Collecting page data ». La vérification se fait
// à l'exécution, quand un client est réellement créé.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Renvoie url+clé, ou lève un message clair — appelé à l'exécution seulement. */
export function supabaseEnv(): { url: string; key: string } {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY doivent être définis " +
        "(local : apps/web/.env.local ; en ligne : Vercel → Settings → Environment Variables).",
    );
  }
  return { url: SUPABASE_URL, key: SUPABASE_KEY };
}
