import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Shell from "./components/Shell";

export const metadata: Metadata = {
  title: "Relevé",
  description: "Un journal de trading qui peut te contredire.",
};

// Zoom autorisé (jusqu'à ×5) mais IMPOSSIBLE de dézoomer sous 100 % : un user qui
// zoome retrouve toujours l'échelle par défaut en dézoomant (pas de perte d'équilibre).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
