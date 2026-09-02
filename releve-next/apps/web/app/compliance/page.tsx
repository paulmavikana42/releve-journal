import Link from "next/link";
import { redirect } from "next/navigation";
import { evaluate, scopeToAccount } from "@releve/core";
import { currentUser, openStore } from "../journal/data";
import { activeScope } from "../settings/data";

const TONE_COLOR: Record<string, string> = {
  gain: "var(--gain)",
  warn: "var(--accent)",
  loss: "var(--loss)",
};

export default async function CompliancePage() {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");

  const store = await openStore(supabase, user.id);
  const loaded = store.load();
  const { active, activeUid, accountUids } = await activeScope(supabase, user.id);
  const scoped = scopeToAccount(
    { ideas: loaded.ideas, campaigns: store.campaigns(), deals: loaded.deals },
    activeUid,
    accountUids,
  );

  return (
    <main className="wrap">
      <header className="between" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Conformité prop firm</h1>
        <nav className="row" style={{ gap: 14 }}>
          <Link href="/journal" className="muted">Journal</Link>
          <Link href="/dashboard" className="muted">Tableau de bord</Link>
          <Link href="/settings" className="muted">Réglages</Link>
        </nav>
      </header>

      {!active ? (
        <div className="card" style={{ borderColor: "var(--accent)" }}>
          <strong>Configure ton compte</strong>
          <div className="muted" style={{ fontSize: ".9rem", marginTop: 2 }}>
            Les règles sont contractuelles : sans elles, aucune conformité à vérifier.{" "}
            <Link href="/settings">Renseigner mon challenge →</Link>
          </div>
        </div>
      ) : (
        (() => {
          const comp = evaluate(active, scoped.ideas, scoped.deals);
          const cur = active.symbol;
          const toneLabel =
            comp.tone === "loss" ? "Règle enfreinte" : comp.tone === "warn" ? "Vigilance" : "En règle";
          return (
            <>
              <div
                className="card"
                style={{ marginBottom: 16, borderColor: TONE_COLOR[comp.tone], borderWidth: 2 }}
              >
                <div className="between">
                  <div>
                    <strong style={{ color: TONE_COLOR[comp.tone], fontSize: "1.1rem" }}>{toneLabel}</strong>
                    <div className="muted" style={{ fontSize: ".85rem" }}>
                      {active.label} · solde {comp.balance.toFixed(2)} {cur} · marge avant plancher{" "}
                      {comp.margin_to_floor.toFixed(2)} {cur}
                    </div>
                  </div>
                </div>
                {comp.breached.length > 0 && (
                  <div style={{ marginTop: 8, color: "var(--loss)", fontSize: ".9rem" }}>
                    Enfreinte(s) : {comp.breached.map((c) => c.label).join(", ")}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {comp.checks.map((c) => (
                  <div key={c.key} className="card between">
                    <div>
                      <div className="row">
                        <span style={{ color: TONE_COLOR[c.tone] }}>●</span>
                        <strong>{c.label}</strong>
                      </div>
                      {c.detail && (
                        <div className="muted" style={{ fontSize: ".82rem", marginTop: 2 }}>{c.detail}</div>
                      )}
                    </div>
                    <div style={{ fontWeight: 600, whiteSpace: "nowrap", color: TONE_COLOR[c.tone] }}>
                      {c.value}
                    </div>
                  </div>
                ))}
              </div>

              <p className="muted" style={{ fontSize: ".82rem", marginTop: 12 }}>
                Le solde n'est pas le solde live : l'outil connaît tes trades clôturés. Le drawdown
                {active.drawdown_static ? " est FIXE (base capital de départ)" : " suit le plus-haut (trailing)"}.
              </p>
            </>
          );
        })()
      )}
    </main>
  );
}
