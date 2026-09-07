// Nettoie les images ORPHELINES du bucket "captures" : les clés de l'ancien
// schéma (captures/<owner>/…) que la migration a remplacées par des clés
// préfixées par l'uid (<uid>/captures/…). Elles sont inaccessibles sous la RLS
// Storage et n'apparaissent nulle part dans l'app — on les supprime via l'API
// Storage (la seule voie propre : elle enlève aussi le fichier physique).
//
// À LANCER EN LOCAL (la clé service_role reste sur ta machine) :
//   cd releve-next/apps/web
//   $env:SUPABASE_SERVICE_ROLE_KEY="..."   (PowerShell)
//   node scripts/clean-orphan-captures.mjs
//
// DRY_RUN=1 pour seulement lister ce qui serait supprimé, sans rien effacer.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || "https://vwliceowrosoodkxjbai.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USER = process.env.TARGET_USER_ID || "1547c7d7-794b-4e41-a285-0136990dcdf2";
const DRY = process.env.DRY_RUN === "1";

if (!KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY manquante. Récupère-la dans Supabase → Settings → API (service_role), puis relance.");
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

// Liste RÉCURSIVE d'un préfixe du bucket (l'API paginate par dossier).
async function listAll(prefix) {
  const out = [];
  let page = 0;
  // parcours large : on descend dossier par dossier
  async function walk(pfx) {
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase.storage
        .from("captures")
        .list(pfx, { limit: 100, offset });
      if (error) throw new Error(`list ${pfx} : ${error.message}`);
      if (!data.length) break;
      for (const entry of data) {
        const full = pfx ? `${pfx}/${entry.name}` : entry.name;
        // un "dossier" n'a pas d'id ; un fichier a un id + metadata
        if (entry.id == null && entry.metadata == null) await walk(full);
        else out.push(full);
      }
      if (data.length < 100) break;
      offset += 100;
      if (++page > 10000) throw new Error("garde-fou : trop de pages");
    }
  }
  await walk(prefix);
  return out;
}

async function main() {
  console.log(`🌐 ${URL}`);
  console.log(`👤 uid conservé : ${USER}`);

  // On liste la racine : tout ce qui ne commence PAS par l'uid est orphelin.
  const roots = (await supabase.storage.from("captures").list("", { limit: 100 })).data ?? [];
  const orphanPrefixes = roots
    .filter((e) => e.name !== USER)
    .map((e) => e.name);

  let keys = [];
  for (const p of orphanPrefixes) {
    // un fichier à la racine (rare) ou un dossier ancien-schéma ("captures")
    if (p.includes(".")) keys.push(p);
    else keys.push(...(await listAll(p)));
  }

  if (!keys.length) {
    console.log("✅ Rien à nettoyer — aucune clé orpheline.");
    return;
  }
  console.log(`🗑️  ${keys.length} objet(s) orphelin(s) :`);
  for (const k of keys) console.log(`   - ${k}`);

  if (DRY) {
    console.log("💡 DRY_RUN=1 : rien supprimé. Relance sans DRY_RUN pour effacer.");
    return;
  }

  // suppression par lots de 100
  let removed = 0;
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const { error } = await supabase.storage.from("captures").remove(batch);
    if (error) throw new Error(`remove [${i}..] : ${error.message}`);
    removed += batch.length;
  }
  console.log(`✅ ${removed} image(s) orpheline(s) supprimée(s). Bucket propre.`);
}

main().catch((e) => {
  console.error("❌ Échec :", e.message || e);
  process.exit(1);
});
