// Graphiques en SVG inline — pas de dépendance, rendu serveur, couleurs du thème.
// On affinera au pixel avec les maquettes Streamlit (Plotly) ensuite.

type CurvePoint = { label: string; value: number };

/**
 * Courbe de CUMUL bicolore (R, % ou argent) : vert au-dessus de zéro, rouge en
 * dessous — la couleur dit l'état du cumul à cet instant. Origine à 0 avant le
 * premier trade. Bicolor obtenu par clip haut/bas du zéro (crossing exact).
 */
export function CumulativeCurve({
  series,
  unit = "R",
  height = 300,
}: {
  series: CurvePoint[];
  unit?: string;
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

  const W = 720, H = height, padX = 10, padTop = 12, padBot = 22;
  const ys = pts.map((p) => p.y);
  let lo = Math.min(...ys, 0);
  let hi = Math.max(...ys, 0);
  const margin = (hi - lo || 1) * 0.15;
  lo -= margin; hi += margin;
  const X = (i: number) => padX + (i / (n - 1)) * (W - 2 * padX);
  const Y = (v: number) => padTop + ((hi - v) / (hi - lo)) * (H - padTop - padBot);
  const zeroY = Y(0);

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const area = `M${X(0).toFixed(1)},${zeroY.toFixed(1)} ` +
    pts.map((p, i) => `L${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ") +
    ` L${X(n - 1).toFixed(1)},${zeroY.toFixed(1)} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none" role="img" style={{ display: "block" }}>
      <defs>
        <clipPath id="clipTop"><rect x="0" y="0" width={W} height={zeroY} /></clipPath>
        <clipPath id="clipBot"><rect x="0" y={zeroY} width={W} height={H - zeroY} /></clipPath>
      </defs>
      {/* ligne de zéro */}
      <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="var(--rule)" strokeWidth="1" strokeDasharray="2 3" />
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
  height = 220,
}: {
  bars: { label: string; r: number; clean: boolean | null }[];
  height?: number;
}) {
  const n = bars.length;
  if (!n) return <div className="note">Aucune idée au R calculable.</div>;
  const W = 720, padX = 10, padTop = 12, padBot = 22;
  const rs = bars.map((b) => b.r);
  let lo = Math.min(...rs, 0), hi = Math.max(...rs, 0);
  const margin = (hi - lo || 1) * 0.12; lo -= margin; hi += margin;
  const Y = (v: number) => padTop + ((hi - v) / (hi - lo)) * (height - padTop - padBot);
  const zeroY = Y(0);
  const slot = (W - 2 * padX) / n;
  const bw = Math.min(slot * 0.62, 22);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" style={{ display: "block" }}>
      <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="var(--rule)" strokeWidth="1" />
      {bars.map((b, i) => {
        const cx = padX + slot * (i + 0.5);
        const y = Y(Math.max(0, b.r));
        const h = Math.abs(Y(b.r) - zeroY);
        const col = b.r >= 0 ? "var(--gain)" : "var(--loss)";
        // plein = plan 5/5, semi = dégradé, contour = pas relu
        const fillOpacity = b.clean === true ? 1 : b.clean === false ? 0.33 : 0.08;
        return (
          <rect key={i} x={cx - bw / 2} y={y} width={bw} height={Math.max(h, 1)} fill={col} fillOpacity={fillOpacity} stroke={col} strokeWidth="1">
            <title>{`${b.label} · ${b.r > 0 ? "+" : ""}${b.r.toFixed(2)} R`}</title>
          </rect>
        );
      })}
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
