// Les captures d'écran — port de core/captures.py.
//
// Une capture prise AU MOMENT de l'entrée est une donnée pré-engagée (même rang
// que StopEvidence.CAPTURE). Les fichiers vivent sur le disque, en clair ; le
// journal ne stocke que le chemin relatif. N'écrit RIEN dans le journal :
// l'appelant (store.add_capture) décide.
import * as fs from "node:fs";
import * as path from "node:path";
import { serverNow } from "./clock";
import { Attachment, CaptureKind } from "./models";

export const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
export const MAX_BYTES = 12 * 1024 * 1024;

export class CaptureError extends Error {}

function genId(): string {
  const g = globalThis as unknown as { crypto: { randomUUID(): string } };
  return g.crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function root(dataDir: string): string {
  return path.join(dataDir, "captures");
}

export function save(
  dataDir: string,
  ownerType: string,
  ownerId: string,
  filename: string,
  content: Uint8Array,
  kind: CaptureKind = CaptureKind.OTHER,
  caption = "",
): Attachment {
  const ext = path.extname(filename || "").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new CaptureError(
      `Format non accepté (${ext || "inconnu"}). Attendu : ${[...ALLOWED_EXT].sort().join(", ")}.`,
    );
  }
  if (!content || content.length === 0) throw new CaptureError("Fichier vide.");
  if (content.length > MAX_BYTES) {
    throw new CaptureError(
      `${(content.length / 1_048_576).toFixed(1)} Mo — au-delà de la limite de ` +
        `${Math.floor(MAX_BYTES / 1_048_576)} Mo. Réduis la capture avant de la joindre.`,
    );
  }

  const aid = genId();
  const folder = path.join(root(dataDir), ownerId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${aid}${ext}`), content);

  return new Attachment({
    id: aid,
    owner_type: ownerType,
    owner_id: ownerId,
    path: `captures/${ownerId}/${aid}${ext}`,
    original_name: filename,
    kind,
    caption,
    added_at: serverNow(),
  });
}

export function resolve(dataDir: string, attachment: Attachment): string | null {
  const p = path.join(dataDir, attachment.path);
  return fs.existsSync(p) ? p : null;
}

export function read(dataDir: string, attachment: Attachment): Uint8Array | null {
  const p = resolve(dataDir, attachment);
  return p ? fs.readFileSync(p) : null;
}
