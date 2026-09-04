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

/**
 * Supprime un trade orphelin (importé par erreur, pas encore rattaché à une idée).
 * Il disparaît ; réimporter le même CSV le fera réapparaître (append-only ne fige
 * que les trades restés importés). On refuse de supprimer un ticket déjà rattaché.
 */
export async function deleteOrphanAction(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const uid = String(formData.get("positionUid") ?? "").trim();
  if (!uid) return;
  const store = await openStore(supabase, user.id);
  store.load();
  const isOrphan = store.orphans().some((p) => p.uid === uid);
  if (!isOrphan) return; // garde-fou : on ne supprime que des orphelins
  store.delete_position(uid);
  await store.flush();
  revalidatePath("/import");
  revalidatePath("/journal");
}
