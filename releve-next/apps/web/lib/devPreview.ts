import "server-only";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { type EventRecord } from "@releve/core";

// Aperçu LOCAL de dev : rend les pages avec le vrai data/events.jsonl (le même
// fichier que Streamlit lit), SANS Supabase ni login. Sert uniquement à comparer
// l'UI au rendu Streamlit. Doublement verrouillé : jamais en production, et
// seulement si RELEVE_DEV_PREVIEW=1 (dans .env.local, non committé).
export const DEV_PREVIEW =
  process.env.NODE_ENV !== "production" && process.env.RELEVE_DEV_PREVIEW === "1";

function repoDataPath(name: string): string {
  // Cherche data/<name> en remontant depuis le cwd (robuste quel que soit le
  // dossier de lancement du dev server).
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const cand = path.join(dir, "data", name);
    if (existsSync(cand)) return cand;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.join(process.cwd(), "data", name);
}

export function devUser(): { id: string; email: string } {
  return { id: "dev-preview", email: "aperçu@local" };
}

export function devEvents(): EventRecord[] {
  const p = repoDataPath("events.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EventRecord);
}

type DevSettings = {
  accounts?: Record<string, unknown>[];
  active_uid?: string;
  watchlist?: string[];
};

export function devSettings(): DevSettings {
  const p = repoDataPath("settings.json");
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
    // Streamlit mémorise le compte actif sous `last_account_uid` ; l'app Next
    // lit `active_uid`. On mappe pour que l'aperçu montre le MÊME compte.
    if (raw.active_uid == null && typeof raw.last_account_uid === "string") {
      raw.active_uid = raw.last_account_uid;
    }
    return raw as DevSettings;
  } catch {
    return {};
  }
}
