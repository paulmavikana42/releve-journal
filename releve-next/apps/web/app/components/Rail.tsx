"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/dashboard", label: "Tableau de bord" },
  { href: "/journal", label: "Journal" },
  { href: "/campaigns", label: "Thèses" },
  { href: "/import", label: "Import" },
  // Conformité : verrouillée jusqu'au branchement live MT5 (voir docs/compliance.md).
  { href: "/compliance", label: "Conformité", locked: true },
  { href: "/settings", label: "Réglages" },
] as { href: string; label: string; locked?: boolean }[];

export default function Rail() {
  const p = usePathname() ?? "";
  const isOn = (href: string) => (href === "/dashboard" ? p === "/dashboard" : p.startsWith(href));
  const [open, setOpen] = useState(false);

  // On referme le tiroir quand on change de page.
  useEffect(() => setOpen(false), [p]);
  // Empêche le défilement du fond quand le tiroir plein écran est ouvert (mobile).
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {/* Barre mobile : le logo R sert de hamburger. Masquée en desktop. */}
      <div className="railtop">
        <button className="hb" onClick={() => setOpen((o) => !o)} aria-label={open ? "Fermer le menu" : "Ouvrir le menu"} aria-expanded={open}>
          <span className="logo">R</span>
        </button>
      </div>

      {/* Rail : barre latérale fixe en desktop, tiroir plein écran en mobile. */}
      <aside className={"rail" + (open ? " open" : "")}>
        <div className="brand">
          {/* Sortie 1 : recliquer sur le R. */}
          <button className="brandlogo" onClick={() => setOpen(false)} aria-label="Fermer le menu">
            <span className="logo">R</span>
          </button>
          <div className="name">
            Relev<span style={{ color: "var(--accent)" }}>é</span>
          </div>
          {/* Sortie 2 : le X en face de « R Relevé » (mobile uniquement). */}
          <button className="railclose" onClick={() => setOpen(false)} aria-label="Fermer le menu">
            ✕
          </button>
        </div>
        <nav>
          {NAV.map((n) =>
            n.locked ? (
              <span key={n.href} className="nav-locked" title="Bientôt disponible — activé en prod avec le flux MT5 en direct" aria-disabled="true">
                {n.label}
                <span className="nav-lock" aria-hidden="true">🔒</span>
                <span className="help" data-tip="Bientôt disponible. Cette section s'activera quand ton compte sera en prod réelle, rattaché en direct aux terminaux MT5.">?</span>
              </span>
            ) : (
              <Link key={n.href} href={n.href} className={isOn(n.href) ? "on" : ""} onClick={() => setOpen(false)}>
                {n.label}
              </Link>
            ),
          )}
        </nav>
        <div className="spacer" />
        <div className="foot">
          <form action="/auth/signout" method="post">
            <button type="submit" className="ghost" style={{ width: "100%" }}>Se déconnecter</button>
          </form>
        </div>
      </aside>
    </>
  );
}
