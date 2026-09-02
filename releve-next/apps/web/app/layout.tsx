import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Shell from "./components/Shell";

export const metadata: Metadata = {
  title: "Relevé",
  description: "Un journal de trading qui peut te contredire.",
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
