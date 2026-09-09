// Accès bêta — helpers autour des fonctions Postgres (beta_status, claim_beta_seat,
// join_waitlist). Utilisés par le middleware, le callback OAuth et les pages /complet
// et /waitlist-ok. Pas de dépendance serveur-only (le middleware tourne en edge) :
// on ne fait qu'appeler .rpc() sur un client Supabase déjà construit.

type Rpc = { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> };

/** member | active | granted | waitlisted | none | anon (chaîne renvoyée par la fonction). */
async function callText(supabase: Rpc, fn: string, fallback: string): Promise<string> {
  try {
    const { data } = await supabase.rpc(fn);
    return typeof data === "string" ? data : fallback;
  } catch {
    return fallback;
  }
}

/** Statut d'accès de l'utilisateur courant, sans réclamer de siège. */
export function betaStatus(supabase: Rpc): Promise<string> {
  return callText(supabase, "beta_status", "none");
}

/** Réclame un siège si une place est libre (atomique côté base). */
export function claimSeat(supabase: Rpc): Promise<string> {
  return callText(supabase, "claim_beta_seat", "full");
}

/** Inscrit l'utilisateur courant sur la liste d'attente. */
export function joinWaitlist(supabase: Rpc): Promise<string> {
  return callText(supabase, "join_waitlist", "waitlisted");
}

/** L'utilisateur a-t-il accès (fondateur ou actif) ? */
export function isMember(status: string): boolean {
  return status === "member" || status === "active" || status === "founder" || status === "granted";
}
