"use client";

import { useState } from "react";

// Bouton qui ouvre une pop-up de confirmation propre (oui/non) avant de soumettre
// une action serveur. Réutilisé pour l'abandon d'une idée/thèse et pour chaque
// « Détacher ». Le « Oui » soumet un <form> qui porte l'action + les champs cachés.
export default function ConfirmSubmit({
  action,
  hidden = {},
  children,
  className = "ghost",
  title = "Confirmer",
  message,
  confirmLabel = "Oui",
  cancelLabel = "Non",
  danger = true,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hidden?: Record<string, string>;
  children: React.ReactNode;
  className?: string;
  title?: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && (
        <div className="modal-scrim" onClick={() => setOpen(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-title">{title}</div>
            {message && <div className="note" style={{ marginTop: 8 }}>{message}</div>}
            <form action={action} className="modal-actions">
              {Object.entries(hidden).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <button type="button" className="ghost" onClick={() => setOpen(false)}>
                {cancelLabel}
              </button>
              <button type="submit" className={danger ? "danger" : "primary"}>
                {confirmLabel}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
