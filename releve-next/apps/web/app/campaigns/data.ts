import "server-only";
import { Campaign, Idea, mine, SpecBook } from "@releve/core";
import { currentUser, openStore, signedCaptureUrls, signedUrlsForPaths } from "../journal/data";
import { activeScope } from "../settings/data";
import { imagePaths } from "@/lib/blocks";

export type CampaignsView = {
  userEmail: string;
  campaigns: Campaign[];
  unattached: Idea[]; // idées exécutables/écrites sans thèse macro
  book: SpecBook;
  captureUrls: Map<string, string>;
  blockUrls: Map<string, string>; // clé = chemin d'image de bloc
} | null;

export async function loadCampaigns(): Promise<CampaignsView> {
  const { supabase, user } = await currentUser();
  if (!user) return null;

  const store = await openStore(supabase, user.id);
  const { ideas, positions } = store.load();
  const { activeUid, accountUids } = await activeScope(supabase, user.id);
  const campaigns = [...store.campaigns().values()].filter(
    (c) => !c.abandoned && mine(c, activeUid, accountUids),
  );
  const book = new SpecBook([...positions.values()]);
  const unattached = [...ideas.values()].filter(
    (i) => !i.campaign_id && mine(i, activeUid, accountUids),
  );

  const allCaptures = campaigns.flatMap((c) => c.captures);
  const captureUrls = await signedCaptureUrls(supabase, allCaptures);
  const blockPaths = campaigns.flatMap((c) => imagePaths(c.blocks as unknown[] | undefined));
  const blockUrls = await signedUrlsForPaths(supabase, blockPaths);

  return { userEmail: user.email ?? "", campaigns, unattached, book, captureUrls, blockUrls };
}
