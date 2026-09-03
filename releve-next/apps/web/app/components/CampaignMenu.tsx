"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { abandonCampaign } from "../campaigns/actions";

// Les 3 points d'une thèse macro : Relire · Modifier · Abandonner — fidèle au
// popover de Streamlit (_menu_these). Une thèse clôturée ne se modifie plus ;
// l'abandon passe par une confirmation. Fermé au clic extérieur / Échap.
export default function CampaignMenu({ id, canModify }: { id: string; canModify: boolean }) {
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
          <div className="eyebrow" style={{ margin: "2px 4px 4px" }}>cette thèse</div>
          <Link href={`/campaigns/${id}`} className="pop-item" role="menuitem">Relire la thèse</Link>
          {canModify ? (
            <Link href={`/campaigns/${id}/edit`} className="pop-item" role="menuitem">Modifier</Link>
          ) : (
            <div className="pop-lock">🔒 Thèse clôturée — elle ne se modifie plus.</div>
          )}
          <hr className="rule" style={{ margin: "6px 0" }} />
          <button type="button" className="pop-item danger-item" role="menuitem" onClick={() => setConfirm(true)}>
            Abandonner la thèse
          </button>
        </div>
      )}

      {confirm && (
        <div className="modal-scrim" onClick={() => setConfirm(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-title">Abandonner cette thèse ?</div>
            <div className="note" style={{ marginTop: 8 }}>
              Elle sort des vues et des statistiques. Ses idées <b>redeviennent autonomes</b>. Rien n&apos;est effacé.
            </div>
            <form action={abandonCampaign} className="modal-actions">
              <input type="hidden" name="campaignId" value={id} />
              <button type="button" className="ghost" onClick={() => setConfirm(false)}>Non</button>
              <button type="submit" className="danger">Oui, abandonner</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
