"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, openStore } from "@/app/journal/data";

/**
 * Annule un lot d'import (mauvais fichier déposé). Append-only : on ajoute un
 * événement d'annulation, le lot est neutralisé au replay — et le fichier peut
 * être réimporté ensuite.
 */
export async function undoImportAction(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const importId = String(formData.get("importId") ?? "").trim();
  if (!importId) return;
  const store = await openStore(supabase, user.id);
  store.load();
  store.revert_import(importId);
  await store.flush();
  revalidatePath("/import");
  revalidatePath("/journal");
  revalidatePath("/dashboard");
}
