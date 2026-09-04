import Link from "next/link";
import { redirect } from "next/navigation";
import { dailyPnlRealise, evaluate, scopeToAccount, serverNow, type Idea } from "@releve/core";
import { currentUser, openStore } from "../journal/data";
import { activeScope } from "../settings/data";
import { advancePhaseAction } from "../settings/actions";
import ConfirmSubmit from "../components/ConfirmSubmit";
import CalendarGrid from "../components/CalendarGrid";
import { EquityCurve, PieProgress } from "../components/charts";

const PHASE_LABEL: Record<string, string> = { p1: "Phase 1", p2: "Phase 2", funded: "Financé" };

// Section VERROUILLÉE jusqu'au branchement live MT5 (voir docs/compliance.md).
// Personne n'y accède, même par URL directe. Passer à false pour rallumer.
const COMPLIANCE_LOCKED = true;

const MOIS = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const TONE_COLOR: Record<string, string> = { gain: "var(--gain)", warn: "var(--accent)", loss: "var(--loss)" };

function fmtMoney(n: number, cur: string): string {
  const [ip, dp] = Math.abs(n).toFixed(2).split(".");
  return (n < 0 ? "-" : "+") + ip!.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "." + dp + " " + cur;
}

export default async function CompliancePage() {
  if (COMPLIANCE_LOCKED) redirect("/dashboard"); // section en pause jusqu'au live MT5
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

  // Conformité PAR PHASE : à chaque passage (p2, funded), tout repart de la base.
  // On ne garde que les trades depuis le début de la phase courante, et l'équité
  // est reconstruite depuis le capital de départ (deals=[] → pas de solde absolu).
  const phaseStart = store.phaseStart(activeUid);
  const inPhase = (i: Idea) => !phaseStart || !i.closed_at || i.closed_at >= phaseStart;
  const phaseIdeas = scoped.ideas.filter(inPhase);
  // Tant qu'aucune phase n'a été franchie : comportement d'origine (soldes broker,
  // tous les trades même non rapariés). Après un passage : on repart de la base
  // (reconstruction depuis le capital de départ, sur les trades de la phase).
  const comp = phaseStart ? evaluate(active, phaseIdeas, []) : evaluate(active, scoped.ideas, scoped.deals);
  const cur = active.symbol;
  const breached = comp.breached.length > 0;
  const isFunded = active.is_funded || active.phase === "funded";
  const nextPhaseLabel = active.challenge_type === "two_phase" && active.phase === "p1" ? "Phase 2" : "Financé";

  // Jours de trading : renouvelés au MOIS (indépendant de la phase).
  const now = serverNow();
  const moisCourant = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const moisIdeas = scoped.ideas.filter((i) => i.closed_at && `${i.closed_at.getUTCFullYear()}-${String(i.closed_at.getUTCMonth() + 1).padStart(2, "0")}` === moisCourant);
  const tradingDaysMois = evaluate(active, moisIdeas, []).trading_days;

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
  // Repères temporels : jour epoch de chaque solde. Le point « départ » (sentinelle,
  // année < 2000) est calé un jour avant le premier vrai solde pour un espacement juste.
  const dayNum = (d: Date) => Math.floor(d.getTime() / 86400000);
  const firstReal = comp.equity.points.find((p) => p.when.getUTCFullYear() >= 2000);
  const baseDay = firstReal ? dayNum(firstReal.when) - 1 : 0;
  const equityXValues = comp.equity.points.map((p) => (p.when.getUTCFullYear() < 2000 ? baseDay : dayNum(p.when)));
  const equityXLabels = comp.equity.points.map((p) =>
    p.when.getUTCFullYear() < 2000 ? "départ" : `${String(p.when.getUTCDate()).padStart(2, "0")}/${String(p.when.getUTCMonth() + 1).padStart(2, "0")}`,
  );
  const minDays = active.min_trading_days ?? 0;

  return (
    <main className="wrap">
      <header className="between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Conformité prop firm</h1>
          <div className="subtitle" style={{ marginBottom: 0 }}>
            {active.label} · <span className="txt-acc">{PHASE_LABEL[active.phase] ?? active.phase}</span> · mise à jour à chaque import
          </div>
        </div>
        {!isFunded && (
          <ConfirmSubmit
            action={advancePhaseAction}
            className="ghost"
            title="Passer à la phase suivante ?"
            message={<>Ta firme t&apos;a validé cette phase ? On passe en <b>{nextPhaseLabel}</b> : la conformité (équité, drawdown, marge) <b>repart de la base</b> à partir d&apos;aujourd&apos;hui. Réversible seulement en recréant le compte — à faire seulement quand c&apos;est officiel.</>}
            confirmLabel={`Oui, passer en ${nextPhaseLabel}`}
          >
            J&apos;ai passé cette phase →
          </ConfirmSubmit>
        )}
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
      <div className="g-split" style={{ marginTop: 24 }}>
        <div>
          <div className="eyebrow bar">courbe d&apos;équité</div>
          {equityPts.length >= 2 ? (
            <div className="card"><EquityCurve points={equityPts} xLabels={equityXLabels} xValues={equityXValues} /></div>
          ) : (
            <div className="note">La courbe d&apos;équité apparaîtra dès qu&apos;un import apporte des soldes.</div>
          )}
        </div>
        <div>
          <div className="eyebrow bar">jours de trading</div>
          {minDays > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, paddingTop: 6 }}>
              <PieProgress done={tradingDaysMois} total={minDays} />
              <div className="note" style={{ textAlign: "center" }}>
                {tradingDaysMois >= minDays
                  ? <b className="txt-gain">Minimum atteint ce mois</b>
                  : <><b>{tradingDaysMois}/{minDays}</b> jour(s) de trading valides ce mois</>}
              </div>
            </div>
          ) : (
            <div className="note">Aucun minimum de jours de trading sur ce compte.</div>
          )}
        </div>
      </div>

      {/* Les règles (sans « perte journalière ») */}
      <div className="eyebrow bar" style={{ marginTop: 24 }}>où tu en es</div>
      <div className="g2">
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
