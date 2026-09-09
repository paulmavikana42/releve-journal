"use client";

import { usePathname } from "next/navigation";
import Rail from "./Rail";

/**
 * Coquille de l'app : rail de navigation à gauche + contenu. Masquée sur les
 * pages sans session (login, callback OAuth, racine qui redirige).
 */
export default function Shell({ children }: { children: React.ReactNode }) {
  const p = usePathname() ?? "";
  const bare =
    p === "/" || p === "/login" || p === "/complet" || p === "/waitlist-ok" || p.startsWith("/auth");
  if (bare) return <>{children}</>;
  return (
    <div className="shell">
      <Rail />
      <div className="main">{children}</div>
    </div>
  );
}
