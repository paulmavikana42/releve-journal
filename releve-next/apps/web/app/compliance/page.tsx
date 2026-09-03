import Link from "next/link";
import { redirect } from "next/navigation";
import { dailyPnlRealise, evaluate, scopeToAccount } from "@releve/core";
import { currentUser, openStore } from "../journal/data";
import { activeScope } from "../settings/data";
import CalendarGrid from "../components/CalendarGrid";
import { EquityCurve, PieProgress } from "../components/charts";

const MOIS = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const TONE_COLOR: Record<string, string> = { gain: "var(--gain)", warn: "var(--accent)", loss: "var(--loss)" };

function fmtMoney(n: number, cur: string): string {
  const [ip, dp] = Math.abs(n).toFixed(2).split(".");
  return (n < 0 ? "-" : "+") + ip!.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "." + dp + " " + cur;
}

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

  if (!active) {
    return (
      <main className="wrap">
        <header style={{ marginBottom: 16 }}><h1 style={{ margin: 0 }}>Conformité prop firm</h1></header>
        <div className="card" style={{ borderColor: "var(--accent)" }}>
          <strong>Configure ton compte</strong>
          <div className="muted" style={{ fontSize: ".9rem", marginTop: 2 }}>
            Les règles sont contractuelles : sans elles, aucune conformité à vérifier.{" "}
            <Link href="/settings">Renseigner mon challenge →</Link>
          </div>
        </div>
      </main>
    );
  }

  const comp = evaluate(active, scoped.ideas, scoped.deals);
  const cur = active.symbol;
  const breached = comp.breached.length > 0;

  // Calendrier (dupliqué du tableau de bord) : P&L réellement tombé, jour par jour.
  const parJour = dailyPnlRealise(scoped.ideas, scoped.deals);
  const calDays = [...parJour.keys()].sort();
  let cal: { y: number; m: number; cells: ({ d: number; klass: string; montant: string | null } | null)[]; total: number } | null = null;
  if (calDays.length) {
    const last = calDays[calDays.length - 1]!;
    const [y, m] = last.split("-").map(Number) as [number, number];
    const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells: ({ d: number; klass: string; montant: string | null } | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    let total = 0;
    for (let d = 1; d <= nDays; d++) {
      const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const pnl = parJour.has(key) ? parJour.get(key)! : null;
      if (pnl !== null) total += pnl;
      cells.push({
        d,
        klass: pnl === null ? "" : pnl > 0 ? "gain" : pnl < 0 ? "loss" : "flat",
        montant: pnl === null ? null : fmtMoney(pnl, cur),
      });
    }
    cal = { y, m, cells, total };
  }

  const equityPts = comp.equity.points.map((p) => ({ balance: p.balance.toNumber() }));
  const minDays = active.min_trading_days ?? 0;

  return (
    <main className="wrap">
      <header style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0 }}>Conformité prop firm</h1>
        <div className="subtitle">{active.label} · mise à jour à chaque import</div>
      </header>

      {/* Statut (sans « vigilance ») */}
      <div className="card" style={{ marginBottom: 18, borderColor: breached ? "var(--loss)" : "var(--gain)", borderWidth: 2 }}>
        <strong style={{ color: breached ? "var(--loss)" : "var(--gain)", fontSize: "1.1rem" }}>
          {breached ? "Règle enfreinte" : "En règle"}
        </strong>
        <div className="muted" style={{ fontSize: ".85rem", marginTop: 2 }}>
          solde {fmtMoney(comp.balance.toNumber(), cur)} · marge avant plancher {fmtMoney(comp.margin_to_floor.toNumber(), cur)}
        </div>
        {breached && (
          <div style={{ marginTop: 8, color: "var(--loss)", fontSize: ".9rem" }}>
            Enfreinte(s) : {comp.breached.map((c) => c.label).join(", ")}
          </div>
        )}
      </div>

      {/* Calendrier — le mois, jour par jour (comme le tableau de bord) */}
      {cal && (
        <>
          <div className="eyebrow bar">le mois, jour par jour · {MOIS[cal.m]} {cal.y}</div>
          <div className="note" style={{ marginBottom: 10 }}>
            Le P&L réellement tombé sur le compte, jour par jour — c&apos;est ce que ta prop firm regarde.
            Un jour sans sortie n&apos;est pas un jour à zéro.
          </div>
          <CalendarGrid cells={cal.cells} />
          <div className="note" style={{ marginTop: 8 }}>
            Total du mois : <b className={cal.total > 0 ? "txt-gain" : cal.total < 0 ? "txt-loss" : "txt-sig"}>{fmtMoney(cal.total, cur)}</b>.
          </div>
        </>
      )}

      {/* Courbe d'équité + pizza des jours de trading minimum */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 18, marginTop: 24, alignItems: "start" }}>
        <div>
          <div className="eyebrow bar">courbe d&apos;équité</div>
          {equityPts.length >= 2 ? (
            <div className="card"><EquityCurve points={equityPts} /></div>
          ) : (
            <div className="note">La courbe d&apos;équité apparaîtra dès qu&apos;un import apporte des soldes.</div>
          )}
        </div>
        <div>
          <div className="eyebrow bar">jours de trading</div>
          {minDays > 0 ? (
            <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <PieProgress done={comp.trading_days} total={minDays} />
              <div className="note" style={{ textAlign: "center" }}>
                <b className={comp.trading_days >= minDays ? "txt-gain" : ""}>{comp.trading_days}</b> jour(s) valides sur <b>{minDays}</b> requis.
              </div>
            </div>
          ) : (
            <div className="note">Aucun minimum de jours de trading sur ce compte.</div>
          )}
        </div>
      </div>

      {/* Les règles (sans « perte journalière ») */}
      <div className="eyebrow bar" style={{ marginTop: 24 }}>où tu en es</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {comp.checks.filter((c) => c.key !== "daily").map((c) => (
          <div key={c.key} className="card between">
            <div>
              <div className="row">
                <span style={{ color: TONE_COLOR[c.tone] }}>●</span>
                <strong>{c.label}</strong>
              </div>
              {c.detail && <div className="muted" style={{ fontSize: ".82rem", marginTop: 2 }}>{c.detail}</div>}
            </div>
            <div style={{ fontWeight: 600, whiteSpace: "nowrap", color: TONE_COLOR[c.tone] }}>{c.value}</div>
          </div>
        ))}
      </div>

      <p className="muted" style={{ fontSize: ".82rem", marginTop: 14 }}>
        Le solde n&apos;est pas le solde live : l&apos;outil connaît tes trades clôturés. Le drawdown
        {active.drawdown_static ? " est FIXE (base capital de départ)" : " suit le plus-haut (trailing)"}.
      </p>
    </main>
  );
}
