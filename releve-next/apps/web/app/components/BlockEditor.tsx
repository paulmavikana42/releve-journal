"use client";

import { useEffect, useRef, useState } from "react";
import { type Block, type ImageBlock, newBid, serializeBlocks } from "@/lib/blocks";
import { uploadBlockImage } from "../journal/actions";

// Éditeur d'écriture par blocs (idée + thèse). Glisser-déposer pour réordonner
// (souris ET tactile, sans flèches), zones de texte auto-extensibles, images
// redimensionnées par poignée avec badge %. Le contenu est sérialisé dans un
// input caché soumis avec le formulaire ; le serveur en tire le reflet à plat.

function AutoTextarea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  };
  useEffect(resize, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      onInput={resize}
      className="blk-text"
    />
  );
}

export default function BlockEditor({
  name = "blocks",
  initial,
  initialUrls = {},
}: {
  name?: string;
  initial: Block[];
  initialUrls?: Record<string, string>;
}) {
  const [blocks, setBlocks] = useState<Block[]>(initial.length ? initial : [{ type: "text", text: "", bid: newBid() }]);
  const [urls, setUrls] = useState<Record<string, string>>(initialUrls);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (bid: string, patch: Partial<Block>) =>
    setBlocks((bs) => bs.map((b) => (b.bid === bid ? ({ ...b, ...patch } as Block) : b)));
  const remove = (bid: string) => setBlocks((bs) => bs.filter((b) => b.bid !== bid));
  const addText = () => setBlocks((bs) => [...bs, { type: "text", text: "", bid: newBid() }]);

  // --- glisser-déposer (pointer events → marche à la souris et au doigt) -----
  const dragRef = useRef<string | null>(null);
  const onHandleDown = (bid: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = bid;
    setDragging(bid);
    const move = (ev: PointerEvent) => {
      if (!dragRef.current || !listRef.current) return;
      const rows = [...listRef.current.querySelectorAll<HTMLElement>("[data-bid]")];
      const y = ev.clientY;
      let targetBid: string | null = null;
      for (const r of rows) {
        const rect = r.getBoundingClientRect();
        if (y < rect.top + rect.height / 2) {
          targetBid = r.dataset.bid ?? null;
          break;
        }
      }
      setBlocks((bs) => {
        const from = bs.findIndex((b) => b.bid === dragRef.current);
        if (from < 0) return bs;
        const arr = [...bs];
        const [m] = arr.splice(from, 1);
        let to = targetBid ? arr.findIndex((b) => b.bid === targetBid) : arr.length;
        if (to < 0) to = arr.length;
        arr.splice(to, 0, m!);
        return arr;
      });
    };
    const up = () => {
      dragRef.current = null;
      setDragging(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // --- redimensionnement d'image par poignée (largeur % du conteneur) --------
  const onResizeDown = (bid: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    const wrap = (e.currentTarget as HTMLElement).closest(".blk-img-wrap") as HTMLElement | null;
    if (!wrap) return;
    const contW = wrap.getBoundingClientRect().width || 1;
    const startX = e.clientX;
    const startW = (blocks.find((b) => b.bid === bid) as ImageBlock | undefined)?.width ?? 100;
    const move = (ev: PointerEvent) => {
      const w = Math.max(20, Math.min(100, Math.round(startW + ((ev.clientX - startX) / contW) * 100)));
      update(bid, { width: w });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // --- ajout d'image (upload → chemin + URL d'aperçu) ------------------------
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { path, url } = await uploadBlockImage(fd);
      setUrls((u) => ({ ...u, [path]: url }));
      setBlocks((bs) => [...bs, { type: "image", path, caption: "", width: 100, bid: newBid() }]);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  return (
    <div className="blk-editor">
      <div ref={listRef} className="blk-list">
        {blocks.map((b) => (
          <div key={b.bid} data-bid={b.bid} className={"blk-row" + (dragging === b.bid ? " dragging" : "")}>
            <button
              type="button"
              className="blk-handle"
              onPointerDown={onHandleDown(b.bid)}
              title="Glisser pour déplacer"
              aria-label="Déplacer le bloc"
            >
              ⠿
            </button>
            <div className="blk-body">
              {b.type === "text" ? (
                <AutoTextarea value={b.text} onChange={(v) => update(b.bid, { text: v })} placeholder="Écris ici… (thèse, invalidation, contexte)" />
              ) : (
                <div className="blk-img-wrap">
                  <div className="blk-img" style={{ width: `${b.width}%` }}>
                    {urls[b.path] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={urls[b.path]} alt={b.caption || "capture"} />
                    ) : (
                      <div className="blk-img-ph">image indisponible</div>
                    )}
                    <span className="blk-resize" onPointerDown={onResizeDown(b.bid)} title="Redimensionner" aria-label="Redimensionner l'image" />
                    <span className="blk-pct">{b.width}%</span>
                  </div>
                  <input
                    className="blk-cap"
                    value={b.caption}
                    placeholder="Légende (facultatif)"
                    onChange={(e) => update(b.bid, { caption: e.target.value })}
                  />
                </div>
              )}
            </div>
            <button type="button" className="blk-x" onClick={() => remove(b.bid)} title="Retirer le bloc" aria-label="Retirer le bloc">
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="blk-add">
        <button type="button" className="ghost" onClick={addText}>+ Texte</button>
        <button type="button" className="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Envoi…" : "+ Image"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      </div>

      <input type="hidden" name={name} value={JSON.stringify(serializeBlocks(blocks))} />
    </div>
  );
}
