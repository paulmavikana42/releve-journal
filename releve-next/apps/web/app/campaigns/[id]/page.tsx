import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, openStore, signedUrlsForPaths } from "../../journal/data";
import { activeScope } from "../../settings/data";
import { mine } from "@releve/core";
import BlockView from "../../components/BlockView";
import { imagePaths } from "@/lib/blocks";

// « Relire la thèse » — une page de LECTURE (miroir de campaigns._lecture) :
// le texte se lit comme un article, images intégrées à leur légende.
export default async function CampaignRead({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const store = await openStore(supabase, user.id);
  store.load();
  const { activeUid, accountUids } = await activeScope(supabase, user.id);
  const c = store.campaigns().get(id);
  if (!c || !mine(c, activeUid, accountUids)) notFound();

  const urlMap = await signedUrlsForPaths(supabase, imagePaths(c.blocks as unknown[] | undefined));
  const urls = Object.fromEntries(urlMap);

  return (
    <main className="wrap">
      <div style={{ marginBottom: 16 }}>
        <Link href="/campaigns" className="muted">← Retour aux thèses</Link>
      </div>
      <h1 style={{ marginTop: 0 }}>{c.display_name}</h1>
      <div className="note" style={{ marginBottom: 18 }}>
        {c.macro_theme || "thèse macro"}
        {c.catalyst ? ` · catalyseur : ${c.catalyst}` : ""}
        {c.conviction != null && <span className="chip" style={{ marginLeft: 8 }}>conviction {c.conviction}/5</span>}
      </div>

      <div className="eyebrow bar">la thèse</div>
      <div style={{ marginTop: 8 }}>
        <BlockView blocks={c.blocks as unknown[] | undefined} note={c.note} urls={urls} />
      </div>

      {c.kill_switch && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="eyebrow">ce qui tue la thèse</div>
          <p style={{ fontSize: ".95rem", lineHeight: 1.6, marginTop: 8, whiteSpace: "pre-wrap" }}>{c.kill_switch}</p>
        </div>
      )}
    </main>
  );
}
