import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/app/journal/data";
import { betaStatus, isMember } from "@/lib/beta";

// Page de fin : l'utilisateur s'est mis en attente. Message rassurant + retour landing.
export default async function WaitlistOkPage() {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const status = await betaStatus(supabase);
  if (isMember(status)) redirect("/dashboard"); // promu entre-temps
  if (status !== "waitlisted") redirect("/complet");

  return (
    <main className="wrap gate">
      <div className="card gate-card">
        <div className="gate-check" aria-hidden>✓</div>
        <div className="eyebrow" style={{ color: "var(--gain)" }}>c&apos;est noté</div>
        <h1 className="gate-title">Tu es sur la liste d&apos;attente.</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Tout s&apos;est bien passé. Dès qu&apos;une place se libère, on t&apos;ouvre l&apos;accès et
          tu es prévenu par e-mail à <b>{user.email ?? "ton adresse"}</b>. Rien d&apos;autre à faire de ton côté.
        </p>
        <p className="note" style={{ marginBottom: 18 }}>
          Merci de ta patience — la première vague est volontairement petite pour bien accompagner
          chaque testeur.
        </p>
        <Link href="/" className="primary gate-cta">Retour à l&apos;accueil</Link>
      </div>
    </main>
  );
}
