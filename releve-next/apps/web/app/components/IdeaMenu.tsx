"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { abandonIdea } from "../journal/actions";

// Les 3 points d'une idée : Ouvrir / relire · Modifier · Abandonner — fidèle au
// popover de Streamlit (_menu_idee). Une idée clôturée ET revue ne se modifie
// plus (cadenas) ; l'abandon ne concerne qu'une idée jamais exécutée et passe
// par une confirmation. Popover natif, fermé au clic extérieur / Échap.
export default function IdeaMenu({
  id,
  canModify,
  isArmed,
}: {
  id: string;
  canModify: boolean;
  isArmed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="pop" ref={ref}>
      <button className={"pop-btn" + (open ? " on" : "")} onClick={() => setOpen((o) => !o)} aria-label="Actions" aria-haspopup="menu" aria-expanded={open}>
        ⋮
      </button>
      {open && (
        <div className="pop-menu" role="menu">
          <div className="eyebrow" style={{ margin: "2px 4px 4px" }}>cette idée</div>
          <Link href={`/journal/${id}`} className="pop-item" role="menuitem">
            Ouvrir / relire
          </Link>
          {canModify ? (
            <Link href={`/journal/${id}/edit`} className="pop-item" role="menuitem">
              Modifier
            </Link>
          ) : (
            <div className="pop-lock">🔒 Clôturée et revue — elle ne se modifie plus. Son verdict est acquis.</div>
          )}
          <hr className="rule" style={{ margin: "6px 0" }} />
          {isArmed ? (
            <button type="button" className="pop-item danger-item" role="menuitem" onClick={() => setConfirm(true)}>
              Abandonner l&apos;idée
            </button>
          ) : (
            <div className="pop-lock">🔒 L&apos;abandon ne concerne qu&apos;une idée jamais exécutée.</div>
          )}
        </div>
      )}

      {confirm && (
        <div className="modal-scrim" onClick={() => setConfirm(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-title">Abandonner cette idée ?</div>
            <div className="note" style={{ marginTop: 8 }}>
              Elle sort des candidates à l&apos;appariement et des statistiques. Elle <b>reste</b> dans le journal.
            </div>
            <form action={abandonIdea} className="modal-actions">
              <input type="hidden" name="ideaId" value={id} />
              <button type="button" className="ghost" onClick={() => setConfirm(false)}>Non</button>
              <button type="submit" className="danger">Oui, abandonner</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
