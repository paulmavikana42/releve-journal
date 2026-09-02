"use client";

import { useRef, useState } from "react";
import { addIdea } from "./actions";

export default function AddIdeaForm({ symbols }: { symbols: string[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        // Garde-fou anti double-envoi : le journal est append-only, un double
        // clic créerait deux idées identiques.
        if (pending) return;
        setPending(true);
        try {
          await addIdea(fd);
          formRef.current?.reset();
        } finally {
          setPending(false);
        }
      }}
      className="card"
      style={{ marginBottom: 20 }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr .8fr 1fr 1fr", gap: 12 }}>
        <div>
          <label>Instrument</label>
          <select name="instrument" required defaultValue="" style={{ width: "100%" }}>
            <option value="" disabled>
              Choisir…
            </option>
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Sens</label>
          <select name="direction" defaultValue="buy" style={{ width: "100%" }}>
            <option value="buy">Achat</option>
            <option value="sell">Vente</option>
          </select>
        </div>
        <div>
          <label>Entrée visée</label>
          <input name="entry" inputMode="decimal" placeholder="20100" style={{ width: "100%" }} />
        </div>
        <div>
          <label>Stop</label>
          <input name="stop" inputMode="decimal" placeholder="20250" style={{ width: "100%" }} />
        </div>
      </div>
      <div className="between" style={{ marginTop: 12 }}>
        <input name="label" placeholder="Libellé (ex. Short NDX100 — CPI)" style={{ flex: 1 }} />
        <button type="submit" className="primary" style={{ marginLeft: 12 }} disabled={pending}>
          {pending ? "Écriture…" : "Écrire l'idée"}
        </button>
      </div>
    </form>
  );
}
