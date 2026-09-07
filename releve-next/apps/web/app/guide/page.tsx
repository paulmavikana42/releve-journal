"use client";

import Link from "next/link";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Guide d'onboarding interactif. 100 % autonome (aucune donnée réelle) : les
// exemples sont FICTIFS mais volontairement ultra-cohérents — une vraie histoire
// macro (« dollar fort ») jouée sur deux instruments, pour qu'un nouvel arrivant
// comprenne le cycle en un coup d'œil et ait envie de s'y mettre.
// ---------------------------------------------------------------------------

type Step = {
  n: number;
  title: string;
  tag: string;
  body: React.ReactNode;
};

const STEPS: Step[] = [
  {
    n: 1,
    title: "Écris l'idée — avant d'entrer",
    tag: "armée",
    body: (
      <>
        Une idée, c&apos;est ta <b>prédiction écrite</b> : l&apos;instrument, le sens, ton stop, ta
        conviction, et pourquoi. Tu l&apos;écris <b>avant</b> de cliquer sur « acheter ». C&apos;est la seule
        chose qui permettra à Relevé de te <b>contredire</b> plus tard — un tableur ne le fera jamais.
      </>
    ),
  },
  {
    n: 2,
    title: "Déclare ton ticket — à l'entrée",
    tag: "● en cours",
    body: (
      <>
        Dès que tu entres, note le <b>numéro de ticket</b> (30 s sur mobile). L&apos;idée passe « en cours »
        et ton <b>vrai stop</b> est gravé — avant que le broker ne l&apos;écrase au premier breakeven. Ce
        numéro deviendra la clé qui rapprochera ton trade au moment de l&apos;import.
      </>
    ),
  },
  {
    n: 3,
    title: "Le trade vit",
    tag: "en cours",
    body: (
      <>
        Tu déplaces ton stop, tu ajoutes une capture d&apos;écran du ticket, tu renforces. Tout ça vit
        dans l&apos;outil <b>pendant</b> le trade — pas seulement après. Un renforcement porte son propre
        risque : Relevé te le demande plutôt que de deviner.
      </>
    ),
  },
  {
    n: 4,
    title: "Importe ton rapport",
    tag: "clôturé",
    body: (
      <>
        À la sortie, dépose l&apos;export de ton terminal (HTML MT5 ou CSV). Le rapprochement se fait
        <b> par numéro de ticket</b>, jamais par ressemblance : un trade déjà déclaré est complété, jamais
        dupliqué. Réimporter le même fichier n&apos;ajoute rien.
      </>
    ),
  },
  {
    n: 5,
    title: "Relis — et les stats s'allument",
    tag: "revue",
    body: (
      <>
        Une question simple : le marché t&apos;a-t-il donné raison, et as-tu respecté ton plan ? De cette
        relecture naît la matrice <b>décision × résultat</b> — la seule qui distingue un gain mérité d&apos;un
        coup de chance. C&apos;est là que Relevé devient utile.
      </>
    ),
  },
];

function StatusChip({ label }: { label: string }) {
  const cls = label.includes("en cours") ? "acc" : label === "armée" ? "sig" : label === "revue" ? "ok" : "";
  return <span className={`chip ${cls}`}>{label}</span>;
}

// Une petite courbe d'équité ascendante (fictive), même esprit que le dashboard.
function DemoEquity() {
  const pts = [0, 0.8, 0.5, 1.6, 2.1, 1.9, 2.8, 3.4, 3.1, 4.0, 4.18];
  const W = 520, H = 150, PL = 34, PB = 20, PT = 10, PR = 8;
  const max = 4.6, min = 0;
  const x = (i: number) => PL + (i / (pts.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - min) / (max - min)) * (H - PT - PB);
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${d} L${x(pts.length - 1).toFixed(1)},${(H - PB).toFixed(1)} L${x(0).toFixed(1)},${(H - PB).toFixed(1)} Z`;
  const ticks = [0, 1, 2, 3, 4];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Courbe d'équité fictive ascendante" style={{ maxWidth: "100%" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke="var(--rule-soft)" strokeWidth="1" />
          <text x={PL - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">{t}R</text>
        </g>
      ))}
      <path d={area} fill="var(--accent)" opacity="0.10" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="2.4" fill="var(--accent)" />)}
    </svg>
  );
}

export default function GuidePage() {
  const [openStep, setOpenStep] = useState(1);

  return (
    <main className="wrap">
      <header style={{ marginBottom: 18 }}>
        <div className="eyebrow">bienvenue</div>
        <h1 style={{ margin: "2px 0 0" }}>
          Relev<span style={{ color: "var(--accent)" }}>é</span> — le journal qui peut te contredire
        </h1>
        <div className="subtitle" style={{ marginTop: 6 }}>
          Un tableur enregistre tes trades. Relevé confronte ta <b>prédiction écrite avant l&apos;entrée</b> à
          ce que le marché a réellement fait — et te dit, chiffres à l&apos;appui, si tu as eu raison ou juste
          de la chance.
        </div>
      </header>

      {/* LE CYCLE — accordéon interactif */}
      <div className="eyebrow bar">le cycle, en 5 gestes</div>
      <div className="note" style={{ marginBottom: 12 }}>
        Clique une étape pour la déployer. Tout découle d&apos;un seul principe : l&apos;idée s&apos;écrit
        <b> avant</b> le trade.
      </div>
      <div className="guide-steps">
        {STEPS.map((s) => {
          const on = openStep === s.n;
          return (
            <div key={s.n} className={`guide-step ${on ? "on" : ""}`}>
              <button className="guide-step-head" onClick={() => setOpenStep(on ? 0 : s.n)} aria-expanded={on}>
                <span className="guide-step-num">{s.n}</span>
                <span className="guide-step-title">{s.title}</span>
                <StatusChip label={s.tag} />
                <span className="guide-step-caret" aria-hidden>{on ? "▾" : "▸"}</span>
              </button>
              {on && <div className="guide-step-body note">{s.body}</div>}
            </div>
          );
        })}
      </div>

      {/* ÉCRIRE UNE THÈSE — mis en avant */}
      <div className="card" style={{ borderColor: "var(--accent)", background: "rgba(255,196,84,.05)", marginTop: 22 }}>
        <div className="eyebrow" style={{ color: "var(--accent)" }}>écris aussi tes thèses</div>
        <div style={{ fontWeight: 600, margin: "3px 0 6px" }}>Une même conviction, plusieurs instruments = une thèse</div>
        <div className="note">
          Quand une seule lecture du monde te fait prendre plusieurs positions — « dollar fort » joué
          <b> short EURUSD</b> ET <b>long USDJPY</b> — écris-la comme <b>thèse macro</b> dans l&apos;onglet
          <b> Thèses</b> (même éditeur par blocs que les idées : texte + captures), puis rattache-lui tes
          idées. Relevé la compte alors comme <b>une seule décision</b> et <b>somme les R</b> de ses jambes —
          sinon un pari joué sur trois instruments compterait trois fois et gonflerait ton échantillon.
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <Link href="/campaigns?vue=ecrire" className="ghost" style={{ textDecoration: "none" }}>Écrire une thèse macro</Link>
        </div>
      </div>

      {/* EXEMPLE MACRO ULTRA-COHÉRENT */}
      <div className="eyebrow bar" style={{ marginTop: 30 }}>un exemple concret</div>
      <div className="note" style={{ marginBottom: 12 }}>
        Voici une <b>thèse macro</b> réelle dans sa forme : une seule lecture du monde, jouée sur plusieurs
        instruments. C&apos;est <b>une décision</b>, pas trois — Relevé la compte comme telle.
      </div>

      <div className="card" style={{ borderColor: "var(--rule)", marginBottom: 14 }}>
        <div className="between" style={{ flexWrap: "wrap", gap: 8 }}>
          <div>
            <div className="eyebrow" style={{ margin: 0 }}>thèse macro</div>
            <h2 style={{ margin: "2px 0 0", fontSize: "1.1rem" }}>Dollar fort — la Fed tient, la BCE lâche</h2>
          </div>
          <span className="chip sig">2 jambes · +3.5 R</span>
        </div>
        <div className="note" style={{ marginTop: 8 }}>
          <b>Catalyseur</b> : l&apos;inflation américaine résiste, la Fed repousse ses baisses ; la BCE, elle,
          a déjà commencé à assouplir. Le différentiel de taux pousse le billet vert. <b>Invalidée si</b> un
          chiffre d&apos;emploi US franchement mauvais fait replonger les taux.
        </div>
      </div>

      <div className="split-a" style={{ marginBottom: 8 }}>
        <IdeaCard
          symbol="EURUSD"
          sens="short"
          sensCls="bad"
          entry="1.0865"
          stop="1.0930"
          tp="1.0680"
          conv={4}
          r="+2.1 R"
          rTone="gain"
          quad={["Maîtrise", "ok", "✓"]}
          note="La BCE a ouvert la porte aux baisses ; l'euro perd son avantage de taux."
        />
        <IdeaCard
          symbol="USDJPY"
          sens="long"
          sensCls="ok"
          entry="154.20"
          stop="152.90"
          tp="158.00"
          conv={3}
          r="+1.4 R"
          rTone="gain"
          quad={["Aléa OK", "sig", "↺"]}
          note="La BoJ reste ultra-accommodante : le portage joue en faveur du dollar."
        />
      </div>
      <div className="note" style={{ marginBottom: 22 }}>
        Une <b>idée seule</b> (sans thèse) compte pour elle-même — par exemple un long XAUUSD sorti au
        breakeven : le marché n&apos;a pas tranché, elle sera marquée « non testée » et ne polluera pas ton
        taux de justesse.
      </div>

      {/* APERÇU DU DASHBOARD */}
      <div className="eyebrow bar">à quoi ressemble ton tableau de bord</div>
      <div className="note" style={{ marginBottom: 12 }}>
        Après quelques trades relus, voici ce que tu lis d&apos;un coup d&apos;œil (chiffres d&apos;exemple) :
      </div>

      <section className="kpigrid" style={{ marginBottom: 14 }}>
        <Kpi label="Gain net" value="+4 180 $" tone="gain" sub="11 clôturée(s) · +4.18 %" />
        <Kpi label="Profit factor" value="2.30" tone="gain" sub="tes gains dépassent tes pertes" />
        <Kpi label="Win rate" value="64 %" sub="part de tes décisions gagnantes" />
        <Kpi label="Espérance" value="+0.42 R" tone="gain" sub="par idée" />
      </section>

      <div className="split">
        <div>
          <div className="eyebrow bar" style={{ margin: "0 0 6px" }}>courbe d&apos;équité · cumul (R)</div>
          <DemoEquity />
          <div className="note" style={{ marginTop: 4 }}>
            La courbe du <b>R cumulé</b> neutralise ta taille de position : c&apos;est celle de ta
            <b> compétence</b>, pas de ton levier.
          </div>
        </div>
        <div>
          <div className="eyebrow bar" style={{ margin: "0 0 6px" }}>décision × résultat</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Quad klass="luck" label="Gain / mauvais process" n={1} val="+180 $" />
            <Quad klass="mastery" label="Gain / bon process" n={6} val="+3 640 $" />
            <Quad klass="error" label="Perte / mauvais process" n={1} val="-410 $" />
            <Quad klass="variance" label="Perte / bon process" n={2} val="-230 $" />
          </div>
          <div className="note" style={{ marginTop: 8 }}>
            ← process discipliné sur <b>73 %</b> de tes idées relues. La case qui compte est
            <b> « Chance »</b> : un mauvais process qui a payé, c&apos;est celui qu&apos;on répète par erreur.
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="eyebrow bar" style={{ marginTop: 30 }}>à toi de jouer</div>
      <div className="card between" style={{ flexWrap: "wrap", gap: 12, borderColor: "var(--rule)" }}>
        <div className="note" style={{ margin: 0, maxWidth: 460 }}>
          Deux minutes pour démarrer : règle ton compte (capital et type), puis écris ta première idée
          <b> avant</b> ton prochain trade. C&apos;est tout.
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Link href="/settings" className="ghost">Régler mon compte</Link>
          <Link href="/campaigns?vue=ecrire" className="ghost" style={{ textDecoration: "none" }}>
            Écrire une thèse
          </Link>
          <Link href="/journal?vue=ecrire" className="primary" style={{ textDecoration: "none" }}>
            Écrire ma première idée
          </Link>
        </div>
      </div>
    </main>
  );
}

// ------------------------------------------------------------------ sous-blocs

function IdeaCard({
  symbol, sens, sensCls, entry, stop, tp, conv, r, rTone, quad, note,
}: {
  symbol: string; sens: string; sensCls: string; entry: string; stop: string; tp: string;
  conv: number; r: string; rTone: string; quad: [string, string, string]; note: string;
}) {
  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="between" style={{ flexWrap: "wrap", gap: 6 }}>
        <div className="row" style={{ gap: 8 }}>
          <b style={{ fontSize: "1.02rem" }}>{symbol}</b>
          <span className={`chip ${sensCls}`}>{sens}</span>
        </div>
        <span className={`chip ${quad[1]}`}>{quad[2]} {quad[0]}</span>
      </div>
      <div className="row" style={{ gap: 14, flexWrap: "wrap", marginTop: 8 }}>
        <Field label="entrée" value={entry} />
        <Field label="stop" value={stop} />
        <Field label="objectif" value={tp} />
        <Field label="conviction" value={`${conv}/5`} />
        <Field label="résultat" value={r} tone={rTone} />
      </div>
      <div className="note" style={{ marginTop: 8 }}>{note}</div>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const color = tone === "gain" ? "var(--gain)" : tone === "loss" ? "var(--loss)" : "var(--ink)";
  return (
    <div>
      <div className="eyebrow" style={{ margin: 0 }}>{label}</div>
      <div className="mono" style={{ fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  const color = tone === "gain" ? "var(--gain)" : tone === "loss" ? "var(--loss)" : "var(--ink)";
  return (
    <div className="card kpi">
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div className="stat" style={{ color }}>{value}</div>
      {sub && <div className="note">{sub}</div>}
    </div>
  );
}

function Quad({ klass, label, n, val }: { klass: string; label: string; n: number; val: string }) {
  return (
    <div className={`quad ${klass}`}>
      <div className="lab">{label}</div>
      <div className="n">{n}</div>
      <div className="mono" style={{ fontSize: ".82rem", opacity: 0.85 }}>{val}</div>
    </div>
  );
}
