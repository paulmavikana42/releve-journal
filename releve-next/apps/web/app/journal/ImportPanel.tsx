"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Result = {
  kind: string;
  parsed_positions: number;
  parsed_deals: number;
  imported_positions: number;
  orphans: number;
};

export default function ImportPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import refusé.");
      } else {
        setResult(data as Result);
        router.refresh(); // recharge la liste (nouvelles positions)
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="between">
        <div>
          <strong>Importer un rapport</strong>
          <div className="muted" style={{ fontSize: ".85rem" }}>
            Rapport HTML MT5 ou export CSV (MT4/MT5/cTrader). Rapproché par ticket, idempotent.
          </div>
        </div>
        <div className="row">
          <input
            ref={inputRef}
            type="file"
            accept=".html,.htm,.csv,.txt"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          {busy && <span className="muted">Import…</span>}
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 10, color: "var(--loss)", fontSize: ".9rem" }}>{error}</div>
      )}
      {result && (
        <div style={{ marginTop: 10, fontSize: ".9rem" }}>
          <span className="chip" style={{ marginRight: 8 }}>{result.kind}</span>
          {result.parsed_positions} position(s) lue(s) ·{" "}
          <strong>{result.imported_positions} nouvelle(s)</strong> ·{" "}
          {result.parsed_deals} transaction(s) · {result.orphans} à rapparier
          {result.imported_positions === 0 && result.parsed_positions > 0 && (
            <span className="muted"> — déjà importé (rien ajouté)</span>
          )}
        </div>
      )}
    </div>
  );
}
