// Rafraîchit la session à chaque requête, sert le site public (marketing/légal)
// en statique depuis public/site, et protège les routes privées de l'app.
// @supabase/ssr a besoin du middleware pour réécrire les cookies d'auth.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };
import { supabaseEnv } from "./env";

// Routes publiques du site → fichier statique dans public/site/.
// (Le footer des pages pointe déjà vers /legal, /terms, /privacy, /refund-policy,
//  /support ; la nav et les CTA sont recâblés côté client par public/site/*.)
const SITE: Record<string, string> = {
  "/": "landing",
  "/login": "login",
  "/methode": "methode",
  "/fonctionnalites": "fonctionnalites",
  "/tarifs": "tarifs",
  "/a-propos": "a-propos",
  "/legal": "legal",
  "/terms": "terms",
  "/privacy": "privacy",
  "/refund-policy": "refund",
  "/support": "a-propos",
};

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { url, key } = supabaseEnv();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Aperçu local dev : auth désactivée (jamais en prod).
  const devPreview =
    process.env.NODE_ENV !== "production" && process.env.RELEVE_DEV_PREVIEW === "1";

  const path = request.nextUrl.pathname;

  // Connecté : la landing et le login renvoient vers l'app.
  if (user && (path === "/" || path === "/login")) {
    const to = request.nextUrl.clone();
    to.pathname = "/dashboard";
    to.search = "";
    return NextResponse.redirect(to);
  }

  // Site public : on sert le bundle statique correspondant (URL propre conservée).
  if (Object.prototype.hasOwnProperty.call(SITE, path)) {
    const to = request.nextUrl.clone();
    to.pathname = `/site/${SITE[path]}.html`;
    to.search = "";
    return NextResponse.rewrite(to);
  }

  // Fichiers statiques du site + flux OAuth : accès libre.
  if (path.startsWith("/site/") || path.startsWith("/auth")) {
    return response;
  }

  // Routes privées : sans session, on renvoie vers le login.
  if (!user && !devPreview) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    return NextResponse.redirect(to);
  }

  return response;
}
