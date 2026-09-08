# Relevé-Journal — Document fondateur (v3, définitive)

> **30 août 2026 — Version 3 (définitive).** Remplace `plan deploiement.md` (v2,
> 21 août 2026). Source complète : [`Releve-Journal_Document_fondateur_v3.pdf`](Releve-Journal_Document_fondateur_v3.pdf)
> (27 pages). Ce markdown en est la synthèse fidèle et diffable ; en cas de doute,
> le PDF fait foi.

## Ce qui a changé vs v2

- **Pro : 39 $ → 44 $** ; **Elite : 59 $ → 64 $**.
- **L'EA propriétaire est supprimé.** Tous les Pro/Elite passent par **Cloud Sync
  (MetaApi G2)**, quel que soit l'OS.
- **Supplément par compte Cloud Sync : 10 $ → 15 $.**
- Ajout d'un **plan de scaling provider** avec seuils de bascule **MetaApi →
  API2Trade** (§VII).
- Projections étendues à **10 000 clients** (comparatif 3 providers + expansion revenue).

---

## I. Pourquoi Relevé-Journal existe

- **Problème** : un trader a besoin d'écrire sa thèse *avant* d'entrer, d'enregistrer
  ce qui s'est réellement passé, puis de comparer les deux (« ma thèse était-elle juste,
  et l'ai-je exécutée correctement ? »). Les journaux manuels (tableurs, Notion) ne sont
  pas connectés au compte ; les plateformes auto (TradeZella, TraderSync, Tradervue,
  29-79 $/mois) importent l'historique mais ne capturent pas le **processus de décision**.
- **Solution** : coupler la **thèse macro** (style Notion, avec conviction pré-trade) à
  l'historique d'exécution, reliés par la **matrice décision × résultat** (cœur du produit) :
  bonne/mauvaise thèse × bonne/mauvaise exécution → 4 quadrants (modèle à reproduire /
  discipline / analyse / tout à revoir). Une **review IA** post-clôture classe le trade.
- **Audience primaire** : traders **prop firm** (FTMO, FundedNext, The Funded Trader,
  MyFundedFX) — habitués à payer, compliance intégrée. **Secondaire** : macro swing traders
  multi-comptes en fonds propres (IB, OANDA, Tradovate, IG) → plan Elite.
- **Positionnement prix** : cœur de marché 20-50 $/mois ; Starter à **29 $** (moitié haute,
  pas plafond). Pas 19 $ (éviter le signal « entrée de gamme »).

## II. Stack technique

**MVP (bêta, ~1 $/mois)** — objectif : valider la rétention avec 8-10 bêta-testeurs au coût
le plus bas.

| Composant | Service | Coût | Limite critique |
|---|---|---|---|
| Landing | Vercel (gratuit) | 0 $ | 100 Go BP/mois (définitif, pas de migration) |
| DB + Auth | Supabase Free + Google Auth | 0 $ | 500 Mo DB, 1 Go fichiers, **pause 7j** (contournée par cron GitHub Actions /48h) |
| Stockage images | Cloudflare R2 (gratuit) | 0 $ | 10 Go, 0 $ egress (permanent) |
| Application | Streamlit Community Cloud | 0 $ | ~1 Go RAM, veille 12h → message de cold-start requis |
| Domaine | releve-journal.com | ~12 $/an | — |

**Production (post-bêta, une fois la rétention prouvée — protocole 6 semaines)** :

| Composant | Service | Coût |
|---|---|---|
| Application | VPS Hostinger KVM1 (1 vCPU, 4 Go, 50 Go NVMe) | ~5-6,50 $/mois (24 mois) |
| DB primaire | Supabase Pro (backups quotidiens, 8 Go, SLA, pas de pause) | 25 $/mois |
| DB redondante | Cloudflare + sync via VPS (toutes les 5-15 min) | 0-5 $/mois |
| Paiements | **Paddle** (MoR) — 5 % + 0,50 $/txn, gère TVA/taxes | — |
| Payout | Payoneer → banque gabonaise (USD→XAF) | ~2 % |
| Sync MT5 | MetaApi G2 | 30 $/mois fixe + ~6,70 $/compte |
| E-mail | Render / Resend | 0-10 $/mois |

Coût prod : **~72-85 $/mois** (MetaApi inclus) ; **~42-55 $/mois** sans MetaApi (avant Pro).
LLC US + Stripe **repoussés** (~400-700 $/an + risque pénalité IRS 25 k$) à après 2-3 mois de
rétention payante prouvée.

## III. Plans de paiement

Trois plans payants, chacun incluant le précédent.

| Plan | Prix | Contenu | Marge moy. |
|---|---|---|---|
| **Starter** | **29 $/mois** (ou 290 $/an, −17 %) | CSV MT5, thèse macro, matrice, review IA, dashboard (win rate, R, profit factor, drawdown, compliance prop) | ~97 % (coût 0,80 $) |
| **Pro** | **44 $/mois** | Tout Starter + **Cloud Sync MT5**, **2 comptes inclus**, **+15 $/compte** au-delà ; cTrader via API (post-MVP) | ~70-75 % |
| **Elite** | **64 $/mois** | Tout Pro + **jusqu'à 5 comptes courtiers propres** (IB/OANDA/Tradovate/IG via SnapTrade ~2 $/compte) + supplément Cloud +15 $ | ~64-81 % |

**Pourquoi 44 $ (pas 39 $)** : à 39 $, un Pro à 2 comptes Cloud (21,62 $ de marge) rapportait
*moins* qu'un Starter (25,71 $) → l'upgrade faisait perdre de l'argent. À 44 $ (26,27 $), chaque
upgrade redevient rentable. **Pourquoi +15 $ (pas 10 $)** : à 10 $, +2,61 $ de marge (26 %) ; à
15 $, +7,26 $ (48 %) → nourrit l'expansion revenue.

**Marges Pro** : 1 cpt 44 $ → 32,97 $ (~75 %) · 2 cpt 44 $ → 26,27 $ (~60 %) · 3 cpt 59 $ →
33,47 $ (~57 %) · 4 cpt 74 $ → 40,67 $ (~55 %). **Elite** : pire cas (2 Cloud + 5 courtiers, 64 $)
→ 35,27 $ (~55 %), toujours > Starter.

**Essai/bêta/annuel** : trial 30 j (accès Starter complet, **blocage total** à l'expiration) ·
bêta-testeurs table séparée, accès Starter garanti, perks au cas par cas · annuel Starter ~290 $
(−17 %) · **early adopters** tarif figé à vie (ex. 24 $/mois).

**cTrader** : import CSV **masqué au MVP** (exports trop pauvres pour la matrice), code conservé ;
remplacement par l'**API officielle cTrader** (gratuite, post-MVP).

## IV. Sync automatique — Cloud Sync (MetaApi G2, lecture seule)

Tous les Pro/Elite en Cloud Sync (pas d'EA). Coût : marge Pro ~83 % → ~70-75 % (~3-5 $/client Pro),
mais des semaines de dev MQL5 et tout le support EA économisés.

Tarifs MetaApi G2 : abonnement **30 $/mois fixe** (payé une fois) · hébergement actif 0,012 $/compte/h ·
inactif 0,00105 $/h · déploiement 0,072 $ (**plancher 6h facturées**) · ajout compte 2,10 $ one-time ·
**API lecture gratuite**. Coût retenu : **~6,70 $/compte/mois** (heures de marché, undeploy le week-end).
Le fixe cesse de peser au-delà de **~20 abonnés Pro** (marge Pro ~72 %+).

## V. Marketing (faceless — Paul ne montre pas son visage)

- **Affiliation** : nano/micro-influenceurs (2 000-20 000 followers **actifs**), orientés *processus*
  (pas *résultat*), sur MT5/cTrader/prop firms. Deal **base 20 % / 6 mois**, **premium 25 % / 6 mois**
  (>10k commu), **jamais** au-delà. + accès Pro gratuit à vie, tarif early-adopter figé pour sa commu.
  Le 1ᵉʳ influenceur **recrute la cohorte bêta** (8-10). Codes promo Paddle `PRENOM-RJ`, commissions
  mensuelles via Payoneer (seuil 50 $), tableur Google Sheets puis webhook Supabase au-delà de 5 affiliés.
- **Contenu organique** : TikTok (3-5×/sem, acquisition), IG (carrousels, crédibilité/conversion),
  X (threads macro, thought leadership), YouTube (1-2/mois, tutos produit = conversion finale).
  5 piliers, hooks 3s, product-led (Relevé visible). Timing calé sur forex (dim. 20-22h UTC, 7-8h UTC,
  ven. 16-18h UTC, ±NFP/FOMC/CPI). Outils gratuits : CapCut, Canva, OBS, TradingView, ElevenLabs.
- **Rétention** : newsletter hebdo (dimanche soir, Render/Resend) + 5 emails lifecycle
  (Bienvenue, J+3, J+7, J+25, J+32). Stop après 2 non-ouvertures.
- **Agence** : pas avant la phase Scale (mois 19-24), MRR > 5 000 $/mois. L'analyse macro et la relation
  influenceurs ne se sous-traitent pas.

## VI. Coûts d'exploitation

- **Fixes/mois** : MVP ~1 $ · Prod 0-100 clients ~62-68 $ · 100-500 ~66-83 $ · 500+ ~57-98 $
  (API2Trade remplace le coût MetaApi par compte).
- **Variables/client** : Starter 3,29 $ (marge 25,71 $, 89 %) · Pro 1 cpt 11,03 $ (32,97 $, 75 %) ·
  Pro 2 cpt 17,73 $ (26,27 $, 60 %) · Elite pire 29,11 $ (34,89 $, 55 %).

## VII. Scaling provider — MetaApi → API2Trade

MetaApi scale **linéairement** (~6,70 $/compte). API2Trade = **forfait flat ~600 $/mois** (549 €),
comptes illimités (connexion REST directe, pas de terminal cloud).

| Provider | 100 cpt | 500 cpt | 1000 cpt | 5000 cpt |
|---|---|---|---|---|
| MetaApi actuel | 700 $ | 3 380 $ | 6 730 $ | 33 530 $ |
| MetaApi B2B (~50 %) | 365 $ | 1 723 $ | 3 415 $ | 17 015 $ |
| **API2Trade (flat)** | 600 $ | 600 $ | 600 $ | 600 $ |

**Seuils de bascule** : API2Trade < MetaApi actuel à **~85 comptes (~164 clients)** ; < MetaApi B2B à
**~170 comptes (~327 clients)**. Économie annuelle à 1 000 clients : **+34 970 $/an** ; à 10 000 : +411 240 $/an.
⚠️ API2Trade plus jeune (Trustpilot 4.0/5, pas d'essai) → **tester 2-4 semaines en parallèle** avant bascule.

## VIII. Projections (mix 60 % Starter / 30 % Pro / 10 % Elite, prix moyen ~37 $, churn 5 %)

| Clients | MRR brut | MRR net | Marge | ARR net |
|---|---|---|---|---|
| 25 | 925 $ | 630 $ | 68 % | 7 560 $ |
| 100 | 3 700 $ | 2 726 $ | 74 % | 32 712 $ |
| 500 | 18 500 $ | 13 886 $ | 75 % | 166 632 $ |
| 1 000 | 37 000 $ | 27 847 $ | 75 % | 334 164 $ |
| 10 000 | 370 000 $ | 285 626 $ | 77 % | 3 427 512 $ |

À 100 clients, l'écart pire→meilleur scénario n'est que ~920 $/mois : **le vrai levier est le nombre de
clients, pas l'optimisation des marges** (le plafonnement à 2 comptes + supplément 15 $ comprime la variance).

## IX. Churn, LTV, expansion revenue

- Churn probable **5 %/mois** → durée de vie ~20 mois, LTV brute 740 $ (nette ~555 $), LTV/CAC affilié ~12,6×.
- **Le churn est le seul chiffre qui peut tuer le projet** : à 12 %, plafond mathématique ~83 clients.
  Signal d'alarme dès le mois 1 de la bêta : **>3 testeurs sur 10 décrochent en 4 semaines**.
- **Expansion revenue** : comptes Cloud supplémentaires à 15 $ (marge 7,26 $) compensent ~39 % du churn
  (vs 14 % à 10 $) → churn net effectif ~3 %.

## X. Plan d'action par phases (1 phase = 1 session, commit après chaque)

0 Cadrage · 1 Supabase (colonnes users, table `beta_testers`, Google Auth) · 2 Gating (`has_access()`) ·
3 Essai (statut trial, blocage, bannière) · 4 Plans/upgrade (page **29/44/64 $**, prompts, badge bêta) ·
5 E-mail (Render) · 5bis Retrait CSV cTrader UI · 6 Streamlit Cloud · 7 Landing Vercel · 8 QA + onboarding
bêta · 9 Paddle (post-bêta) · 10 Cloud Sync MetaApi (supplément 15 $) · 11 API cTrader · 12 Migration
API2Trade (bascule ~164 clients).

## XI. Décisions clés (verrouillées)

- **Pricing** : Pro **44 $**, Elite **64 $** (chaque upgrade rentable). — §III.2
- **Architecture** : EA supprimé, tout Cloud Sync MetaApi G2. — §IV.1
- **Supplément** : **15 $**/compte Cloud (pas 10 $). — §IX.3
- **Plafonnement** : 2 comptes Cloud (Pro/Elite), 5 courtiers (Elite). Jamais d'illimité à prix fixe.
- **Scope MVP** : CSV cTrader masqué (pas supprimé), remplacé par l'API cTrader post-MVP.
- **Affiliation** : 20 %/6 mois (base), 25 %/6 mois (gros). Jamais 12 mois.
- **Paiements** : Paddle d'abord ; LLC US (Wyoming) après 2-3 mois de rétention payante.
- **Provider** : MetaApi G2 → négo B2B ~100 clients → bascule API2Trade ~164 clients.
- **Marketing** : product-led content (processus + Relevé visible) — seul format non copiable.
