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
  const [fileName, setFileName] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setFileName(file.name);
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
      {/* Zone de dépôt : bouton + glisser-déposer. Le nom de fichier est tronqué
          (jamais de débordement horizontal, même sur mobile). */}
      <div
        className={`dropzone ${drag ? "drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !busy) void upload(f);
        }}
      >
        <input
          ref={inputRef}
          id="import-file"
          type="file"
          accept=".html,.htm,.csv,.txt"
          disabled={busy}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <div className="dropzone-icon" aria-hidden>⬆</div>
        <div className="dropzone-main">
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            Choisir un fichier
          </button>
          <span className="dropzone-hint">ou glisse-le ici · HTML MT5 ou CSV (MT4/MT5)</span>
        </div>
        {(fileName || busy) && (
          <div className="dropzone-file">
            {busy ? "Import en cours…" : <><span className="dz-name">{fileName}</span></>}
          </div>
        )}
      </div>

      {error && (
        <div style={{ marginTop: 10, color: "var(--loss)", fontSize: ".9rem", overflowWrap: "anywhere" }}>{error}</div>
      )}
      {result && (
        <div style={{ marginTop: 10, fontSize: ".9rem", overflowWrap: "anywhere" }}>
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
