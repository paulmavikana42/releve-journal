# Conformité prop firm — état des lieux

> **Statut : VERROUILLÉE** (cadenas + grisée dans la nav, route redirigée).
> Personne n'y accède pour l'instant, Paul inclus. À réactiver quand le compte
> sera **en prod réelle et rattaché en direct aux terminaux MT5** (flux live).
> `Réglages` reste accessible (les règles y sont saisies et servent au reste de
> l'app : marge de survie, drawdown du tableau de bord).

## Pourquoi elle est en pause
La page ne vaut que branchée sur un **solde live**. Tant que les données sont
importées à la main (rapport MT5 clôturé), une partie des métriques (solde du
moment, drawdown transaction par transaction) est reconstruite, pas mesurée. On
l'ouvrira quand le flux MT5 en direct alimentera le solde en continu.

## Ce qui est déjà construit (prêt à rallumer)

### Statut
- Bandeau **En règle / Règle enfreinte** (vert / rouge), avec solde et marge
  avant plancher. Plus de tuile **« vigilance »** (retirée : anxiogène sans
  valeur) ni de tuile **« perte journalière »** en doublon.

### Calendrier du mois
- Dupliqué du tableau de bord : le **P&L réellement tombé jour par jour** (ce que
  la prop firm regarde). Un jour sans sortie n'est pas un jour à zéro.

### Courbe d'équité
- Aire ambre avec **repères d'axes** : solde en ordonnée, **dates en abscisse**.
- **Axe temporel** : l'espacement reflète la vraie durée entre soldes (14/08 →
  03/09 n'est plus collé à 13/08 → 14/08). Points de solde visibles.

### Jours de trading (camembert)
- Camembert « type Excel » (parts pleines) — plus l'ancien anneau.
- Comptés au **MOIS courant** (se renouvellent chaque mois), affichés « X / N ce
  mois ». Règle configurable (ex. un jour compte si gain ≥ 0,50 %).

### Checks « où tu en es » (2 par 2)
- **Drawdown max** : affiche la **MARGE avant le plancher** (ex. `+9.56 % de
  marge`), pas la profondeur du creux ; le **pire creux** passe en détail.
- **Objectif de profit** : progression vers la cible de la phase.
- **Jours de trading min** : X / N requis.

## Cycle de challenge (par phase)
- Bouton manuel **« J'ai passé cette phase → »** (avec confirmation) : p1 → p2 →
  funded (2 phases) ou p1 → funded (1 phase / instant). Enregistre la **date** du
  passage (événement `phase_advanced`, append-only).
- À chaque passage, **toute la conformité repart de la base** : seuls les trades
  depuis le passage comptent, capital ramené au capital de départ (façon
  FundedNext : chaque phase = compte neuf à 100k).
- **Funded** = dernière étape : l'équité ne se réinitialise plus ensuite.
- **Jours de trading** : indépendants des phases, renouvelés au mois.
- **Sécurité** : tant qu'aucune phase n'est franchie, comportement d'origine
  (soldes broker, tous les trades même non rapariés) — pas de perte de données.

## Réglages liés (restent actifs)
- Compte(s) prop firm : capital, devise, drawdown (fixe / trailing), objectif.
- **Jours de trading min** : optionnel (+ seuil %).
- **Cohérence (consistency)** : optionnel (+ part max d'un jour %).

## Pour rallumer (plus tard, en prod live MT5)
1. Retirer la redirection de garde en tête de `app/compliance/page.tsx`
   (`COMPLIANCE_LOCKED = false`).
2. Dé-verrouiller l'entrée « Conformité » dans `app/components/Rail.tsx`
   (retirer le `locked`).
3. Brancher le solde live MT5 pour passer les métriques reconstruites en
   **mesurées**.
