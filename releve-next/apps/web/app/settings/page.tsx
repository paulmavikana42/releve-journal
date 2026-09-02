import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/app/journal/data";
import { getActiveAccount } from "./data";
import { saveAccountAction } from "./actions";

export default async function SettingsPage() {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const a = await getActiveAccount(supabase, user.id);

  const v = {
    label: a?.label ?? "FundedNext",
    account_id: a?.account_id ?? "",
    currency: a?.currency ?? "USD",
    start_balance: a ? a.start_balance.toString() : "100000",
    challenge_type: a?.challenge_type ?? "two_phase",
    phase: a?.phase ?? "p1",
    daily_loss_pct: a ? a.daily_loss_pct.toString() : "5",
    max_drawdown_pct: a ? a.max_drawdown_pct.toString() : "10",
    drawdown_static: a ? a.drawdown_static : true,
    profit_target_pct: a?.profit_target_pct ? a.profit_target_pct.toString() : "8",
    min_trading_days: a?.min_trading_days != null ? String(a.min_trading_days) : "3",
  };

  return (
    <main className="wrap">
      <header className="between" style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Réglages du compte</h1>
        <nav className="row" style={{ gap: 14 }}>
          <Link href="/journal" className="muted">Journal</Link>
          <Link href="/dashboard" className="muted">Tableau de bord</Link>
        </nav>
      </header>

      <p className="muted" style={{ marginTop: 0 }}>
        Les règles sont <strong>contractuelles</strong> et varient d'une firme à l'autre : rien n'est
        supposé. Ce sont elles qui rendent le tableau de bord (marge de survie, drawdown) juste.
      </p>

      <form action={saveAccountAction} className="card" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <div>
            <label>Nom du compte</label>
            <input name="label" defaultValue={v.label} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Devise</label>
            <select name="currency" defaultValue={v.currency} style={{ width: "100%" }}>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label>Numéro de compte broker (facultatif)</label>
            <input name="account_id" defaultValue={v.account_id} placeholder="ex. 81714841" style={{ width: "100%" }} />
          </div>
          <div>
            <label>Capital de départ</label>
            <input name="start_balance" inputMode="decimal" defaultValue={v.start_balance} style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label>Type de challenge</label>
            <select name="challenge_type" defaultValue={v.challenge_type} style={{ width: "100%" }}>
              <option value="one_phase">Une phase</option>
              <option value="two_phase">Deux phases</option>
              <option value="instant">Compte financé (instant)</option>
            </select>
          </div>
          <div>
            <label>Phase actuelle</label>
            <select name="phase" defaultValue={v.phase} style={{ width: "100%" }}>
              <option value="p1">Phase 1</option>
              <option value="p2">Phase 2</option>
              <option value="funded">Financé</option>
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <label>Perte journalière max (%)</label>
            <input name="daily_loss_pct" inputMode="decimal" defaultValue={v.daily_loss_pct} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Drawdown max (%)</label>
            <input name="max_drawdown_pct" inputMode="decimal" defaultValue={v.max_drawdown_pct} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Objectif de gain (%)</label>
            <input name="profit_target_pct" inputMode="decimal" defaultValue={v.profit_target_pct} style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "center" }}>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" name="drawdown_static" defaultChecked={v.drawdown_static} />
            <span>Drawdown FIXE (base capital de départ)</span>
          </label>
          <div>
            <label>Jours de trading minimum</label>
            <input name="min_trading_days" inputMode="numeric" defaultValue={v.min_trading_days} style={{ width: "100%" }} />
          </div>
        </div>
        <div className="muted" style={{ fontSize: ".82rem" }}>
          Drawdown FIXE : le plancher ne bouge jamais (ex. FundedNext, plancher à
          capital × (1 − DD%)). Décoché = trailing sur le plus-haut atteint.
        </div>

        <div>
          <button type="submit" className="primary">Enregistrer</button>
        </div>
      </form>
    </main>
  );
}
