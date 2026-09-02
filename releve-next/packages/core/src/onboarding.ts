// Premier lancement, et la mort de la démonstration — port de core/onboarding.py.
//
// Deux fichiers, jamais un seul : demo.jsonl (jetable) vs events.jsonl (ton
// journal, qui n'a jamais contenu une ligne de démo). Au premier import réel, ce
// que TU as écrit pendant la démo est recopié dans le vrai journal, PUIS le décor
// est effacé. L'ordre — écrire, puis effacer — est la seule vraie protection.
import * as fs from "node:fs";
import * as path from "node:path";
import { journalPath, dataDir } from "./paths";
import * as settings from "./settings";

export const DEMO_FLAG = "demo";

function touch(p: string): void {
  fs.writeFileSync(p, "", { flag: "a" }); // crée si absent, n'écrase jamais
}

export function demoMode(): boolean {
  return Boolean(settings.read()["demo_mode"]);
}

export function configured(): boolean {
  return Boolean(settings.read()["onboarded"]);
}

export function startBlank(): string {
  const data = settings.read();
  data["onboarded"] = true;
  data["demo_mode"] = false;
  settings.write(data);
  const p = journalPath(false);
  touch(p);
  return p;
}

export function startDemo(): string {
  const data = settings.read();
  data["onboarded"] = true;
  data["demo_mode"] = true;
  settings.write(data);
  return journalPath(true);
}

export function currentJournal(): string {
  return journalPath(demoMode());
}

export function hasRealPositions(journal: string): boolean {
  if (!fs.existsSync(journal)) return false;
  for (const raw of fs.readFileSync(journal, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (ev["type"] === "position_imported" && !ev[DEMO_FLAG]) return true;
  }
  return false;
}

export function leaveDemo(): [string, number] {
  const reel = journalPath(false);

  // Appelée une 2e fois (2e import) : on ne recopie pas les mêmes lignes.
  if (!demoMode()) {
    touch(reel);
    return [reel, 0];
  }

  const demo = journalPath(true);
  const gardes: string[] = [];
  if (fs.existsSync(demo)) {
    for (const raw of fs.readFileSync(demo, "utf-8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!ev[DEMO_FLAG]) gardes.push(line);
    }
  }

  if (gardes.length) {
    // Écrit sur le disque AVANT d'effacer (fsync).
    const fd = fs.openSync(reel, "a");
    try {
      fs.writeSync(fd, gardes.join("\n") + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } else {
    touch(reel);
  }

  // Le décor s'en va. Après l'écriture, jamais avant.
  if (fs.existsSync(demo)) fs.rmSync(demo);

  const data = settings.read();
  data["demo_mode"] = false;
  data["onboarded"] = true;
  settings.write(data);
  return [reel, gardes.length];
}

export function resetAll(backup = true): void {
  const d = dataDir();
  for (const nom of ["events.jsonl", "demo.jsonl", "settings.json"]) {
    const f = path.join(d, nom);
    if (!fs.existsSync(f)) continue;
    if (nom === "demo.jsonl") {
      fs.rmSync(f);
      continue;
    }
    if (backup) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
      const ext = path.extname(f);
      const stem = path.basename(f, ext);
      fs.renameSync(f, path.join(d, `${stem}.${stamp}.avant-remise-a-zero${ext}`));
    } else {
      fs.rmSync(f);
    }
  }
}
