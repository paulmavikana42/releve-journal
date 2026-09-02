# releve-next

Bascule de **Relevé** (Streamlit/Python) vers **Next.js/TypeScript**.
Séquence validée avec Paul — **le moteur d'abord, l'UI en dernier**.

L'app Streamlit reste **allumée en parallèle** jusqu'à la PORTE 4 (non-régression
sur données réelles). Ce dossier ne remplace rien tant que cette porte n'est pas
verte.

## État des phases

- [x] **Phase 0 — Échafaudage** : workspace, TypeScript strict, Vitest, decimal.js, CI à vide.
- [ ] **Phase 1 — Moteur** : port de `core/*.py` (tests d'abord), 254 équivalents verts + test d'or MT5.
- [ ] **Phase 2 — Cloisonnement multi-comptes** (`prop`, `uid`), zéro fuite.
- [ ] **Phase 3 — Blocs** (format figé depuis l'existant).
- [ ] **Phase 4 — Parsers MT5/CSV** (serveur uniquement).
- [ ] **Phase 5 — Supabase** (events append-only + RLS) + Auth Google (@supabase/ssr).
- [ ] **Phase 6 — Non-régression** Python vs TS sur le vrai `events.jsonl` (bloquant).
- [ ] **Phase 7 — UI** (palette/typo de `theme.py`, ordre du dashboard).
- [ ] **Phase 8 — Déploiement** Vercel, secrets en env.

## Structure

```
releve-next/
  packages/core/     moteur pur TS (miroir de core/), ZÉRO import React/Next
  (apps/web/         ajouté en phase 7 — l'app Next.js)
```

## Règles non négociables

- **Decimal, jamais float** : `decimal.js`, contexte figé (précision 28, arrondi
  pair) — voir `packages/core/src/decimal.ts`. Un `number` natif sur un montant
  réintroduit des erreurs d'arrondi silencieuses.
- **Les tests sont la spec** : on porte `tests/*.py` avant d'implémenter.
- **Secrets en variables d'environnement**, jamais en dur.

## Commandes

```bash
npm install     # à la racine releve-next/
npm test        # Vitest (packages/*/src/**/*.test.ts)
npm run typecheck
```
