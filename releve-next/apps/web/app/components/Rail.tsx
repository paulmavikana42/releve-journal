"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Tableau de bord" },
  { href: "/journal", label: "Journal" },
  { href: "/campaigns", label: "Thèses" },
  { href: "/compliance", label: "Conformité" },
  { href: "/settings", label: "Réglages" },
];

export default function Rail() {
  const p = usePathname() ?? "";
  const isOn = (href: string) => (href === "/dashboard" ? p === "/dashboard" : p.startsWith(href));

  return (
    <aside className="rail">
      <div className="brand">
        <div className="logo">R</div>
        <div className="name">
          Relev<span style={{ color: "var(--accent)" }}>é</span>
        </div>
      </div>
      <nav>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={isOn(n.href) ? "on" : ""}>
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="spacer" />
      <div className="foot">
        <form action="/auth/signout" method="post">
          <button type="submit" className="ghost" style={{ width: "100%" }}>Se déconnecter</button>
        </form>
      </div>
    </aside>
  );
}
