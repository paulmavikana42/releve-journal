import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { NextResponse } from "next/server";
import { DEV_PREVIEW, repoDataResolve } from "@/lib/devPreview";

// Sert les images de captures depuis le dossier data/ local, UNIQUEMENT en aperçu
// de dev (RELEVE_DEV_PREVIEW=1, jamais en production). Permet de voir les images
// des blocs et les captures existantes sans Supabase. Chemins confinés à data/.
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!DEV_PREVIEW) return new NextResponse("Not found", { status: 404 });
  const { path: parts } = await params;
  const rel = parts.join("/");
  const abs = repoDataResolve(rel);
  if (!abs) return new NextResponse("Forbidden", { status: 403 });
  try {
    const bytes = readFileSync(abs);
    const type = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": type, "Cache-Control": "private, max-age=60" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
