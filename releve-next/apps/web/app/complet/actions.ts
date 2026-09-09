"use server";

import { redirect } from "next/navigation";
import { currentUser } from "@/app/journal/data";
import { joinWaitlist } from "@/lib/beta";

/** « Se mettre en attente » : enregistre le gmail dans la waitlist puis page de fin. */
export async function joinWaitlistAction(): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  await joinWaitlist(supabase);
  redirect("/waitlist-ok");
}
