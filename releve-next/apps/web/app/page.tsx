import { redirect } from "next/navigation";
import { currentUser } from "./journal/data";
import { getAccounts } from "./settings/data";

/**
 * Point d'entrée : oriente selon l'état du compte. Un NOUVEL utilisateur (aucun
 * compte réglé) arrive sur Réglages — il doit d'abord poser son capital et son
 * type de compte ; les autres vont au Tableau de bord. Le middleware renvoie vers
 * /login si la session manque.
 */
export default async function Home() {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const accounts = await getAccounts(supabase, user.id);
  redirect(accounts.length ? "/dashboard" : "/settings");
}
