"use client";

import { useState } from "react";

// Règle prop firm OPTIONNELLE : un interrupteur (oui/non) qui déploie sa zone de
// paramétrage (% / valeurs) seulement s'il est actif. Non coché = la règle ne
// s'applique pas et n'est pas envoyée. Intégré au design (carte discrète).
export default function PropRuleToggle({
  name,
  label,
  hint,
  defaultOn,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultOn: boolean;
  children: React.ReactNode;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="rule-toggle">
      <label className="row" style={{ gap: 10 }}>
        <input type="checkbox" name={name} checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span style={{ fontWeight: 600 }}>{label}</span>
      </label>
      {hint && <div className="note" style={{ marginTop: 4 }}>{hint}</div>}
      {on && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}
