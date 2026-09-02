"use client";

import { useFormStatus } from "react-dom";

// Bouton de soumission qui se désactive pendant l'action serveur du <form>
// parent — garde-fou anti double-envoi, réutilisable partout.
export default function SubmitButton({
  children,
  className = "primary",
  pendingLabel = "…",
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
