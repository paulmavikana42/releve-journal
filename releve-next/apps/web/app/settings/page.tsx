import { redirect } from "next/navigation";
import { currentUser } from "@/app/journal/data";
import { getAccounts, getActiveAccount } from "./data";
import {
  activateAccountAction,
  newAccountAction,
  removeAccountAction,
  saveAccountAction,
} from "./actions";
import SubmitButton from "../components/SubmitButton";
import PropRuleToggle from "./PropRuleToggle";

export default async function SettingsPage() {
  const { supabase, user } = await currentUser();
  if (!user) redirect("/login");
  const a = await getActiveAccount(supabase, user.id);
  const accounts = await getAccounts(supabase, user.id);

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
    min_days_on: a ? a.min_trading_days != null : true,
    min_trading_days: a?.min_trading_days != null ? String(a.min_trading_days) : "3",
    trading_day_threshold_pct: a ? a.trading_day_threshold_pct.toString() : "0",
    consistency_on: a ? a.consistency_pct != null && !a.consistency_pct.isZero() : false,
    consistency_pct: a?.consistency_pct ? a.consistency_pct.toString() : "30",
  };

  return (
    <main className="wrap">
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Réglages du compte</h1>
      </header>

      <p className="muted" style={{ marginTop: 0 }}>
        Les règles sont <strong>contractuelles</strong> et varient d'une firme à l'autre : rien n'est
        supposé. Ce sont elles qui rendent le tableau de bord (marge de survie, drawdown) juste.
      </p>

      {accounts.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <div className="between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: "1rem" }}>Comptes ({accounts.length})</h2>
            <form action={newAccountAction}>
              <SubmitButton className="ghost" pendingLabel="…">+ Nouveau compte</SubmitButton>
            </form>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {accounts.map((acc) => {
              const isActive = acc.uid === a?.uid;
              return (
                <div key={acc.uid} className="card between">
                  <div className="row">
                    <strong>{acc.label}</strong>
                    <span className="muted">{acc.start_balance.toFixed(0)} {acc.symbol}</span>
                    {acc.account_id && <span className="chip">#{acc.account_id}</span>}
                    {isActive && <span className="chip" style={{ color: "var(--accent)" }}>actif</span>}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    {!isActive && (
                      <form action={activateAccountAction}>
                        <input type="hidden" name="uid" value={acc.uid} />
                        <SubmitButton className="ghost" pendingLabel="…">Activer</SubmitButton>
                      </form>
                    )}
                    {accounts.length > 1 && (
                      <form action={removeAccountAction}>
                        <input type="hidden" name="uid" value={acc.uid} />
                        <SubmitButton className="ghost" pendingLabel="…">Supprimer</SubmitButton>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <h2 style={{ fontSize: "1rem" }}>{a ? "Modifier le compte actif" : "Créer ton compte"}</h2>
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label>Drawdown max (%)</label>
            <input name="max_drawdown_pct" inputMode="decimal" defaultValue={v.max_drawdown_pct} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Objectif de gain (%)</label>
            <input name="profit_target_pct" inputMode="decimal" defaultValue={v.profit_target_pct} style={{ width: "100%" }} />
          </div>
        </div>

        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" name="drawdown_static" defaultChecked={v.drawdown_static} />
          <span>Drawdown FIXE (base capital de départ)</span>
        </label>
        <div className="note">
          Drawdown FIXE : le plancher ne bouge jamais (ex. FundedNext, plancher à capital × (1 − DD %)).
          Décoché = trailing sur le plus-haut atteint.
        </div>

        {/* Règles optionnelles selon la firme */}
        <PropRuleToggle
          name="min_days_on"
          label="Jours de trading minimum"
          hint="Certaines firmes exigent un nombre minimum de journées actives. Active-le seulement si ta firme l'impose."
          defaultOn={v.min_days_on}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Nombre de jours requis</label>
              <input name="min_trading_days" inputMode="numeric" defaultValue={v.min_trading_days} style={{ width: "100%" }} />
            </div>
            <div>
              <label>% minimum par jour (un jour compte si gain ≥)</label>
              <input name="trading_day_threshold_pct" inputMode="decimal" defaultValue={v.trading_day_threshold_pct} style={{ width: "100%" }} />
            </div>
          </div>
        </PropRuleToggle>

        <PropRuleToggle
          name="consistency_on"
          label="Cohérence (consistency)"
          hint="Part maximale du profit total qu'un seul jour a le droit de peser. Vérifiée au retrait par beaucoup de firmes."
          defaultOn={v.consistency_on}
        >
          <div style={{ maxWidth: 260 }}>
            <label>Part max d'un seul jour (%)</label>
            <input name="consistency_pct" inputMode="decimal" defaultValue={v.consistency_pct} style={{ width: "100%" }} />
          </div>
        </PropRuleToggle>

        <div>
          <button type="submit" className="primary">Enregistrer</button>
        </div>
      </form>
    </main>
  );
}
