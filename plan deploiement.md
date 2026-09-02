# PLAN.md — Relevé-Journal : Plans, Essai & Bêta-test

> Document de référence pour les sessions Claude Code. À relire en début de
> chaque session, avant toute modification de code liée aux plans, à l'essai
> ou au statut bêta-testeur.
>
> **v2 — 21 août 2026.** Remplace la version du 20 août. Changements : la
> répartition Pro/Elite (section 5) passe d'« ouverte » à **verrouillée**,
> le CSV cTrader est **retiré du MVP** (section 5), le pricing est fixé,
> et une nouvelle section 9 documente les contraintes d'hébergement bêta.

---

## 1. Plans commerciaux

- **Trial** — essai gratuit, pas un plan payant, statut temporaire.
- **Starter — 29 $/mois** — plan payant d'entrée, disponible dès le lancement.
- **Pro — 39 $/mois** — Starter + sync automatique du compte MT5.
- **Elite — 59 $/mois** — Pro + synchro multi-comptes courtiers en fonds propres.
- **Bêta-testeur** — statut transverse, indépendant des plans ci-dessus
  (voir section 4).

---

## 2. Schéma de données (Supabase)

| Table / colonne         | Type      | Rôle                                                        |
|--------------------------|-----------|--------------------------------------------------------------|
| `users.plan`              | enum      | `trial` \| `starter` \| `pro` \| `elite`                     |
| `users.trial_ends_at`     | timestamp | Posé à l'activation du compte (après vérification e-mail)   |
| `beta_testers`            | table     | `user_id`, `granted_at`, `active` (boolean), `perks` (texte libre / jsonb) |

Le statut bêta-testeur est géré via une **table séparée**, pas via une valeur
supplémentaire dans l'enum `plan`. Le gating (section 6) doit traiter
`beta_testers.active = true` comme un accès garanti, indépendamment de
`users.plan`.

**À concevoir plus tard, pas maintenant** : quand le développement de Cloud
Sync démarrera (voir section 5), il faudra une table de type
`metaapi_connected_accounts` (ou équivalent) pour compter les comptes
connectés par utilisateur et déclencher le supplément au-delà du plafond
inclus. Ne pas designer ce schéma en avance — le faire dans la session
dédiée à cette phase, avec le contexte complet à ce moment-là.

---

## 3. Essai gratuit (trial)

- **Durée : 30 jours**, à partir de l'activation du compte (vérification
  e-mail réussie via Render).
- **À l'expiration : blocage complet.** L'utilisateur ne peut plus accéder à
  l'app tant qu'il n'a pas souscrit à un plan payant (Starter, Pro ou Elite).
- `trial_ends_at` est posé une seule fois, au moment de l'activation —
  aucune prolongation automatique prévue à ce stade.

---

## 4. Statut bêta-testeur

- Géré via la table séparée `beta_testers`, **jamais** comme une valeur de
  l'enum `plan`.
- Colonnes minimales : `user_id`, `granted_at`, `active`, `perks`.
- `perks` reste en texte libre / jsonb : les avantages sont définis **au cas
  par cas**, testeur par testeur (pas de règle uniforme figée pour l'instant).
- Accès garanti minimum : équivalent Starter, indépendamment du plan ou de
  l'état de l'essai de l'utilisateur.
- **Ne jamais supprimer** les lignes de cette table à la fin de la bêta —
  passer `active` à `false` si l'accès doit être retiré. Les données sont
  conservées pour témoignages, cas d'usage et conversions futures.
- **Source de la cohorte** : recrutement prévu via la communauté
  Telegram/Discord d'un influenceur trading, cohorte volontairement limitée
  à 8-10 personnes (voir section 9 pour la raison technique).

---

## 5. Fonctionnalités par plan — VERROUILLÉ

| Fonctionnalité                              | Trial | Starter | Pro          | Elite        | Bêta-testeur |
|-----------------------------------------------|:-----:|:-------:|:------------:|:------------:|:------------:|
| Import CSV (MT5 uniquement)                    | ✓     | ✓       | ✓            | ✓            | ✓            |
| Matrice décision × résultat                    | ✓     | ✓       | ✓            | ✓            | ✓            |
| Tracking compliance prop firm                  | ✓     | ✓       | ✓            | ✓            | ✓            |
| Review IA post-clôture                         | ✓     | ✓       | ✓            | ✓            | ✓            |
| Sync auto MT5 (EA ou Cloud Sync)               | —     | —       | ✓            | ✓            | —            |
| — Cloud Sync MetaApi, comptes inclus           | —     | —       | 2            | 2            | —            |
| — Cloud Sync MetaApi, compte supplémentaire    | —     | —       | +10 $/mois*  | +10 $/mois*  | —            |
| Sync cTrader (API officielle)                  | —     | —       | *post-MVP*   | *post-MVP*   | —            |
| Courtiers Propres (IB/OANDA/Tradovate/IG)      | —     | —       | —            | jusqu'à 5    | —            |

\* Montant proposé, pas encore éprouvé sur données réelles — voir section 8.

### 5.1 CSV cTrader : retiré, pas juste différé

Le code existant contient déjà un import CSV cTrader fonctionnel. **Action
requise : le masquer/désactiver dans l'UI pour le MVP**, ce n'est pas
seulement "non prioritaire" — c'est un retrait de scope assumé. Raison :
les exports CSV cTrader sont moins détaillés que ceux de MT5, ce qui
dégraderait la matrice décision × résultat pour ces utilisateurs. Un
prospect qui utilise cTrader ne doit pas pouvoir s'inscrire en pensant que
l'import CSV va fonctionner pour lui.

Remplacement prévu : **API officielle cTrader** (confirmée gratuite,
accès par cTID, expose les données au niveau du deal — plus détaillé que le
CSV). Rate limits à anticiper à l'implémentation : 5 req/s sur les endpoints
d'historique, fenêtre d'1 semaine max par requête sur les données tick.
Tâche de développement distincte, ouverte uniquement après le lancement MVP.

### 5.2 Sync auto MT5 (Pro/Elite) : deux implémentations, un seul prix

Sélection automatique côté serveur selon la plateforme détectée par
l'utilisateur — il ne choisit pas entre deux mécanismes, juste "sync
automatique activée".

- **EA propriétaire** (Windows/VPS) : webhook POST vers le serveur à la
  clôture de chaque position. Coût marginal ≈ 0 $, illimité en nombre de
  comptes.
- **Cloud Sync** (MetaApi, infra **G2** — moins chère et plus fiable que G1 ;
  G1 n'a d'intérêt que pour les EA custom sur MT4, non pertinent ici) : pour
  Mac / sans VPS. Coût réel ≈ 6,70 $/compte/mois en connexion continue
  pendant les heures de marché, undeploy le weekend (marché fermé ~48h/semaine).
  ⚠️ **Chaque appel "deploy" est facturé pour un minimum de 6h chez MetaApi** —
  éviter les cycles start/stop fréquents dans l'implémentation ; un
  déploiement qui reste actif sur toute une session de marché est plus
  rentable que des réveils ponctuels répétés. L'abonnement de base MetaApi
  (30 $/mois, coût plateforme fixe, indépendant du nombre de clients) est à
  budgéter séparément du coût par compte.

**Cloud Sync et l'API cTrader restent hors-scope de développement immédiat.**
La logique ci-dessus est figée et prête à implémenter, mais le déclenchement
effectif du build reste conditionné aux retours de la bêta confirmant la
demande — inchangé par rapport à la version précédente de ce document.

---

## 6. Couche de gating

- Fonction unique : `has_access(user, feature)`, appelée partout dans l'app.
- Une seule config centrale mappe chaque fonctionnalité aux plans autorisés
  (reprend le tableau de la section 5).
- Doit intégrer le cas bêta-testeur : si `beta_testers.active = true` pour
  l'utilisateur, l'accès Starter est garanti même si `users.plan = trial`
  et que l'essai est expiré.
- Doit intégrer le blocage total à l'expiration du trial (section 3) :
  `has_access()` renvoie faux sur toutes les fonctionnalités si
  `plan = trial` et `trial_ends_at` est dépassé et l'utilisateur n'est pas
  bêta-testeur actif.
- Quand Cloud Sync sera développé : `has_access()` devra aussi vérifier le
  nombre de comptes MetaApi déjà connectés par l'utilisateur contre son
  plafond inclus (2), pour déclencher le supplément.

---

## 7. Ordre d'exécution (phases)

- [ ] **Phase 0 — Cadrage** : ce fichier (`PLAN.md`) + `CLAUDE.md`
- [ ] **Phase 1 — Supabase** : colonnes `users`, table `beta_testers`, tests manuels
- [ ] **Phase 2 — Gating centralisé** : `has_access()`, config, remplacement des vérifications existantes
- [ ] **Phase 3 — Logique d'essai** : calcul du statut, blocage à expiration, bannière UI
- [ ] **Phase 4 — Interfaces plans/upgrade** : page abonnement (Starter/Pro/Elite avec prix), prompts upgrade, badge bêta
- [ ] **Phase 5 — E-mail de vérification (Render)** : service, flow d'inscription, activation
- [ ] **Phase 5bis — Retrait du CSV cTrader de l'UI** : masquer l'option existante, message "bientôt disponible" si pertinent
- [ ] **Phase 6 — Déploiement Streamlit Cloud** : secrets, test du parcours complet, prévoir message de chargement pour le cold start (voir section 9)
- [ ] **Phase 7 — Landing page + Vercel** *(peut être menée en parallèle des phases 5-6)*
- [ ] **Phase 8 — Connexion finale et QA** : test bout en bout, onboarding premiers bêta-testeurs (cohorte influenceur, 8-10 personnes)
- [ ] **Phase 9 — Paddle** *(hors scope immédiat, repris après lancement bêta)* : payout vers Payoneer puis banque gabonaise (retrait multi-devises, prévoir ~2% de frais). Formation LLC US + bascule Stripe explicitement repoussée à après 2-3 mois de rétention payante prouvée — pas un chantier de lancement.
- [ ] **Phase 10 — Cloud Sync MetaApi** *(hors scope immédiat)* : implémentation selon la logique figée en section 5.2, déclenchée par la demande bêta confirmée.
- [ ] **Phase 11 — API cTrader** *(hors scope immédiat)* : implémentation post-MVP, remplace définitivement l'ancien import CSV cTrader.

---

## 8. Points encore ouverts

- Avantages précis (`perks`) par bêta-testeur — à définir individuellement.
- Détails UI du blocage à expiration du trial (message affiché, écran de
  redirection, etc.) — logique fonctionnelle actée, détails visuels non
  spécifiés.
- Montant exact du supplément Cloud Sync au-delà de 2 comptes (10 $/mois
  proposé) — à confirmer une fois quelques semaines de données bêta réelles
  disponibles.
- Date de démarrage du développement Cloud Sync / API cTrader — conditionnée
  aux retours bêta, pas fixée à l'avance.

---

## 9. Contraintes d'hébergement MVP (nouveau en v2)

- Streamlit Community Cloud (gratuit) : ~1 Go de RAM, mise en veille après
  12h sans trafic, une seule app privée autorisée, pas de domaine personnalisé.
- La cohorte bêta est volontairement limitée à 8-10 personnes précisément
  pour rester confortablement dans cette enveloppe.
- Risque connu à anticiper en UI : pic de connexions groupé si l'app était
  en veille au moment où l'influenceur annonce la bêta (cold start ~30-60s).
  Prévoir un message de chargement explicite plutôt qu'un écran vide ou une
  erreur apparente.

---

## 10. Règles de travail avec Claude Code

- Relire ce fichier et `CLAUDE.md` en début de chaque session.
- Une session = une phase de la section 7. Ne pas mélanger plusieurs phases
  dans un même prompt.
- Tester manuellement le résultat d'une phase avant de passer à la
  suivante — particulièrement critique pour les phases 1 à 3.
- Commit Git après chaque phase validée.
- Les phases 9, 10 et 11 sont explicitement hors-scope tant que la bêta n'a
  pas produit de signal de rétention — ne pas les anticiper sans validation
  préalable de Paul.
