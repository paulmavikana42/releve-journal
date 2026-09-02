"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Decimal, Direction, Review, RiskSource, Thesis, ThesisOutcome } from "@releve/core";
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

/** Rattache une position orpheline à une idée (décision humaine de l'appariement). */
export async function linkPosition(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const ideaId = String(formData.get("ideaId") ?? "");
  const positionUid = String(formData.get("positionUid") ?? "");
  if (!ideaId || !positionUid) return;

  const store = await openStore(supabase, user.id);
  store.link(ideaId, positionUid);
  await store.flush();
  revalidatePath("/journal");
}

/**
 * Une position sans idée candidate = un trade HORS-PLAN : on crée une idée
 * marquée off_plan à partir de la position, et on la rattache. Rien n'est perdu,
 * et la métrique "hors-plan" reste une vraie information.
 */
export async function createOffPlan(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const positionUid = String(formData.get("positionUid") ?? "");
  if (!positionUid) return;

  const store = await openStore(supabase, user.id);
  const { positions } = store.load();
  const p = positions.get(positionUid);
  if (!p) return;

  const idea = store.create_thesis(
    new Thesis({
      instrument: p.symbol,
      direction: p.direction,
      entry_planned: p.open_price,
      risk_source: RiskSource.UNKNOWN,
    }),
    { off_plan: true, account_id: "", label: `${p.symbol} (hors-plan)` },
  );
  store.link(idea.id, p.uid);
  await store.flush();
  revalidatePath("/journal");
}

/**
 * Revue d'une idée : décision × résultat. Les 5 cases de discipline mesurent le
 * PROCESS (indépendamment du gain), le verdict de thèse dit si le marché t'a
 * donné raison. C'est ce qui alimente le quadrant et la matrice du dashboard.
 */
export async function completeReview(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const ideaId = String(formData.get("ideaId") ?? "");
  if (!ideaId) return;

  const on = (k: string) => formData.get(k) === "on";
  const outcomeRaw = String(formData.get("thesis_outcome") ?? "non_testee");
  const outcome =
    outcomeRaw === "correcte"
      ? ThesisOutcome.CORRECT
      : outcomeRaw === "fausse"
        ? ThesisOutcome.WRONG
        : ThesisOutcome.UNTESTED;

  const store = await openStore(supabase, user.id);
  store.complete_review(
    ideaId,
    new Review({
      entry_in_zone: on("entry_in_zone"),
      size_conforme: on("size_conforme"),
      stop_at_invalidation: on("stop_at_invalidation"),
      stop_never_widened: on("stop_never_widened"),
      exit_per_plan: on("exit_per_plan"),
      thesis_outcome: outcome,
      emotional_state: String(formData.get("emotional_state") ?? "").trim(),
      lesson: String(formData.get("lesson") ?? "").trim(),
    }),
  );
  await store.flush();
  revalidatePath(`/journal/${ideaId}`);
  revalidatePath("/dashboard");
}
