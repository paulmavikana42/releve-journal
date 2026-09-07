"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  Attachment,
  CaptureKind,
  Decimal,
  Direction,
  MissedOutcome,
  MissedReview,
  OpenTrade,
  Review,
  RiskSource,
  serverNow,
  StopEvidence,
  Thesis,
  ThesisOutcome,
} from "@releve/core";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { currentUser, openStore } from "./data";
import { activeScope } from "../settings/data";
import { DEV_PREVIEW, repoDataResolve } from "@/lib/devPreview";
import { type Block, serializeBlocks, toNote } from "@/lib/blocks";

/** Parse en toute sécurité le JSON des blocs venus du formulaire. */
function parseBlocks(raw: FormDataEntryValue | null): Block[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return serializeBlocks(
      arr.map((b: Record<string, unknown>) =>
        b.type === "image"
          ? { type: "image", path: String(b.path ?? ""), caption: String(b.caption ?? ""), width: Number(b.width ?? 100), bid: String(b.bid ?? "") }
          : { type: "text", text: String(b.text ?? ""), bid: String(b.bid ?? "") },
      ) as Block[],
    );
  } catch {
    return [];
  }
}

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
  const dir = direction === Direction.SELL ? "sell" : "buy";
  const dec = (k: string): Decimal | null => {
    const v = String(formData.get(k) ?? "").trim().replace(",", ".");
    return v && Number(v) ? new Decimal(v) : null;
  };
  const conv = String(formData.get("conviction") ?? "").trim();
  const macroTheme = String(formData.get("macro_theme") ?? "").trim();
  const targets = String(formData.get("targets") ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().replace(",", "."))
    .filter((s) => s && Number(s))
    .map((s) => new Decimal(s));
  const blocks = parseBlocks(formData.get("blocks"));
  const entry = dec("entry");
  const stop = dec("stop");

  const thesis = new Thesis({
    instrument,
    direction,
    macro_theme: macroTheme,
    catalyst: String(formData.get("catalyst") ?? "").trim(),
    macro_note: toNote(blocks),
    blocks,
    setup: String(formData.get("setup") ?? "").trim(),
    timeframe: String(formData.get("timeframe") ?? "").trim(),
    technical_note: "",
    entry_planned: entry,
    stop_initial: stop,
    targets,
    risk_pct: dec("risk_pct"),
    thesis_kill_switch: String(formData.get("thesis_kill_switch") ?? "").trim(),
    conviction: conv ? Math.trunc(Number(conv)) : null,
    risk_source: RiskSource.COMPUTED,
  });

  const label = String(formData.get("label") ?? "").trim() || (macroTheme ? `${instrument} ${dir} — ${macroTheme}` : `${instrument} ${dir}`);

  const { activeUid } = await activeScope(supabase, user.id);
  const store = await openStore(supabase, user.id);
  const idea = store.create_thesis(thesis, { label, account_id: activeUid });

  // Rattachement à une thèse macro (facultatif).
  const campaignId = String(formData.get("campaign") ?? "").trim();
  if (campaignId && campaignId !== "none") store.attach(idea.id, campaignId);

  // Déclaration du ticket à l'entrée (décision [N]) : l'idée passe « en cours ».
  const ticket = String(formData.get("ticket") ?? "").trim();
  if (ticket) {
    store.open_trade(
      idea.id,
      new OpenTrade({
        ticket,
        symbol: instrument,
        direction,
        volume: new Decimal("0"),
        open_time: serverNow(),
        open_price: entry ?? new Decimal("0"),
        account_id: activeUid,
        stop: stop,
      }),
    );
  }

  await store.flush();
  revalidatePath("/journal");
  redirect("/journal?vue=journal");
}

/**
 * Rattache une position orpheline à une idée (décision humaine de l'appariement).
 * Si le candidat est un RENFORT, on capture au passage son vrai stop (un renfort
 * n'hérite jamais du stop du noyau — décision [H ter]) et si le noyau était déjà
 * au breakeven à son ouverture (décision [H quater]) — sinon l'exposition
 * simultanée reste un majorant et le R peut être incalculable.
 */
export async function linkPosition(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const ideaId = String(formData.get("ideaId") ?? "");
  const positionUid = String(formData.get("positionUid") ?? "");
  if (!ideaId || !positionUid) return;

  const store = await openStore(supabase, user.id);
  store.link(ideaId, positionUid);
  // Renfort : stop propre + « noyau au breakeven » (répondus à l'appariement).
  if (formData.get("is_add") === "1") {
    const stop = decOf(formData, "add_stop");
    if (stop !== null) store.set_ticket_stop(ideaId, positionUid, stop, StopEvidence.CAPTURE);
    store.set_secured(ideaId, positionUid, formData.get("core_secured") === "on");
  }
  await store.flush();
  revalidatePath("/journal");
  revalidatePath(`/journal/${ideaId}`);
}

/**
 * Précise le risque d'un ticket rattaché (depuis le détail) : le stop réel d'un
 * renfort et, pour un renfort, si le noyau était au breakeven à son ouverture.
 * C'est ce qui rend l'exposition simultanée « mesurée » plutôt que « majorant ».
 */
export async function saveTicketRisk(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const ideaId = String(formData.get("ideaId") ?? "");
  const positionUid = String(formData.get("positionUid") ?? "");
  if (!ideaId || !positionUid) return;

  const store = await openStore(supabase, user.id);
  const stop = decOf(formData, "stop");
  if (stop !== null) store.set_ticket_stop(ideaId, positionUid, stop, StopEvidence.CAPTURE);
  // Champ caché présent uniquement pour un renfort → on enregistre oui/non.
  if (formData.get("with_secured") === "1") {
    store.set_secured(ideaId, positionUid, formData.get("core_secured") === "on");
  }
  await store.flush();
  revalidatePath(`/journal/${ideaId}`);
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

  const { activeUid } = await activeScope(supabase, user.id);
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
    { off_plan: true, account_id: activeUid, label: `${p.symbol} (hors-plan)` },
  );
  store.link(idea.id, p.uid);
  await store.flush();
  revalidatePath("/journal");
}

function decOf(fd: FormData, k: string): Decimal | null {
  const v = String(fd.get(k) ?? "").trim().replace(",", ".");
  return v ? new Decimal(v) : null;
}

/** Modifier la thèse d'une idée (create existe déjà ; ici on remplace). */
export async function updateThesis(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const ideaId = String(formData.get("ideaId") ?? "");
  if (!ideaId) return;

  const store = await openStore(supabase, user.id);
  const { ideas } = store.load();
  const idea = ideas.get(ideaId);
  if (!idea) return;

  const targets = String(formData.get("targets") ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().replace(",", "."))
    .filter(Boolean)
    .map((s) => new Decimal(s));
  const conv = String(formData.get("conviction") ?? "").trim();
  const blocks = parseBlocks(formData.get("blocks"));

  const thesis = new Thesis({
    instrument: String(formData.get("instrument") ?? "").trim().toUpperCase() || (idea.thesis?.instrument ?? ""),
    direction: String(formData.get("direction")) === "sell" ? Direction.SELL : Direction.BUY,
    entry_planned: decOf(formData, "entry_planned"),
    stop_initial: decOf(formData, "stop_initial"),
    targets,
    risk_pct: decOf(formData, "risk_pct"),
    conviction: conv ? Math.trunc(Number(conv)) : null,
    macro_theme: String(formData.get("macro_theme") ?? "").trim(),
    catalyst: String(formData.get("catalyst") ?? "").trim(),
    setup: String(formData.get("setup") ?? "").trim(),
    timeframe: String(formData.get("timeframe") ?? "").trim(),
    technical_note: "", // l'écriture libre vit désormais dans les blocs
    thesis_kill_switch: String(formData.get("thesis_kill_switch") ?? "").trim(),
    macro_note: toNote(blocks), // reflet à plat des blocs (recherche, rétrocompat)
    blocks,
    risk_source: RiskSource.COMPUTED,
  });

  store.update_thesis(ideaId, thesis, String(formData.get("label") ?? "").trim() || null);
  await store.flush();
  revalidatePath(`/journal/${ideaId}`);
  revalidatePath("/journal");
  redirect(`/journal/${ideaId}`);
}

/**
 * Review d'abandon (décision [L]/[AD]) : « ai-je eu l'occasion », pas « avais-je
 * raison ». Setup absent = non-événement ; hésitation devant un setup valide =
 * l'information qui compte. Marque l'idée abandonnée et enregistre le bilan.
 */
export async function reviewMissed(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const ideaId = String(formData.get("ideaId") ?? "");
  if (!ideaId) return;

  const setup =
    String(formData.get("setup_appeared")) === "hesitation" ? MissedOutcome.HESITATED : MissedOutcome.NO_SETUP;
  const wonRaw = String(formData.get("would_have_won") ?? "");
  const would = wonRaw === "oui" ? true : wonRaw === "non" ? false : null;

  const store = await openStore(supabase, user.id);
  store.review_missed(
    ideaId,
    new MissedReview({
      setup_appeared: setup,
      would_have_won: setup === MissedOutcome.HESITATED ? would : null,
      reason: String(formData.get("reason") ?? "").trim(),
      note: String(formData.get("note") ?? "").trim(),
    }),
  );
  await store.flush();
  revalidatePath(`/journal/${ideaId}`);
  revalidatePath("/journal");
}

/** Abandonner une idée (marquée, jamais effacée — décision [K]). */
export async function abandonIdea(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const ideaId = String(formData.get("ideaId") ?? "");
  if (!ideaId) return;
  const store = await openStore(supabase, user.id);
  store.abandon(ideaId);
  await store.flush();
  revalidatePath("/journal");
  redirect("/journal");
}

/**
 * Déclare le ticket à l'ENTRÉE (décision [N]) : l'idée passe « en cours » et le
 * stop réellement placé est enregistré AVANT que le broker ne l'écrase (un stop
 * passé au breakeven vaudrait quelques points et produirait un R absurde). Le
 * numéro de ticket devient la clé de clôture à l'import.
 */
export async function openTrade(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const ideaId = String(formData.get("ideaId") ?? "");
  const ticket = String(formData.get("ticket") ?? "").trim();
  if (!ideaId || !ticket) return;

  const { activeUid } = await activeScope(supabase, user.id);
  const store = await openStore(supabase, user.id);
  const { ideas } = store.load();
  const idea = ideas.get(ideaId);
  if (!idea || !idea.thesis) return;
  const t = idea.thesis;
  const dec = (k: string) => {
    const v = String(formData.get(k) ?? "").trim().replace(",", ".");
    return v ? new Decimal(v) : null;
  };

  store.open_trade(
    ideaId,
    new OpenTrade({
      ticket,
      symbol: t.instrument,
      direction: t.direction,
      volume: dec("volume") ?? new Decimal("0"),
      open_time: serverNow(),
      open_price: dec("open_price") ?? t.entry_planned ?? new Decimal("0"),
      account_id: activeUid,
      stop: dec("stop") ?? t.stop_initial,
    }),
  );
  await store.flush();
  revalidatePath(`/journal/${ideaId}`);
  revalidatePath("/journal");
}

const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const MAX_CAPTURE_BYTES = 12 * 1024 * 1024;
const KINDS = new Set<string>(["these", "entree", "gestion", "sortie", "autre"]);

/**
 * Joindre une capture (image pré-engagée, décision [P]) à une idée ou une thèse.
 * L'image va dans le bucket Storage `captures/<user_id>/<id>.<ext>` ; le journal
 * ne stocke que le chemin.
 */
export async function addCapture(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const ownerType = String(formData.get("owner_type") ?? "idea");
  const ownerId = String(formData.get("owner_id") ?? "");
  const file = formData.get("file");
  if (!ownerId || !(file instanceof File) || file.size === 0) return;

  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error(`Format non accepté (${ext || "inconnu"}).`);
  if (file.size > MAX_CAPTURE_BYTES) throw new Error("Image trop lourde (max 12 Mo).");

  const kindRaw = String(formData.get("kind") ?? "autre");
  const kind = (KINDS.has(kindRaw) ? kindRaw : "autre") as CaptureKind;
  const aid = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Chemin selon l'environnement : bucket Supabase en prod, disque local en aperçu.
  let path: string;
  if (DEV_PREVIEW) {
    path = `captures/${ownerId}/${aid}.${ext}`;
    const abs = repoDataResolve(path);
    if (!abs) throw new Error("Chemin invalide.");
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  } else {
    path = `${user.id}/${aid}.${ext}`;
    const { error } = await supabase.storage
      .from("captures")
      .upload(path, bytes, { contentType: file.type || `image/${ext}`, upsert: false });
    if (error) throw new Error(`Upload capture : ${error.message}`);
  }

  const store = await openStore(supabase, user.id);
  store.add_capture(
    new Attachment({
      id: aid,
      owner_type: ownerType,
      owner_id: ownerId,
      path,
      original_name: file.name,
      kind,
      caption: String(formData.get("caption") ?? "").trim(),
      added_at: serverNow(),
    }),
  );
  await store.flush();
  if (ownerType === "campaign") revalidatePath(`/campaigns`);
  else revalidatePath(`/journal/${ownerId}`);
}

/**
 * Upload d'une image insérée dans l'éditeur par blocs (idée ou thèse). Le fichier
 * va dans le même bucket que les captures ; on renvoie le CHEMIN (stocké dans le
 * bloc) et une URL d'aperçu. En aperçu de dev, on écrit dans data/captures/ local.
 */
export async function uploadBlockImage(formData: FormData): Promise<{ path: string; url: string }> {
  const { supabase, user } = await currentUser();
  if (!user) throw new Error("Non connecté.");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Aucun fichier.");
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error(`Format non accepté (${ext || "inconnu"}).`);
  if (file.size > MAX_CAPTURE_BYTES) throw new Error("Image trop lourde (max 12 Mo).");

  const aid = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (DEV_PREVIEW) {
    const rel = `captures/${user.id}/${aid}.${ext}`;
    const abs = repoDataResolve(rel);
    if (!abs) throw new Error("Chemin invalide.");
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    return { path: rel, url: `/dev-capture/${rel.split("/").map(encodeURIComponent).join("/")}` };
  }

  const path = `${user.id}/${aid}.${ext}`;
  const { error } = await supabase.storage
    .from("captures")
    .upload(path, bytes, { contentType: file.type || `image/${ext}`, upsert: false });
  if (error) throw new Error(`Upload image : ${error.message}`);
  const { data } = await supabase.storage.from("captures").createSignedUrl(path, 3600);
  return { path, url: data?.signedUrl ?? "" };
}

/** Retirer une capture (marquée removed ; le fichier reste — décision [P]). */
export async function removeCapture(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const attachmentId = String(formData.get("attachment_id") ?? "");
  const ownerId = String(formData.get("owner_id") ?? "");
  const ownerType = String(formData.get("owner_type") ?? "idea");
  if (!attachmentId) return;
  const store = await openStore(supabase, user.id);
  store.remove_capture(attachmentId);
  await store.flush();
  if (ownerType === "campaign") revalidatePath(`/campaigns`);
  else revalidatePath(`/journal/${ownerId}`);
}

/** Détacher un ticket mal rattaché d'une idée (append-only : on ajoute). */
export async function unlinkPosition(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const ideaId = String(formData.get("ideaId") ?? "");
  const positionUid = String(formData.get("positionUid") ?? "");
  if (!ideaId || !positionUid) return;
  const store = await openStore(supabase, user.id);
  store.unlink(ideaId, positionUid);
  await store.flush();
  revalidatePath(`/journal/${ideaId}`);
  revalidatePath("/journal");
}

/** Saisir le cours courant d'un trade en cours → flottant (déclaratif). */
export async function updateFloating(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const ideaId = String(formData.get("ideaId") ?? "");
  const uid = String(formData.get("uid") ?? "");
  const price = decOf(formData, "last_price");
  if (!uid || price === null) return;

  const store = await openStore(supabase, user.id);
  store.update_trade(uid, { last_price: price, last_price_at: serverNow() });
  await store.flush();
  revalidatePath(`/journal/${ideaId}`);
}

/** Annule un ticket déclaré par erreur (append-only : on ajoute l'annulation). */
export async function cancelTrade(formData: FormData): Promise<void> {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const ideaId = String(formData.get("ideaId") ?? "");
  const uid = String(formData.get("uid") ?? "");
  if (!uid) return;

  const store = await openStore(supabase, user.id);
  store.cancel_trade(uid);
  await store.flush();
  revalidatePath(`/journal/${ideaId}`);
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
