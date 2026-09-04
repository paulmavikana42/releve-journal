// Migration du journal LOCAL (Streamlit) vers Supabase : purge le compte cible,
// puis importe events.jsonl + settings.json + les images (data/captures).
//
// À LANCER EN LOCAL (la clé service_role reste sur ta machine) :
//   cd releve-next/apps/web
//   $env:SUPABASE_SERVICE_ROLE_KEY="..."   (PowerShell)   # depuis Supabase → Settings → API
//   node scripts/migrate-to-supabase.mjs
//
// Variables :
//   SUPABASE_SERVICE_ROLE_KEY   (obligatoire) — clé service_role du projet
//   SUPABASE_URL                (def. https://vwliceowrosoodkxjbai.supabase.co)
//   TARGET_USER_ID              (def. 1547c7d7-794b-4e41-a285-0136990dcdf2)
//   PURGE                       (def. "1" — mettre "0" pour ne pas purger avant)

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, extname } from "node:path";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || "https://vwliceowrosoodkxjbai.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER = process.env.TARGET_USER_ID || "1547c7d7-794b-4e41-a285-0136990dcdf2";
const PURGE = (process.env.PURGE ?? "1") !== "0";

if (!KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY manquante. Récupère-la dans Supabase → Settings → API (service_role), puis relance.");
  process.exit(1);
}

// --- trouver le dossier data/ (remonte depuis ce script) --------------------
function findDataDir() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const cand = join(dir, "data", "events.jsonl");
    if (existsSync(cand)) return join(dir, "data");
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error("Dossier data/ (avec events.jsonl) introuvable en remontant depuis le script.");
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

function walk(dir, base, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, base, out);
    else out.push(p);
  }
  return out;
}

async function main() {
  const dataDir = findDataDir();
  console.log(`📁 data : ${dataDir}`);
  console.log(`👤 user : ${USER}`);
  console.log(`🌐 url  : ${URL}`);

  const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

  // 1) PURGE
  if (PURGE) {
    const d1 = await supabase.from("events").delete().eq("user_id", USER);
    if (d1.error) throw new Error(`purge events : ${d1.error.message}`);
    const d2 = await supabase.from("settings").delete().eq("user_id", USER);
    if (d2.error) throw new Error(`purge settings : ${d2.error.message}`);
    console.log("🧹 purge events + settings OK");
  }

  // 2) EVENTS (dans l'ordre du fichier → id croissant = ordre de replay)
  const lines = readFileSync(join(dataDir, "events.jsonl"), "utf-8").split(/\r?\n/).filter((l) => l.trim());
  const rows = lines.map((l) => {
    const e = JSON.parse(l);
    return { user_id: USER, v: e.v ?? 1, ts: e.ts, type: e.type, payload: e.payload ?? {}, demo: false };
  });
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await supabase.from("events").insert(batch);
    if (error) throw new Error(`insert events [${i}..] : ${error.message}`);
  }
  console.log(`📝 ${rows.length} événements insérés`);

  // 3) SETTINGS (last_account_uid → active_uid pour l'app Next)
  if (existsSync(join(dataDir, "settings.json"))) {
    const s = JSON.parse(readFileSync(join(dataDir, "settings.json"), "utf-8"));
    if (s.active_uid == null && typeof s.last_account_uid === "string") s.active_uid = s.last_account_uid;
    const { error } = await supabase.from("settings").upsert({ user_id: USER, data: s, updated_at: new Date().toISOString() });
    if (error) throw new Error(`upsert settings : ${error.message}`);
    console.log(`⚙️  settings importés (${(s.accounts ?? []).length} compte(s), ${(s.watchlist ?? []).length} symbole(s))`);
  }

  // 4) IMAGES → bucket "captures", clé = chemin relatif (ex. captures/<owner>/<id>.png)
  const capDir = join(dataDir, "captures");
  if (existsSync(capDir)) {
    const files = walk(capDir, dataDir);
    let ok = 0, skip = 0;
    for (const abs of files) {
      const key = relative(dataDir, abs).split("\\").join("/"); // ex. captures/056f.../78c4....jpg
      const ext = extname(abs).toLowerCase();
      const type = MIME[ext];
      if (!type) { skip++; continue; }
      const bytes = readFileSync(abs);
      const { error } = await supabase.storage.from("captures").upload(key, bytes, { contentType: type, upsert: true });
      if (error) throw new Error(`upload ${key} : ${error.message}`);
      ok++;
    }
    console.log(`🖼️  ${ok} image(s) uploadée(s)${skip ? `, ${skip} ignorée(s) (format)` : ""}`);
  }

  console.log("✅ Migration terminée sans erreur.");
}

main().catch((e) => {
  console.error("❌ Échec :", e.message || e);
  process.exit(1);
});
