"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Campaign } from "@releve/core";
import { currentUser, openStore } from "../journal/data";

async function store() {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  return { s: await openStore(supabase, user.id) };
}

export async function createCampaign(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const conv = String(formData.get("conviction") ?? "").trim();
  const { s } = await store();
  s.create_campaign(
    new Campaign({
      name,
      macro_theme: String(formData.get("macro_theme") ?? "").trim(),
      catalyst: String(formData.get("catalyst") ?? "").trim(),
      conviction: conv ? Math.trunc(Number(conv)) : null,
      account_id: "",
    }),
  );
  await s.flush();
  revalidatePath("/campaigns");
}

export async function attachIdea(formData: FormData): Promise<void> {
  const ideaId = String(formData.get("ideaId") ?? "");
  const campaignId = String(formData.get("campaignId") ?? "");
  if (!ideaId || !campaignId) return;
  const { s } = await store();
  s.attach(ideaId, campaignId);
  await s.flush();
  revalidatePath("/campaigns");
}

export async function detachIdea(formData: FormData): Promise<void> {
  const ideaId = String(formData.get("ideaId") ?? "");
  if (!ideaId) return;
  const { s } = await store();
  s.detach(ideaId);
  await s.flush();
  revalidatePath("/campaigns");
}

export async function abandonCampaign(formData: FormData): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  if (!campaignId) return;
  const { s } = await store();
  s.abandon_campaign(campaignId);
  await s.flush();
  revalidatePath("/campaigns");
}
