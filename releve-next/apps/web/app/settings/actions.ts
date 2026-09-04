"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Decimal, PropRules } from "@releve/core";
import { currentUser, openStore } from "@/app/journal/data";
import { getActiveAccount, removeAccount, saveAccount, setActiveAccount, setWatchlist, activeScope } from "./data";
import { serverNow } from "@releve/core";

/**
 * Passe à la phase suivante du challenge (bouton manuel : la firme t'a validé).
 * Enregistre la date du passage → la conformité repart de la base pour la
 * nouvelle phase. p1→p2→funded (two_phase) ou p1→funded (one_phase/instant).
 */
export async function advancePhaseAction(): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const active = await getActiveAccount(supabase, user.id);
  if (!active) return;
  const cur = active.phase;
  if (active.is_funded || cur === "funded") return;
  const next = active.challenge_type === "two_phase" && cur === "p1" ? "p2" : "funded";

  const { activeUid } = await activeScope(supabase, user.id);
  const store = await openStore(supabase, user.id);
  store.load();
  store.advance_phase(activeUid, next, serverNow());
  await store.flush();

  const d = active.to_dict();
  d.phase = next;
  await saveAccount(supabase, user.id, PropRules.from_dict(d));

  revalidatePath("/compliance");
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

/** Enregistre la watchlist (les symboles proposés à l'écriture d'une idée). */
export async function saveWatchlistAction(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const raw = String(formData.get("symbols") ?? "");
  const symbols = raw.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean);
  await setWatchlist(supabase, user.id, symbols);
  revalidatePath("/settings");
}

function dec(fd: FormData, key: string, fallback: string): Decimal {
  const v = String(fd.get(key) ?? "").trim().replace(",", ".");
  return new Decimal(v || fallback);
}

export async function saveAccountAction(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  // On garde l'uid du compte existant (clé de cloisonnement stable).
  const existing = await getActiveAccount(supabase, user.id);

  const minDaysOn = formData.get("min_days_on") === "on";
  const consistencyOn = formData.get("consistency_on") === "on";

  const rules = new PropRules({
    uid: existing?.uid, // undefined ⇒ un nouvel uid est généré
    label: String(formData.get("label") ?? "").trim() || "Mon compte",
    currency: String(formData.get("currency") ?? "USD"),
    account_id: String(formData.get("account_id") ?? "").trim(),
    start_balance: dec(formData, "start_balance", "100000"),
    challenge_type: String(formData.get("challenge_type") ?? "two_phase"),
    phase: String(formData.get("phase") ?? "p1"),
    daily_loss_pct: new Decimal(0), // règle « perte journalière » retirée du MVP
    max_drawdown_pct: dec(formData, "max_drawdown_pct", "10"),
    drawdown_static: formData.get("drawdown_static") === "on",
    profit_target_pct: dec(formData, "profit_target_pct", "8"),
    // Jours de trading minimum : optionnel (null = aucune règle).
    min_trading_days: minDaysOn
      ? (String(formData.get("min_trading_days") ?? "").trim() ? Math.trunc(Number(formData.get("min_trading_days"))) : 3)
      : null,
    trading_day_rule: minDaysOn ? "gain" : "position",
    trading_day_threshold_pct: minDaysOn ? dec(formData, "trading_day_threshold_pct", "0") : new Decimal(0),
    // Cohérence (consistency) : optionnel (null = aucune règle).
    consistency_pct: consistencyOn ? dec(formData, "consistency_pct", "30") : null,
  });

  await saveAccount(supabase, user.id, rules);
  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/** Crée un nouveau compte (vierge) et l'active — à éditer ensuite. */
export async function newAccountAction(): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  await saveAccount(supabase, user.id, new PropRules({ label: "Nouveau compte" }));
  revalidatePath("/settings");
  redirect("/settings");
}

export async function activateAccountAction(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const uid = String(formData.get("uid") ?? "");
  if (uid) await setActiveAccount(supabase, user.id, uid);
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  redirect("/settings");
}

export async function removeAccountAction(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const uid = String(formData.get("uid") ?? "");
  if (uid) await removeAccount(supabase, user.id, uid);
  revalidatePath("/settings");
  revalidatePath("/dashboard");
  redirect("/settings");
}
