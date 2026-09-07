"use client";

import { useEffect } from "react";

/**
 * Quand on arrive sur le détail avec #declarer-ticket (depuis l'invitation
 * « idée incomplète » du journal), on amène l'utilisateur droit au champ ticket
 * et on le met au focus — le geste attendu, sans chercher.
 */
export default function TicketFocus() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#declarer-ticket") return;
    const el = document.getElementById("ticket-input") as HTMLInputElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
    }
  }, []);
  return null;
}
