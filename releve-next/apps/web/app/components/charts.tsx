// Graphiques en SVG inline — pas de dépendance, rendu serveur, couleurs du thème.
// Calqués sur les graphes Plotly de Streamlit : graduations Y + dates en X.

type CurvePoint = { label: string; value: number };

// Graduations « rondes » (0, ±0.5, ±1…) sur un intervalle, façon Plotly.
function niceTicks(lo: number, hi: number, target = 5): number[] {
  const span = hi - lo || 1;
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : norm >= 1 ? 1 : 0.5) * mag;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(6)));
  return out;
}

const fmtTick = (v: number) => (Number.isInteger(v) ? v.toString() : v.toFixed(v < 1 && v > -1 ? 1 : 2));

/**
 * Courbe de CUMUL bicolore (R, % ou argent) : vert au-dessus de zéro, rouge en
 * dessous — la couleur dit l'état du cumul à cet instant. Origine à 0 avant le
 * premier trade. Bicolor obtenu par clip haut/bas du zéro (crossing exact).
 */
export function CumulativeCurve({
  series,
  unit = "R",
  xLabels = [],
  xValues = [],
  height = 300,
}: {
  series: CurvePoint[];
  unit?: string;
  xLabels?: string[];
  xValues?: number[];
  height?: number;
}) {
  const pts: { y: number; label: string }[] = [{ y: 0, label: "avant le premier trade" }];
  let acc = 0;
  for (const s of series) {
    acc += s.value;
    const v = unit === "R" ? `${s.value > 0 ? "+" : ""}${s.value.toFixed(2)} R` : `${s.value > 0 ? "+" : ""}${s.value.toFixed(2)}`;
    pts.push({ y: acc, label: `${s.label} · ${v}` });
  }
  const n = pts.length;
  if (n < 2) return <div className="note">La courbe apparaîtra dès une clôture au R calculable.</div>;

  const W = 720, H = height, padL = 34, padR = 12, padTop = 12, padBot = 24;
  const ys = pts.map((p) => p.y);
  let lo = Math.min(...ys, 0);
  let hi = Math.max(...ys, 0);
  const margin = (hi - lo || 1) * 0.15;
  lo -= margin; hi += margin;

  // Axe X TEMPOREL (comme Plotly) : deux clôtures le même jour se superposent →
  // segment vertical. L'origine reprend la date du premier trade.
  const xv = xValues.length === n - 1 ? [xValues[0]!, ...xValues] : pts.map((_, i) => i);
  const xMin = Math.min(...xv), xMax = Math.max(...xv);
  const xSpan = xMax - xMin || 1;
  const X = (i: number) => padL + ((xv[i]! - xMin) / xSpan) * (W - padL - padR);
  const Y = (v: number) => padTop + ((hi - v) / (hi - lo)) * (H - padTop - padBot);
  const zeroY = Y(0);
  const ticks = niceTicks(lo, hi);
  // libellés de dates X : une entrée par date DISTINCTE (évite les doublons).
  const xs = xLabels.length === n - 1 ? [xLabels[0]!, ...xLabels] : [];
  const seenX = new Set<number>();
  const xTicks = xs.length ? xs.map((lab, i) => ({ lab, x: X(i), key: xv[i]! })).filter((t) => (seenX.has(t.key) ? false : (seenX.add(t.key), true))) : [];

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const area = `M${X(0).toFixed(1)},${zeroY.toFixed(1)} ` +
    pts.map((p, i) => `L${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ") +
    ` L${X(n - 1).toFixed(1)},${zeroY.toFixed(1)} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} role="img" style={{ display: "block" }}>
      <defs>
        <clipPath id="clipTop"><rect x="0" y="0" width={W} height={zeroY} /></clipPath>
        <clipPath id="clipBot"><rect x="0" y={zeroY} width={W} height={H - zeroY} /></clipPath>
      </defs>
      {/* graduations horizontales + libellés Y */}
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={padL} y1={Y(t)} x2={W - padR} y2={Y(t)} stroke={t === 0 ? "var(--rule)" : "var(--rule-soft)"} strokeWidth={t === 0 ? 1.2 : 1} opacity={t === 0 ? 1 : 0.9} />
          <text x={padL - 6} y={Y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">{fmtTick(t)}</text>
        </g>
      ))}
      {/* aires */}
      <path d={area} fill="var(--gain)" opacity="0.10" clipPath="url(#clipTop)" />
      <path d={area} fill="var(--loss)" opacity="0.10" clipPath="url(#clipBot)" />
      {/* ligne bicolore */}
      <path d={line} fill="none" stroke="var(--gain)" strokeWidth="2" clipPath="url(#clipTop)" />
      <path d={line} fill="none" stroke="var(--loss)" strokeWidth="2" clipPath="url(#clipBot)" />
      {/* points */}
      {pts.map((p, i) => (
        <circle key={i} cx={X(i)} cy={Y(p.y)} r="3" fill={p.y >= 0 ? "var(--gain)" : "var(--loss)"}>
          <title>{`${p.label}\ncumul ${p.y > 0 ? "+" : ""}${p.y.toFixed(2)}`}</title>
        </circle>
      ))}
      {/* libellés de dates X (une par date distincte) */}
      {xTicks.map((t, i) => (
        <text key={i} x={t.x} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">{t.lab}</text>
      ))}
    </svg>
  );
}

/** Courbe de SOLDE (équité) — aire ambre, celle du compte en devise. */
export function EquityCurve({
  points,
  height = 200,
}: {
  points: { balance: number }[];
  height?: number;
}) {
  const n = points.length;
  if (n < 2) return <div className="note">Pas encore assez de soldes pour tracer l'équité.</div>;
  const W = 720, padX = 10, padTop = 12, padBot = 22;
  const bs = points.map((p) => p.balance);
  let lo = Math.min(...bs), hi = Math.max(...bs);
  const pad = (hi - lo || 100) * 0.2; lo -= pad; hi += pad;
  const X = (i: number) => padX + (i / (n - 1)) * (W - 2 * padX);
  const Y = (v: number) => padTop + ((hi - v) / (hi - lo)) * (height - padTop - padBot);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(p.balance).toFixed(1)}`).join(" ");
  const area = `${line} L${X(n - 1).toFixed(1)},${(height - padBot).toFixed(1)} L${X(0).toFixed(1)},${(height - padBot).toFixed(1)} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img" style={{ display: "block" }}>
      <path d={area} fill="var(--accent)" opacity="0.08" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
    </svg>
  );
}

/** Histogramme : une barre par idée (R), verte/rouge selon le signe. */
export function RHistogram({
  bars,
  xLabels = [],
  height = 280,
}: {
  bars: { label: string; r: number; clean: boolean | null; href?: string }[];
  xLabels?: string[];
  height?: number;
}) {
  const n = bars.length;
  if (!n) return <div className="note">Aucune idée au R calculable.</div>;
  const W = 720, padL = 30, padR = 12, padTop = 12, padBot = 24;
  const rs = bars.map((b) => b.r);
  let lo = Math.min(...rs, 0), hi = Math.max(...rs, 0);
  const margin = (hi - lo || 1) * 0.12; lo -= margin; hi += margin;
  const Y = (v: number) => padTop + ((hi - v) / (hi - lo)) * (height - padTop - padBot);
  const zeroY = Y(0);
  const slot = (W - padL - padR) / n;
  const bw = Math.min(slot * 0.62, 26);
  const ticks = niceTicks(lo, hi);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" style={{ display: "block" }}>
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={padL} y1={Y(t)} x2={W - padR} y2={Y(t)} stroke={t === 0 ? "var(--rule)" : "var(--rule-soft)"} strokeWidth={t === 0 ? 1.2 : 1} opacity="0.9" />
          <text x={padL - 6} y={Y(t) + 3} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">{fmtTick(t)}</text>
        </g>
      ))}
      {bars.map((b, i) => {
        const cx = padL + slot * (i + 0.5);
        const y = Y(Math.max(0, b.r));
        const h = Math.abs(Y(b.r) - zeroY);
        const col = b.r >= 0 ? "var(--gain)" : "var(--loss)";
        // plein = plan 5/5, semi = dégradé, contour = pas relu
        const fillOpacity = b.clean === true ? 1 : b.clean === false ? 0.33 : 0.08;
        // Zone de clic pleine hauteur (colonne entière) : ouvre l'idée, comme
        // le clic sur une barre dans Streamlit. Plus facile à viser qu'une barre fine.
        const inner = (
          <>
            <rect x={cx - slot / 2} y={padTop} width={slot} height={height - padTop - padBot} fill="transparent" />
            <rect x={cx - bw / 2} y={y} width={bw} height={Math.max(h, 1)} fill={col} fillOpacity={fillOpacity} stroke={col} strokeWidth="1" />
            {xLabels[i] && <text x={cx} y={height - 8} textAnchor="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">{xLabels[i]}</text>}
            <title>{`${b.label} · ${b.r > 0 ? "+" : ""}${b.r.toFixed(2)} R — ouvrir`}</title>
          </>
        );
        return b.href ? (
          <a key={i} href={b.href} style={{ cursor: "pointer" }}>{inner}</a>
        ) : (
          <g key={i}>{inner}</g>
        );
      })}
    </svg>
  );
}

/**
 * Anneau « pizza » : un rond divisé en `total` parts égales, `done` remplies —
 * pour les jours de trading minimum (ex. 2/3). Au centre, done/total.
 */
export function PieProgress({
  done,
  total,
  size = 150,
}: {
  done: number;
  total: number;
  size?: number;
}) {
  const n = Math.max(1, total);
  const cx = size / 2, cy = size / 2, r = size / 2 - 6;
  const rin = r * 0.58; // trou central (donut)
  const filled = Math.max(0, Math.min(n, done));
  const arc = (i: number, outer: number) => {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
    const p = (ang: number, rad: number) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${p(a0, rin)} L${p(a0, outer)} A${outer} ${outer} 0 ${large} 1 ${p(a1, outer)} L${p(a1, rin)} A${rin} ${rin} 0 ${large} 0 ${p(a0, rin)} Z`;
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" style={{ display: "block" }}>
      {Array.from({ length: n }, (_, i) => (
        <path
          key={i}
          d={arc(i, r)}
          fill={i < filled ? "var(--accent)" : "var(--rule-soft)"}
          fillOpacity={i < filled ? 0.95 : 0.5}
          stroke="var(--paper)"
          strokeWidth="2"
        />
      ))}
      <text x={cx} y={cy - 2} textAnchor="middle" fontFamily="var(--font-mono)" fontWeight="700" fontSize={size * 0.2} fill="var(--ink)">{done}</text>
      <text x={cx} y={cy + size * 0.15} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={size * 0.1} fill="var(--muted)">/ {total}</text>
    </svg>
  );
}

/** Calibration : espérance R par niveau de conviction déclaré. */
export function CalibrationChart({
  points,
  height = 220,
}: {
  points: { conviction: number; expectancy_r: number; n: number }[];
  height?: number;
}) {
  if (points.length < 2) return null;
  const W = 720, padX = 30, padTop = 16, padBot = 30;
  const rs = points.map((p) => p.expectancy_r);
  let lo = Math.min(...rs, 0), hi = Math.max(...rs, 0);
  const margin = (hi - lo || 1) * 0.2; lo -= margin; hi += margin;
  const Y = (v: number) => padTop + ((hi - v) / (hi - lo)) * (height - padTop - padBot);
  const zeroY = Y(0);
  const slot = (W - 2 * padX) / points.length;
  const bw = Math.min(slot * 0.5, 40);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" style={{ display: "block" }}>
      <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="var(--rule)" strokeWidth="1" />
      {points.map((p, i) => {
        const cx = padX + slot * (i + 0.5);
        const col = p.expectancy_r >= 0 ? "var(--gain)" : "var(--loss)";
        const y = Y(Math.max(0, p.expectancy_r));
        const h = Math.abs(Y(p.expectancy_r) - zeroY);
        return (
          <g key={i}>
            <rect x={cx - bw / 2} y={y} width={bw} height={Math.max(h, 1)} fill={col} fillOpacity="0.8">
              <title>{`conviction ${p.conviction}/5 · ${p.expectancy_r > 0 ? "+" : ""}${p.expectancy_r.toFixed(2)} R · n=${p.n}`}</title>
            </rect>
            <text x={cx} y={height - 10} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">{p.conviction}/5</text>
          </g>
        );
      })}
    </svg>
  );
}
