"use client";

import { useState } from "react";

/**
 * Le type de compte : prop firm (challenge, avec règles contractuelles) ou compte
 * propre (ton capital, aucune règle de conformité). Un compte propre masque tout
 * le paramétrage prop firm — il servira plus tard, quand la section Conformité
 * sera ouverte. L'état est envoyé au serveur via un champ caché `is_prop`.
 */
export default function PropFieldset({
  defaultOn,
  children,
}: {
  defaultOn: boolean;
  children: React.ReactNode;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <>
      <input type="hidden" name="is_prop" value={on ? "on" : ""} />
      <div>
        <label>Type de compte</label>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className={`pill ${on ? "on" : ""}`} onClick={() => setOn(true)}>
            Compte prop firm
          </button>
          <button type="button" className={`pill ${!on ? "on" : ""}`} onClick={() => setOn(false)}>
            Compte propre
          </button>
        </div>
        <div className="note" style={{ marginTop: 6 }}>
          {on ? (
            <>Compte de <b>challenge</b> : renseigne les règles de ta firme ci-dessous — c&apos;est ce qui rend ta marge de survie et ton drawdown justes.</>
          ) : (
            <><b>Ton propre capital</b>, sans challenge. Les règles de conformité (drawdown, objectif, jours minimum…) ne s&apos;appliquent pas. Tu pourras les activer plus tard en repassant ce compte en « prop firm ».</>
          )}
        </div>
      </div>
      {on && <div style={{ display: "grid", gap: 14 }}>{children}</div>}
    </>
  );
}
