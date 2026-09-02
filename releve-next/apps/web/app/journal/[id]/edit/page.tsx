import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Direction } from "@releve/core";
import { currentUser, openStore } from "../../data";
import { updateThesis } from "../../actions";
import SubmitButton from "../../../components/SubmitButton";

export default async function EditIdea({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const store = await openStore(supabase, user.id);
  const idea = store.load().ideas.get(id);
  if (!idea) notFound();
  if (idea.review) redirect(`/journal/${id}`); // une idée revue n'est plus modifiable

  const t = idea.thesis;
  const val = (x: { toString(): string } | null | undefined) => (x != null ? x.toString() : "");

  return (
    <main className="wrap">
      <div style={{ marginBottom: 16 }}>
        <Link href={`/journal/${id}`} className="muted">← retour à l'idée</Link>
      </div>
      <h1 style={{ marginTop: 0 }}>Modifier l'idée</h1>

      <form action={updateThesis} className="card" style={{ display: "grid", gap: 14 }}>
        <input type="hidden" name="ideaId" value={id} />

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr .8fr .9fr", gap: 12 }}>
          <div>
            <label>Instrument</label>
            <input name="instrument" defaultValue={t?.instrument ?? ""} required style={{ width: "100%" }} />
          </div>
          <div>
            <label>Sens</label>
            <select name="direction" defaultValue={t?.direction === Direction.SELL ? "sell" : "buy"} style={{ width: "100%" }}>
              <option value="buy">Achat</option>
              <option value="sell">Vente</option>
            </select>
          </div>
          <div>
            <label>Conviction (1-5)</label>
            <input name="conviction" inputMode="numeric" defaultValue={t?.conviction != null ? String(t.conviction) : ""} style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
          <div>
            <label>Entrée visée</label>
            <input name="entry_planned" inputMode="decimal" defaultValue={val(t?.entry_planned)} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Stop initial</label>
            <input name="stop_initial" inputMode="decimal" defaultValue={val(t?.stop_initial)} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Risque (%)</label>
            <input name="risk_pct" inputMode="decimal" defaultValue={val(t?.risk_pct)} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Objectifs (séparés par espace)</label>
            <input name="targets" defaultValue={(t?.targets ?? []).map((x) => x.toString()).join(" ")} style={{ width: "100%" }} />
          </div>
        </div>

        <div>
          <label>Libellé</label>
          <input name="label" defaultValue={idea.label} placeholder="Short NDX100 — CPI" style={{ width: "100%" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label>Thème macro</label>
            <input name="macro_theme" defaultValue={t?.macro_theme ?? ""} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Catalyseur</label>
            <input name="catalyst" defaultValue={t?.catalyst ?? ""} style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label>Setup</label>
            <input name="setup" defaultValue={t?.setup ?? ""} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Unité de temps</label>
            <input name="timeframe" defaultValue={t?.timeframe ?? ""} style={{ width: "100%" }} />
          </div>
        </div>

        <div>
          <label>Invalidation (kill switch)</label>
          <input name="thesis_kill_switch" defaultValue={t?.thesis_kill_switch ?? ""} style={{ width: "100%" }} />
        </div>
        <div>
          <label>Note technique</label>
          <textarea name="technical_note" rows={2} defaultValue={t?.technical_note ?? ""} style={{ width: "100%" }} />
        </div>
        <div>
          <label>Note macro</label>
          <textarea name="macro_note" rows={2} defaultValue={t?.macro_note ?? ""} style={{ width: "100%" }} />
        </div>

        <div className="row" style={{ gap: 10 }}>
          <SubmitButton pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
          <Link href={`/journal/${id}`} className="ghost" style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", textDecoration: "none" }}>
            Annuler
          </Link>
        </div>
      </form>
    </main>
  );
}
