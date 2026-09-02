"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Decimal, Direction, RiskSource, Thesis } from "@releve/core";
import { currentUser, openStore } from "./data";

/**
 * Écrit une idée dans le journal de l'utilisateur (table events).
 * Toute la logique métier vient de @releve/core ; ici on ne fait que traduire le
 * formulaire, appeler create_thesis, puis flush() vers Supabase.
 */
export async function addIdea(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const instrument = String(formData.get("instrument") ?? "").trim().toUpperCase();
  if (!instrument) return;

  const direction = String(formData.get("direction")) === "sell" ? Direction.SELL : Direction.BUY;
  const entry = String(formData.get("entry") ?? "").trim();
  const stop = String(formData.get("stop") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();

  const store = await openStore(supabase, user.id);
  store.create_thesis(
    new Thesis({
      instrument,
      direction,
      entry_planned: entry ? new Decimal(entry) : null,
      stop_initial: stop ? new Decimal(stop) : null,
      risk_source: RiskSource.COMPUTED,
    }),
    { label, account_id: "" },
  );
  await store.flush();

  revalidatePath("/journal");
}
