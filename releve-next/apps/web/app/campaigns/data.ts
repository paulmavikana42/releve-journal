import "server-only";
import { Campaign, Idea, SpecBook } from "@releve/core";
import { currentUser, openStore } from "../journal/data";

export type CampaignsView = {
  userEmail: string;
  campaigns: Campaign[];
  unattached: Idea[]; // idées exécutables/écrites sans thèse macro
  book: SpecBook;
} | null;

export async function loadCampaigns(): Promise<CampaignsView> {
  const { supabase, user } = await currentUser();
  if (!user) return null;

  const store = await openStore(supabase, user.id);
  const { ideas, positions } = store.load();
  const campaigns = [...store.campaigns().values()].filter((c) => !c.abandoned);
  const book = new SpecBook([...positions.values()]);
  const unattached = [...ideas.values()].filter((i) => !i.campaign_id);

  return { userEmail: user.email ?? "", campaigns, unattached, book };
}
