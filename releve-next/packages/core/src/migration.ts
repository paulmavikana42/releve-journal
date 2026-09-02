// Reprendre un journal d'une version précédente — port de core/migration.py.
//
// Le format n'a jamais changé, il a grandi : aucune conversion. Ce module fait
// ce qu'un copier-coller ne fait pas — REGARDER avant d'écrire, REFUSER ce qui
// n'est pas un journal, SAUVEGARDER l'existant avant de le remplacer.
import * as fs from "node:fs";
import * as path from "node:path";
import { journalPath, dataDir } from "./paths";
import * as settings from "./settings";

export const CONNUS = new Set([
  "thesis_created", "thesis_updated", "idea_abandoned", "position_imported",
  "deal_imported", "position_linked", "position_unlinked", "add_secured",
  "review_completed", "campaign_created", "campaign_updated", "idea_attached",
  "idea_detached", "ticket_stop_set", "idea_marked_late", "idea_missed",
  "campaign_abandoned", "trade_opened", "trade_updated", "trade_cancelled",
  "capture_added", "capture_removed",
]);

export class MigrationError extends Error {}

export class Apercu {
  lignes = 0;
  evenements = 0;
  illisibles = 0;
  par_type: Record<string, number> = {};
  types_inconnus = new Set<string>();
  premiere: Date | null = null;
  derniere: Date | null = null;
  demo = 0;

  get idees(): number {
    return this.par_type["thesis_created"] ?? 0;
  }
  get tickets(): number {
    return this.par_type["position_imported"] ?? 0;
  }
  get reviews(): number {
    return this.par_type["review_completed"] ?? 0;
  }
  get utilisable(): boolean {
    return this.evenements > 0;
  }
}

function texte(source: Uint8Array | string): string {
  if (typeof source === "string") return source;
  const b = source;
  if (b.length >= 2) {
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b);
  }
  for (const enc of ["utf-8", "windows-1252"]) {
    try {
      // utf-8 gère le BOM (utf-8-sig) : TextDecoder le retire par défaut.
      return new TextDecoder(enc, { fatal: true }).decode(b);
    } catch {
      continue;
    }
  }
  return new TextDecoder("utf-8").decode(b);
}

export function inspect(source: Uint8Array | string): Apercu {
  const t = texte(source);
  const ap = new Apercu();

  for (let ligne of t.split(/\r?\n/)) {
    ligne = ligne.trim();
    if (!ligne) continue;
    ap.lignes += 1;
    let ev: unknown;
    try {
      ev = JSON.parse(ligne);
    } catch {
      ap.illisibles += 1;
      continue;
    }
    if (typeof ev !== "object" || ev === null || !("type" in ev)) {
      ap.illisibles += 1;
      continue;
    }
    const rec = ev as Record<string, unknown>;
    ap.evenements += 1;
    const type = String(rec["type"]);
    ap.par_type[type] = (ap.par_type[type] ?? 0) + 1;
    if (!CONNUS.has(type)) ap.types_inconnus.add(type);
    if (rec["demo"]) ap.demo += 1;

    const ts = rec["ts"];
    if (typeof ts === "string") {
      const d = new Date(ts);
      if (!isNaN(d.getTime())) {
        ap.premiere = ap.premiere === null ? d : new Date(Math.min(ap.premiere.getTime(), d.getTime()));
        ap.derniere = ap.derniere === null ? d : new Date(Math.max(ap.derniere.getTime(), d.getTime()));
      }
    }
  }

  if (!ap.utilisable) {
    throw new MigrationError(
      "Ce fichier ne ressemble pas à un journal Relevé : aucune ligne " +
        "exploitable. Attendu : un fichier .jsonl dont chaque ligne est un " +
        "événement JSON avec un champ « type ».",
    );
  }
  return ap;
}

export function inspectActuelCount(store: { events(): unknown[] }): number {
  try {
    return store.events().length;
  } catch {
    return 0;
  }
}

export function sauvegarder(journal: string): string | null {
  if (!fs.existsSync(journal) || fs.statSync(journal).size === 0) return null;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
  // events.jsonl -> events.<stamp>.remplace.jsonl
  const dir = path.dirname(journal);
  const ext = path.extname(journal);
  const stem = path.basename(journal, ext);
  const dest = path.join(dir, `${stem}.${stamp}.remplace${ext}`);
  fs.copyFileSync(journal, dest);
  return dest;
}

export function install(
  source: Uint8Array | string,
  mode: "remplacer" | "ajouter" = "remplacer",
): [Apercu, number, string | null] {
  if (mode !== "remplacer" && mode !== "ajouter") {
    throw new MigrationError(`mode inconnu : ${mode}`);
  }

  const ap = inspect(source);
  const t = texte(source);
  const journal = journalPath(false);
  let sauvegarde: string | null = null;

  const lignes = t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  let ecrites: number;
  if (mode === "remplacer") {
    sauvegarde = sauvegarder(journal);
    fs.writeFileSync(journal, lignes.join("\n") + "\n", "utf-8");
    ecrites = lignes.length;
  } else {
    const deja = new Set<string>();
    if (fs.existsSync(journal)) {
      for (const l of fs.readFileSync(journal, "utf-8").split(/\r?\n/)) {
        const s = l.trim();
        if (s) deja.add(s);
      }
    }
    const neuves = lignes.filter((l) => !deja.has(l));
    if (neuves.length) fs.appendFileSync(journal, neuves.join("\n") + "\n", "utf-8");
    ecrites = neuves.length;
  }

  // De vraies données sont là : fin de la démonstration, et du premier lancement.
  const data = settings.read();
  data["demo_mode"] = false;
  data["onboarded"] = true;
  settings.write(data);
  const demo = path.join(dataDir(), "demo.jsonl");
  if (fs.existsSync(demo)) fs.rmSync(demo);

  return [ap, ecrites, sauvegarde];
}
