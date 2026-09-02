"use client";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  async function signIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <main className="wrap">
      <div className="card" style={{ maxWidth: 420, margin: "12vh auto", textAlign: "center" }}>
        <h1 style={{ marginTop: 0 }}>
          Relev<span style={{ color: "var(--accent)" }}>é</span>
        </h1>
        <p className="muted">Un journal de trading qui peut te contredire.</p>
        <button className="primary" onClick={signIn} style={{ marginTop: 12 }}>
          Se connecter avec Google
        </button>
      </div>
    </main>
  );
}
