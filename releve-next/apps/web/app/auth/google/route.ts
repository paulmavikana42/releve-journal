import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Démarre la connexion Google (OAuth Supabase) et redirige vers Google.
// Le bouton « Continuer avec Google » des pages publiques pointe ici.
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error || !data?.url) {
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }
  return NextResponse.redirect(data.url);
}
