import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { mine } from "@releve/core";
import { currentUser, openStore, signedUrlsForPaths } from "../../../journal/data";
import { activeScope } from "../../../settings/data";
import { updateCampaign } from "../../actions";
import SubmitButton from "../../../components/SubmitButton";
import BlockEditor from "../../../components/BlockEditor";
import { imagePaths, initBlocks } from "@/lib/blocks";

// Modifier une thèse = l'écran de création, PRÉ-REMPLI (parcours Streamlit).
export default async function CampaignEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const store = await openStore(supabase, user.id);
  store.load();
  const { activeUid, accountUids } = await activeScope(supabase, user.id);
  const c = store.campaigns().get(id);
  if (!c || !mine(c, activeUid, accountUids)) notFound();
  if (c.closed) redirect(`/campaigns/${id}`); // clôturée : non modifiable

  const initialBlocks = initBlocks(c.blocks as unknown[] | undefined, c.note, []);
  const urlMap = await signedUrlsForPaths(supabase, imagePaths(c.blocks as unknown[] | undefined));
  const initialUrls = Object.fromEntries(urlMap);

  return (
    <main className="wrap">
      <div style={{ marginBottom: 16 }}>
        <Link href="/campaigns" className="muted">← Retour aux thèses</Link>
      </div>
      <h1 style={{ marginTop: 0 }}>Modifier la thèse</h1>

      <form action={updateCampaign} className="card" style={{ display: "grid", gap: 14 }}>
        <input type="hidden" name="campaignId" value={id} />
        <div className="g2">
          <div>
            <label>Nom de la thèse</label>
            <input name="name" defaultValue={c.name} required style={{ width: "100%" }} />
          </div>
          <div>
            <label>Conviction (1-5)</label>
            <input name="conviction" inputMode="numeric" defaultValue={c.conviction != null ? String(c.conviction) : ""} style={{ width: "100%" }} />
          </div>
        </div>
        <div className="g2">
          <div>
            <label>Thème macro</label>
            <input name="macro_theme" defaultValue={c.macro_theme} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Catalyseur attendu</label>
            <input name="catalyst" defaultValue={c.catalyst} style={{ width: "100%" }} />
          </div>
        </div>
        <div>
          <label>La thèse — écris, ajoute des visuels au fil</label>
          <BlockEditor initial={initialBlocks} initialUrls={initialUrls} />
        </div>
        <div>
          <label>Ce qui tue la thèse</label>
          <input name="kill_switch" defaultValue={c.kill_switch} style={{ width: "100%" }} />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <SubmitButton pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
          <Link href="/campaigns" className="ghost" style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", textDecoration: "none" }}>Annuler</Link>
        </div>
      </form>
    </main>
  );
}
