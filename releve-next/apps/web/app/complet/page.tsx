import { redirect } from "next/navigation";
import { currentUser } from "@/app/journal/data";
import { betaStatus, claimSeat, isMember } from "@/lib/beta";
import { joinWaitlistAction } from "./actions";
import SubmitButton from "../components/SubmitButton";

// « Places occupées » : l'utilisateur est connecté mais la bêta est complète (10/10).
// À l'ouverture, on retente une attribution (une place a pu se libérer) ; sinon on
// propose de se mettre en attente.
export default async function CompletPage() {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const claim = await claimSeat(supabase);
  if (isMember(claim)) redirect("/dashboard");
  const status = await betaStatus(supabase);
  if (status === "waitlisted") redirect("/waitlist-ok");

  return (
    <main className="wrap gate">
      <div className="card gate-card">
        <div className="eyebrow" style={{ color: "var(--accent)" }}>bêta fermée · 10 / 10</div>
        <h1 className="gate-title">Les places de la bêta sont toutes prises.</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          On limite volontairement la première vague à <b>10 testeurs</b> pour les accompagner de près.
          Toutes les places sont occupées pour le moment.
        </p>
        <p className="note" style={{ marginBottom: 18 }}>
          Mets-toi en attente : dès qu&apos;une place se libère, tu y auras accès et tu seras prévenu
          par e-mail à <b>{user.email ?? "ton adresse"}</b>.
        </p>
        <form action={joinWaitlistAction}>
          <SubmitButton className="primary" pendingLabel="Enregistrement…">
            Se mettre en attente
          </SubmitButton>
        </form>
        <a href="/" className="gate-back">← Retour à l&apos;accueil</a>
      </div>
    </main>
  );
}
