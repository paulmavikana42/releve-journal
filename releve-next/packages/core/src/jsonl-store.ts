// Journal adossé à un fichier JSONL — port fidèle du Store de core/store.py.
//
// Le Store de base garde le journal EN MÉMOIRE (moteur pur, tests, non-régression
// en chargeant un events.jsonl via fromEvents). JsonlStore, lui, relit le fichier
// à CHAQUE events() et y écrit à CHAQUE append() : deux instances Store(path)
// partagent donc l'état par le disque, exactement comme en Python. C'est le
// backend « local/serveur » ; le backend Supabase se branchera derrière la même
// API.
import * as fs from "node:fs";
import * as path from "node:path";
import { Store, EventRecord, SCHEMA_VERSION, encode } from "./store";

export class JsonlStore extends Store {
  readonly path: string;

  constructor(filePath: string, opts: { demo?: boolean } = {}) {
    super({ demo: opts.demo });
    this.path = filePath;
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
  }

  override append(eventType: string, payload: Record<string, unknown>): EventRecord {
    const ev: EventRecord = {
      v: SCHEMA_VERSION,
      ts: new Date().toISOString(),
      type: eventType,
      payload: encode(payload),
    };
    if (this.demo) ev.demo = true;
    fs.appendFileSync(this.path, JSON.stringify(ev) + "\n", "utf-8");
    return ev;
  }

  override events(): EventRecord[] {
    if (!fs.existsSync(this.path)) return [];
    const out: EventRecord[] = [];
    const lines = fs.readFileSync(this.path, "utf-8").split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as EventRecord);
      } catch {
        // Une ligne corrompue ne fait jamais tomber le journal.
      }
    }
    return out;
  }

  /** Copie datée du journal (.<stamp>.bak), ou null s'il n'existe pas encore. */
  backup(): string | null {
    if (!fs.existsSync(this.path)) return null;
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
    const dest = this.path.replace(/\.jsonl$/, `.${stamp}.bak`);
    fs.copyFileSync(this.path, dest);
    return dest;
  }
}
