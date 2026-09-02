// Où vivent les données — port de core/paths.py.
//
// Règle non négociable : le journal ne vit JAMAIS à côté du programme. En dev il
// reste dans data/ du dépôt ; distribué, il va dans le profil utilisateur ;
// RELEVE_DATA force le dossier (tests, clé USB). Module Node (fs/os/path) : il
// n'a de sens que côté serveur/local, jamais dans le bundle navigateur.
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

export const APP_NAME = "Releve";

// PyInstaller n'existe pas en TS : ce drapeau est piloté par les tests (comme le
// monkeypatch de paths.is_frozen côté Python).
let _frozen = false;
export function isFrozen(): boolean {
  return _frozen;
}
export function setFrozen(v: boolean): void {
  _frozen = v;
}

function userDataRoot(): string {
  if (process.platform === "win32") {
    const base = process.env["LOCALAPPDATA"] || os.homedir();
    return path.join(base, APP_NAME);
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_NAME);
  }
  const xdg = process.env["XDG_DATA_HOME"] || path.join(os.homedir(), ".local", "share");
  return path.join(xdg, APP_NAME.toLowerCase());
}

export function repoRoot(): string {
  // La racine des SOURCES. Jamais un endroit où écrire.
  if (isFrozen()) {
    return path.dirname(process.execPath);
  }
  // packages/core/src/paths.ts -> racine du dépôt (../../../..)
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "..");
}

export function dataDir(): string {
  const forced = process.env["RELEVE_DATA"];
  let d: string;
  if (forced) d = forced;
  else if (isFrozen()) d = path.join(userDataRoot(), "data");
  else d = path.join(repoRoot(), "data");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function settingsPath(): string {
  return path.join(dataDir(), "settings.json");
}

export function journalPath(demo = false): string {
  return path.join(dataDir(), demo ? "demo.jsonl" : "events.jsonl");
}
