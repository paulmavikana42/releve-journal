import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Callback OAuth : échange le code contre une session (cookies), puis redirige.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // "/" décide de la 1re page selon que le compte est réglé ou non (nouvel
  // utilisateur → Réglages, sinon → Tableau de bord).
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
