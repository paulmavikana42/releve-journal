// Rafraîchit la session à chaque requête, sert le site public (marketing/légal)
// en statique depuis public/site, et protège les routes privées de l'app.
// @supabase/ssr a besoin du middleware pour réécrire les cookies d'auth.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };
import { supabaseEnv } from "./env";
import { betaStatus, isMember } from "@/lib/beta";

// Routes privées de l'app (nécessitent un accès bêta accordé).
const APP_PREFIXES = ["/dashboard", "/journal", "/settings", "/import", "/campaigns"];

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
  // Légales : le footer du design pointe vers /legal,/terms,/privacy,/refund-policy ;
  // on garde ces routes + les alias français, tous servis par les nouveaux fichiers.
  "/legal": "mentions-legales",
  "/mentions-legales": "mentions-legales",
  "/terms": "cgu-cgv",
  "/cgu-cgv": "cgu-cgv",
  "/privacy": "confidentialite",
  "/confidentialite": "confidentialite",
  "/refund-policy": "remboursement",
  "/remboursement": "remboursement",
  "/support": "a-propos",
};

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Aperçu local dev : auth désactivée (jamais en prod).
  const devPreview =
    process.env.NODE_ENV !== "production" && process.env.RELEVE_DEV_PREVIEW === "1";

  // ─── FAST PATH sans Supabase ────────────────────────────────────────────────
  // getUser() est un ALLER-RETOUR RÉSEAU vers Supabase, joué sur CHAQUE requête.
  // Sur une page marketing statique il ajoutait ~1 s de TTFB pour rien. On sert
  // donc ces pages immédiatement, sans toucher à Supabase.
  //
  // Fichiers du site + OAuth + robots/sitemap : jamais d'auth.
  if (
    path.startsWith("/site/") ||
    path.startsWith("/auth") ||
    path === "/robots.txt" ||
    path === "/sitemap.xml"
  ) {
    return NextResponse.next({ request });
  }
  // Pages marketing/légales : servies en statique sans Supabase.
  //   • pages pures (méthode, tarifs, …) : toujours.
  //   • "/" et "/login" : seulement si le visiteur est ANONYME (aucun cookie
  //     d'auth Supabase) — un membre connecté doit y être redirigé vers l'app,
  //     donc là on garde le chemin complet ci-dessous.
  if (Object.prototype.hasOwnProperty.call(SITE, path)) {
    const needsAuthCheck =
      (path === "/" || path === "/login") &&
      (devPreview ||
        request.cookies
          .getAll()
          .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token")));
    if (!needsAuthCheck) {
      const to = request.nextUrl.clone();
      to.pathname = `/site/${SITE[path]}.html`;
      to.search = "";
      return NextResponse.rewrite(to);
    }
  }

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

  // getClaims() plutôt que getUser() : le projet signe ses JWT avec des clés
  // ASYMÉTRIQUES (ES256), donc getClaims vérifie le token EN LOCAL (WebCrypto +
  // JWKS mis en cache) sans aller-retour réseau, tout en rafraîchissant les
  // tokens expirés via les cookies (comme getUser). getUser ajoutait ~900 ms à
  // CHAQUE navigation de l'app. Compromis assumé : une déconnexion faite sur un
  // autre appareil n'est pas vue avant l'expiration du token (~1 h) — sans
  // conséquence pour un simple gating bêta, les données restant protégées par RLS.
  let user: unknown = null;
  try {
    const { data: claimsData } = await supabase.auth.getClaims();
    user = claimsData?.claims ?? null;
  } catch {
    // Filet : si getClaims échoue (surprise SDK), on retombe sur getUser —
    // comportement jamais pire qu'avant, jamais de blocage de connexion.
    const { data } = await supabase.auth.getUser();
    user = data.user ?? null;
  }

  const isApp = APP_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
  const isGate = path === "/complet" || path === "/waitlist-ok";
  const redirectTo = (pathname: string) => {
    const to = request.nextUrl.clone();
    to.pathname = pathname;
    to.search = "";
    return NextResponse.redirect(to);
  };

  // Aperçu dev : la landing/login mènent directement à l'app.
  if (devPreview && (path === "/" || path === "/login")) {
    return redirectTo("/dashboard");
  }

  // Connecté : un MEMBRE va à l'app. Un non-membre / en attente qui vise /login est
  // renvoyé vers sa page de gating, MAIS la landing "/" reste consultable (marketing)
  // — sinon « Retour à l'accueil » depuis /waitlist-ok boucle.
  if (user && (path === "/" || path === "/login")) {
    const status = await betaStatus(supabase);
    if (isMember(status)) return redirectTo("/dashboard");
    if (path === "/login") return redirectTo(status === "waitlisted" ? "/waitlist-ok" : "/complet");
    // path === "/" pour un non-membre : on laisse la réécriture SITE servir la landing.
  }

  // Site public : on sert le bundle statique correspondant (URL propre conservée).
  if (Object.prototype.hasOwnProperty.call(SITE, path)) {
    const to = request.nextUrl.clone();
    to.pathname = `/site/${SITE[path]}.html`;
    to.search = "";
    return NextResponse.rewrite(to);
  }

  // Fichiers statiques du site + flux OAuth + robots/sitemap : accès libre.
  if (
    path.startsWith("/site/") ||
    path.startsWith("/auth") ||
    path === "/robots.txt" ||
    path === "/sitemap.xml"
  ) {
    return response;
  }

  // Pages de gating (complet / liste d'attente) : session requise, pas d'accès bêta.
  if (isGate) {
    if (!user && !devPreview) return redirectTo("/login");
    return response;
  }

  // Route inconnue (ni site, ni app, ni gating) : on laisse Next rendre le 404
  // de marque (app/not-found.tsx) au lieu de renvoyer vers /login.
  if (!isApp) {
    return response;
  }

  // Routes privées de l'app : session requise…
  if (!user && !devPreview) return redirectTo("/login");
  // …ET accès bêta accordé (sinon page complet / liste d'attente).
  // On ne vérifie l'accès que sur une NAVIGATION (GET). Un POST (Server Action,
  // envoi de formulaire) part forcément d'une page d'app déjà chargée par un
  // membre : y refaire l'appel RPC ajoutait un aller-retour Supabase à CHAQUE
  // clic → latence de plusieurs secondes qui poussait au double-clic.
  if (user && !devPreview && isApp && request.method === "GET") {
    const status = await betaStatus(supabase);
    if (!isMember(status)) {
      return redirectTo(status === "waitlisted" ? "/waitlist-ok" : "/complet");
    }
  }

  return response;
}
