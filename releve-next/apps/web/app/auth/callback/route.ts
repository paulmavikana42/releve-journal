import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { claimSeat, isMember } from "@/lib/beta";

// Callback OAuth : échange le code contre une session (cookies), réclame un siège
// bêta si une place est libre, puis route : membre → l'app, complet → /complet.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const res = await claimSeat(supabase);
      // membre/granted → l'app ("/" oriente réglages/dashboard) ; sinon page complet.
      const dest = isMember(res) ? "/" : "/complet";
      return NextResponse.redirect(`${origin}${dest}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
