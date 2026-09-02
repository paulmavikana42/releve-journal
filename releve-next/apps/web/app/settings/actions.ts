"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Decimal, PropRules } from "@releve/core";
import { currentUser } from "@/app/journal/data";
import { getActiveAccount, removeAccount, saveAccount, setActiveAccount } from "./data";

function dec(fd: FormData, key: string, fallback: string): Decimal {
  const v = String(fd.get(key) ?? "").trim().replace(",", ".");
  return new Decimal(v || fallback);
}

export async function saveAccountAction(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  // On garde l'uid du compte existant (clé de cloisonnement stable).
  const existing = await getActiveAccount(supabase, user.id);

  const rules = new PropRules({
    uid: existing?.uid, // undefined ⇒ un nouvel uid est généré
    label: String(formData.get("label") ?? "").trim() || "Mon compte",
    currency: String(formData.get("currency") ?? "USD"),
    account_id: String(formData.get("account_id") ?? "").trim(),
    start_balance: dec(formData, "start_balance", "100000"),
    challenge_type: String(formData.get("challenge_type") ?? "two_phase"),
    phase: String(formData.get("phase") ?? "p1"),
    daily_loss_pct: dec(formData, "daily_loss_pct", "5"),
    max_drawdown_pct: dec(formData, "max_drawdown_pct", "10"),
    drawdown_static: formData.get("drawdown_static") === "on",
    profit_target_pct: dec(formData, "profit_target_pct", "8"),
    min_trading_days:
      formData.get("min_trading_days") != null && String(formData.get("min_trading_days")).trim() !== ""
        ? Math.trunc(Number(formData.get("min_trading_days")))
        : null,
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
