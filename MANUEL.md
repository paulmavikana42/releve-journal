# Relevé — Manuel d'utilisation

Un journal de trading qui peut te **contredire**. C'est la seule chose qui le distingue d'un tableur.

---

## Sommaire

1. [Installation](#1-installation)
2. [Le principe en une page](#2-le-principe-en-une-page)
3. [Le cycle d'une idée](#3-le-cycle-dune-idée)
4. [Écrire une thèse](#4-écrire-une-thèse)
5. [Importer et apparier](#5-importer-et-apparier)
6. [La review](#6-la-review)
7. [Lire le tableau de bord](#7-lire-le-tableau-de-bord)
7 bis. [La page Compliance prop](#7-bis-la-page-compliance-prop)
8. [Comment le R est calculé](#8-comment-le-r-est-calculé)
9. [Utiliser depuis ton téléphone](#9-utiliser-depuis-ton-téléphone)
10. [Tes données](#10-tes-données)
11. [Ce que l'outil ne fait pas](#11-ce-que-loutil-ne-fait-pas)
12. [Dépannage](#12-dépannage)

---

## 1. Installation

### La version simple : `Releve.exe`

Décompresse le dossier **`Releve`** où tu veux (le Bureau fait très bien
l'affaire) et double-clique **`Releve.exe`**.

Une fenêtre s'ouvre, prépare l'application quelques secondes, puis ton
navigateur affiche Relevé. **Rien à installer** : ni Python, ni quoi que ce
soit. Pas besoin d'internet non plus.

| | |
|---|---|
| **Laisse la fenêtre ouverte** | c'est elle qui fait tourner l'application |
| **Bouton `Terminer`** | arrête tout proprement. Fermer la croix fait pareil |
| **Fermer l'onglet du navigateur** | ne suffit pas : reviens sur la fenêtre et clique `Terminer` |

Au tout premier lancement, l'application pose **deux questions** : les
caractéristiques de ton compte (capital et limites), et si tu veux démarrer sur
un journal vierge ou avec des données de démonstration. Ça ne se redemande
jamais, et tout se corrige ensuite dans `Réglages`.

Si tu choisis la démonstration, elle vit dans un fichier **à part** et elle est
**supprimée** à ton premier import : les trades d'exemple ne se retrouveront
jamais dans ton journal, ni nulle part sur ton disque. Ce que tu auras écrit
toi-même pendant la découverte, en revanche, est conservé.

Ces données de démonstration sont **entièrement inventées** — compte fictif,
tickets fictifs. Aucun historique de trading réel ne voyage dans le programme :
tu peux le donner à qui tu veux sans donner tes trades avec.

### J'ai déjà un journal d'une version précédente

`Réglages` → **Reprendre un journal existant** → dépose ton `events.jsonl`.

Il n'y a **rien à convertir** : le format n'a jamais changé, il a grandi. L'écran
te dit d'abord ce que contient le fichier (combien d'idées, de tickets, quelle
période), et tu choisis de **remplacer** ton journal actuel ou d'**ajouter** ce
fichier au tien. Dans les deux cas, l'existant est sauvegardé à côté, daté, avant
d'être touché.

Si tu préfères faire à la main, c'est aussi simple : copie ton `events.jsonl`
dans le dossier de données (`Réglages` → *tes données* affiche le chemin exact)
et relance.

Tes données vont dans **ton** dossier utilisateur
(`%LOCALAPPDATA%\Releve\data`), jamais dans le programme : tu peux déplacer,
remplacer ou supprimer le dossier `Releve` sans jamais toucher à ton journal.

> **Windows va probablement afficher un avertissement bleu** au premier
> lancement : « Windows a protégé votre ordinateur ». Clique sur **Informations
> complémentaires**, puis **Exécuter quand même**.
>
> Ce n'est pas un problème de sécurité, et ce n'est pas évitable sans payer un
> certificat de signature à Microsoft : Windows affiche ce message pour **tout**
> programme qu'il ne connaît pas encore, y compris ceux qu'on écrit soi-même.

### La version développeur : depuis les sources

Double-clique **`Releve.bat`**.

Il crée l'environnement et installe les dépendances : 2 à 3 minutes, une seule fois. Ton navigateur s'ouvre ensuite sur l'application.

### Les lancements suivants

Double-clic sur **`Releve.vbs`** — la fenêtre est réduite dans la barre des tâches au lieu de rester au premier plan. Clic droit dessus → *Envoyer vers* → *Bureau* pour avoir une icône.

Elle est **réduite, pas cachée** : c'est volontaire. Une fenêtre invisible cache aussi les erreurs, et l'app semble alors « ne pas s'ouvrir » sans le moindre message.

### Pour arrêter

Ferme la fenêtre noire, ou double-clique **`Arreter Releve.bat`**.

Fermer l'onglet du navigateur **ne suffit pas** : le serveur tourne toujours derrière, et il occupe le port. C'est la cause n°1 des « ça ne se lance plus ».

### Prérequis

Pour la version **`.exe`** : aucun. C'est tout l'intérêt.

Pour la version **sources** : **Python 3.11 ou plus**, installé depuis
[python.org](https://python.org) **en cochant « Add python.exe to PATH »** sur le
premier écran. C'est la seule chose qui peut casser l'installation.

### Donner l'outil à quelqu'un d'autre

Double-clique **`Construire l'exe.bat`** (5 à 10 minutes). Il fabrique
`dist\Releve\` : compresse ce dossier en ZIP et envoie-le. La personne
décompresse, double-clique, c'est tout — ses données iront dans **son** dossier
utilisateur, pas dans le tien.

Le script lance les tests avant de construire et **refuse de produire un
programme si l'un d'eux échoue**. On ne distribue pas un outil dont on sait
qu'il ment.

---

## 2. Le principe en une page

**La thèse précède le trade. MT5 vient la juger.**

```
tu écris ta thèse  →  tu exécutes  →  tu importes MT5  →  tu apparies  →  tu relis
   (falsifiable)                        (le verdict)      (tu valides)    (le juge)
```

Trois choses en découlent, et elles expliquent tout le reste du logiciel.

### a) Ton stop initial ne peut venir que de toi

MT5 n'archive que ton **dernier** stop, pas le premier. Sur ton ticket `251022835` :

| Entrée | 63 791,42 (sell) |
|---|---|
| **Stop archivé par MT5** | **63 782,35** — soit 9 points *au-dessus* de l'entrée |

C'est ton breakeven, pas ton stop d'origine. Calculer le R là-dessus donnerait **+63 R** sur un trade qui a perdu de l'argent.

L'outil **refuse** de calculer dans ce cas plutôt que de mentir. Le stop vient de ta thèse.

### b) MT5 compte des tickets. Toi, tu prends des décisions.

Tes trois tickets BTCUSD du 7–9 juillet formaient **une seule idée** : même sens, périodes qui se chevauchent.

| MT5 dit | La réalité |
|---|---|
| 3 trades, 33 % de réussite | 1 idée, 0 % de réussite |
| Sharpe −0,43 | non défini sur 3 points |
| Plus large gagnante : +397 $ | une jambe d'un trade perdant |

L'unité d'analyse est **l'idée**, jamais le ticket.

### c) Une donnée pré-engagée ne vaut pas une donnée reconstituée

Chaque R porte sa provenance, et les deux ne sont **jamais** mélangés en silence :

| ● `computed` | stop écrit avant le trade → **fiable** |
|---|---|
| ○ `backfilled` | stop reconstitué de mémoire → indicatif, exclu par défaut |
| ○ `unknown` | pas de stop → R non calculable |

---

## 3. Le cycle d'une idée

```
BROUILLON  →  ARMÉE  →  EN COURS  →  CLÔTURÉE  →  REVUE
                ↓
           ABANDONNÉE
```

| État | Ce que ça veut dire | Ce que TU fais |
|---|---|---|
| **ARMÉE** | Idée écrite, stop posé. Elle attend son exécution. | rien |
| **EN COURS** | Tu as déclaré ton n° de ticket à l'entrée. Le trade vit. | déplacer le stop, ajouter des captures |
| **CLÔTURÉE** | L'import a retrouvé ce ticket et l'a refermé. | rien |
| **REVUE** | Review faite. L'idée entre dans les statistiques. | rien |
| **ABANDONNÉE** | Idée jamais exécutée. | juger : le setup s'est-il présenté ? |

### Le maillon qui change tout : déclarer le ticket

Au moment où tu entres, tu coches **« Je viens d'entrer — déclarer le ticket
maintenant »** et tu tapes le numéro que MT5 t'affiche. Trente secondes, sur le
téléphone.

Ce que ça débloque, et qui était impossible sans :

1. **Le trade existe dans l'outil pendant qu'il vit.** Avant, une position
   ouverte n'apparaissait nulle part : le rapport du broker ne contient que des
   trades fermés, et ton idée restait « armée » pendant trois jours.
2. **Ton stop réel est enregistré avant d'être écrasé.** Dès que tu passes au
   breakeven, le stop d'origine est perdu pour toujours côté broker. Là, il est
   déjà écrit.
3. **La clôture devient automatique.** Ton prochain export retrouve ce numéro de
   ticket et referme *ce* trade : prix de sortie, P&L réel, durée. Aucun
   appariement à la main, aucun doublon possible, aucune ressaisie.

Tu peux ne pas le faire : l'outil continue de fonctionner comme avant, avec
l'écran d'appariement. Tu perds juste les trois points ci-dessus.

---

## 4. Écrire une thèse

**Onglet `Idées` → `Écrire une thèse`.** À faire **avant** d'entrer en position.

### Le seul champ indispensable : le stop initial

Sans lui, aucun R n'est calculable. Ce n'est pas une préférence de conception, c'est une contrainte technique du format MT5.

L'outil vérifie la cohérence : sur un *sell*, le stop doit être **au-dessus** de l'entrée. Sinon il refuse.

### Les autres champs, et pourquoi ils existent

| Champ | Pourquoi |
|---|---|
| **Thème macro** *(catégoriel)* | C'est ce qui rend tes thèses **agrégeables**. En texte libre, tu ne sauras jamais sur quel type de thèse tu performes. |
| **Conviction (1–5)** | Sert à la **calibration** : après quelques dizaines d'idées, l'outil te dira si ta conviction prédit quoi que ce soit — ou si tu sizes sur du bruit. |
| **Risque visé (%)** | Ne sert **pas** au calcul du R. Sert de **contrôle croisé** : l'outil compare ce que tu voulais risquer à ce que tu as réellement risqué. |
| **Invalidation de la thèse** | Distinct du stop technique. C'est ce qui tue l'**idée** même si le prix ne touche pas ton stop : un CPI à contresens, un pivot BoJ. |

### La case « trade déjà pris »

Marque la donnée comme **reconstituée**. Elle sera exclue par défaut des statistiques.

Coche-la honnêtement. L'outil ne peut pas savoir si tu as écrit ta thèse avant ou après — mais si tu lui mens, il ne pourra plus te contredire, et il ne sert plus à rien.

### Les captures

Autant que tu veux, dès l'écriture de l'idée : le graphique de ta thèse, le
ticket d'ordre, la structure sur deux unités de temps. Et à tout moment ensuite,
depuis le détail de l'idée — y compris **pendant** que le trade est en cours.

Ce n'est pas de la décoration. Une capture jointe **au moment du trade**
horodate ce que tu voyais et où était ton stop : c'est une donnée
**pré-engagée**, exactement au même titre qu'un champ du broker. Une capture
ajoutée trois semaines plus tard illustre, elle ne prouve rien — l'outil affiche
la date d'ajout à côté, il ne la cache pas et ne la juge pas.

Les images vivent dans `data/captures/`, en clair. Retirer une capture la sort de
l'écran mais **n'efface pas le fichier** : une image supprimée par erreur ne se
reconstitue pas.

Une thèse macro peut porter ses propres captures (le DXY, le COT) — elles
n'appartiennent à aucune jambe en particulier.

### Astuce qui vaut tout le reste

**Pose ton SL directement dans le ticket d'ordre MT5**, avant de valider — pas après coup.

MT5 l'archive alors dans sa table *Ordres*, et ce champ **ne change jamais**, même quand tu passes au breakeven. L'outil le récupère automatiquement : ton stop devient une **donnée machine**, non falsifiable, sans aucune saisie.

C'est ce qui a permis de récupérer les 451,06 $ de ton add 1 sans rien te demander.

---

## 5. Importer et apparier

### Deux formats, et lequel choisir

| Format | Comment l'obtenir | Ce qu'il apporte en plus |
|---|---|---|
| **CSV** (MT4, MT5, cTrader, générique) | export de l'historique de ton terminal | le chemin normal, rapide |
| **HTML** (rapport d'historique MT5) | onglet **Historique** → clic droit → **Rapport** → HTML | la table *Ordres* (stops **prouvés**) et la série des **soldes** (drawdown mesuré comme le mesure ta firme) |

Les deux cohabitent. Si ton CSV n'a pas de colonne « solde », l'outil le dit et
reconstitue la courbe depuis tes clôtures — juste sur les résultats, aveugle aux
creux intrajournaliers. Il ne fait pas semblant d'avoir la donnée.

### Le rapprochement se fait par NUMÉRO DE TICKET

**Onglet `Import`** → dépose le fichier. Chaque ligne est classée avant que tu
valides quoi que ce soit :

| Étiquette | Ce que ça veut dire |
|---|---|
| **clôture le trade ouvert** | ce ticket est un de ceux que tu as déclarés : il va être refermé avec ses vraies données |
| **met à jour « en cours »** | déclaré, toujours ouvert : seul le stop est actualisé |
| **nouveau trade** | ticket clôturé jamais vu : à rattacher à une idée (écran suivant) |
| **nouveau trade ouvert** | ticket ouvert que tu n'avais pas déclaré : tu choisis son idée d'accueil |
| **déjà connu — ignoré** | rien à faire. C'est le résultat *attendu* si tu réimportes |

L'import est **idempotent** : un ticket déjà connu n'est jamais réimporté. Tu
peux déposer dix fois le même fichier, ou un fichier plus large qui recouvre
l'ancien — rien ne bouge, rien ne se duplique.

**Si ton export a des intitulés exotiques**, l'outil ne devine pas : il affiche
les champs qu'il n'a pas reconnus et te laisse désigner les colonnes à la main
(*mapping manuel*), puis relit le fichier.

### Apparier — pour les tickets que tu n'avais PAS déclarés

Si tu déclares tes tickets à l'entrée, cet écran ne s'affiche plus. Sinon, pour
chaque ticket nouveau, l'outil cherche les idées candidates (même symbole, même
sens, idée antérieure au trade) et te pose **une question** :

```
┌─ Position 251396944 ─────────────────────────────┐
│  BTCUSD · sell · 0.66 lot · 08/07 21:03          │
│                                                   │
│  Idée candidate :                                 │
│  « Short BTC — liquidité »  (armée le 07/07)      │
│  déjà 2 tickets rattachés                         │
│                                                   │
│  ☑ Mon noyau était déjà au breakeven              │
│                                                   │
│  [ Rattacher — c'est un ADD sur cette idée ]      │
│  [ Aucune — c'est un trade hors-plan       ]      │
└───────────────────────────────────────────────────┘
```

**Rien n'est jamais fusionné sans ton clic.** Deux thèses distinctes peuvent se chevaucher sur le même instrument, et une fusion à tort pollue tes statistiques pour toujours.

### La case « noyau au breakeven »

Elle n'apparaît que sur les **renforcements**, et elle décide d'un chiffre important.

> *« Quand j'ai ouvert ce ticket, mon noyau était-il déjà au breakeven ? »*

Un noyau sécurisé ne risque plus rien : son risque **sort du calcul d'exposition simultanée**. Sur ta campagne BTC, l'écart va du simple au double :

| Case cochée | exposition **0,60 %** — conforme à ta thèse |
|---|---|
| Case non cochée | exposition **1,11 %** — presque le double |

Sans réponse, l'outil **suppose le pire** et affiche un majorant, pas une mesure. Il te le dit explicitement.

Tu peux corriger la réponse plus tard dans le détail de l'idée.

### Un trade sans thèse : le hors-plan

Si aucune thèse ne correspond, ce n'est **pas une erreur** — c'est une information : tu as pris un trade que tu n'avais pas écrit.

L'outil l'enregistre comme `hors-plan` et le compare à tes trades planifiés. C'est probablement le chiffre le plus dur que produira ce logiciel.

---

## 5 bis. Quand MT5 a perdu le stop

Il arrive qu'aucune source ne connaisse le stop d'origine d'un ticket : ordre au
marché sans SL, stop posé après coup, puis remonté au breakeven. MT5 a écrasé
l'original, et ta thèse ne contient que celui du **noyau**.

**Chaque renforcement porte son propre stop.** Il n'hérite jamais de celui du noyau.

Dans ce cas, le détail de l'idée affiche un bloc rouge et te demande de saisir le
stop de ce ticket. Une fois, un chiffre.

> **Tant qu'un seul ticket reste sans stop, le R de l'idée entière est
> « non calculable ».** Un dénominateur partiel serait pire que rien.

### D'où vient le chiffre

L'outil te demande une seule chose : **capture du ticket**, ou **de mémoire** ?

Ce n'est pas une suspicion sur ta parole. C'est le seul axe qui compte, et ce n'est
pas « automatique vs manuel » :

| **capture** | Ton relevé du ticket, pris au moment du trade. L'image l'horodate : c'est une donnée **pré-engagée**, au même niveau qu'un champ MT5. Elle ne dégrade rien. |
|---|---|
| **de mémoire** | Retrouvé après coup. Ça reste une reconstitution — et l'idée entière passe en `indicatif`. |

Un seul stop retrouvé de mémoire suffit à dégrader le R de l'idée : la fiabilité
d'une chaîne est celle de son **maillon le plus faible**.

---

## 5 ter. Les thèses macro (facultatif)

Une même conviction peut se jouer sur **plusieurs instruments** :

```
THÈSE MACRO  « Dollar fort — Fed hawkish »
  │
  ├── IDÉE   EURUSD sell   (ticket + adds)   →  −0,4 R
  └── IDÉE   USDJPY buy    (ticket + adds)   →  +1,2 R
                                                ────────
                          R de la thèse macro :   +0,8 R
```

**Le R d'une thèse macro = la somme des R de ses idées.**

L'outil affiche aussi une seconde lecture, `P&L total / risque total`, qui répond
à une question différente : *combien ai-je gagné **par unité de risque** engagée ?*
Les deux divergent dès que tes idées n'engagent pas le même risque.

### Pourquoi une couche à part

Une idée reste **mono-symbole**, et ce n'est pas une limitation arbitraire.

Le R, le pyramidage, le breakeven et l'exposition simultanée reposent tous sur des
tickets **corrélés à 100 %** — vrai par construction sur un seul instrument, faux
entre deux. Et « ticket initial » vs « renforcement » n'a aucun sens entre deux
paires : ton EURUSD n'est pas un add de ton USDJPY, c'est une **jambe**.

L'idée garde donc sa mécanique prouvée. La thèse macro agrège par-dessus, en
devise du compte — sommable sans ambiguïté.

### Entièrement facultatif

Une idée sans thèse macro se comporte **exactement** comme avant. N'en crée que
quand une conviction se joue réellement sur plusieurs instruments.

Rattachement depuis le détail d'une idée, en bas de page.

---

## 6. La review

Quand tous les tickets d'une idée sont fermés, un compteur apparaît. **Pas de blocage** — juste une friction visible. Un mur te ferait remplir n'importe quoi.

### La discipline : cinq critères, pas un booléen

1. Entrée dans la zone prévue
2. Taille conforme au risque défini
3. Stop placé à l'invalidation annoncée
4. Stop jamais élargi ni retiré
5. Sortie conforme au plan

**Un booléen se note généreusement. Une checklist se vérifie.**

### Le verdict sur la thèse — indépendant du P&L

| `correcte` | le marché t'a donné raison |
|---|---|
| `fausse` | le marché t'a donné tort |
| `non testée` | tu es sorti avant que le marché tranche |

**Ce champ n'a rien à voir avec le fait de gagner ou perdre.** Une thèse correcte mal exécutée peut perdre. Une thèse fausse peut gagner par chance.

C'est précisément ce que la matrice sépare — et c'est pour ça que ce champ existe.

---

## 7. Lire le tableau de bord

### D'abord : sur quoi comptes-tu ?

Trois boutons en haut de page, et ils changent **tous** les chiffres en dessous.

**Unité d'analyse — par thèse (défaut) ou par idée.** Une thèse macro jouée en
short EURUSD *et* long USDJPY est **une** décision, pas deux. La compter deux
fois doublerait ton échantillon et ferait passer une conviction pour deux
confirmations. En mode « par idée », chaque jambe compte séparément : utile pour
juger ton exécution instrument par instrument, trompeur pour juger ton edge.
L'écran te dit toujours dans quel mode tu es.

**Mesure — en R ou en %.** Le R mesure ton *edge* en neutralisant la taille de
position. Le pourcentage mesure ce que ça a fait *au compte*. Les deux sont
vrais, ils ne répondent pas à la même question.

**Matrice en — argent, % ou R.** Ce que chaque case a coûté ou rapporté. Un
simple compte ne dit pas si tes trois « erreurs » ont coûté 200 $ ou 12 000 $.

### La courbe de R cumulé

**Verte au-dessus de zéro, rouge en dessous.** La couleur dit l'état du cumul à
cet instant, pas son état final — et le changement se fait exactement au point
de croisement, pas au trade suivant.

### Le calendrier

Le mois, jour par jour. **Seuls les jours de clôture sont colorés** : vert si la
journée est positive, rouge sinon, avec le montant. Un jour sans clôture reste
neutre — ce n'est pas un jour à zéro, c'est un jour où rien n'a été tranché, et
les deux ne veulent pas dire la même chose.

### La matrice décision × résultat

Quatre cases, une seule question par trade : **je le rejoue ou pas ?**

|  | Mauvais process | Bon process |
|---|---|---|
| **Gain** | chance ⚠ | maîtrise ✓ |
| **Perte** | erreur ✗ | aléa OK |

- **Maîtrise** — à répliquer, pas seulement à célébrer.
- **Chance** — la case la plus dangereuse du tableau : un mauvais process qui a
  payé est celui qu'on répète.
- **Erreur** — le seul quadrant dont le coût était évitable.
- **Aléa OK** — tu as perdu en respectant ton plan. Coût normal du métier, rien
  à corriger.

Le quadrant n'apparaît **qu'après la review** : sans elle, le process n'est pas
jugé, et l'outil n'invente pas ce qu'il n'a pas mesuré. C'est volontairement
inconfortable — c'est ce qui pousse à faire la review.

### La courbe de R cumulé

Pas la courbe du solde : celle du **R**. Le solde mélange ton edge et ta taille
de position — doubler la taille double la courbe sans que tu sois meilleur. Le R
cumulé neutralise le sizing : c'est la courbe de ta compétence.

### L'histogramme

**Une barre = une idée**, pas un ticket. Et la **texture** de la barre encode ta discipline :

| ▮ **pleine** | plan respecté (5/5) |
|---|---|
| ▨ **hachurée** | plan dégradé (≤3/5) |
| ▯ **contour** | review à faire |

Tu vois si tes gains sont **propres** avant même de lire un chiffre. Clique une barre pour ouvrir l'idée.

### La matrice thèse × exécution

|  | Exécution propre (5/5) | Exécution dégradée (≤3/5) |
|---|---|---|
| **Thèse correcte** | ton vrai edge | ce que tu laisses sur la table |
| **Thèse fausse** | coût normal du business | zone rouge |

**La seule question qui vaille : ce qui me coûte de l'argent, c'est mon analyse, ou c'est moi ?**

L'outil calcule ton **coût d'indiscipline** : la différence d'espérance, en R, entre tes thèses correctes bien exécutées et mal exécutées.

### Plan vs hors-plan

L'espérance de tes trades écrits, comparée à celle de tes trades improvisés.

### Calibration de conviction

Tes idées notées 5/5 surperforment-elles tes 2/5 ? Si la relation est plate ou **inversée**, ta conviction est du bruit — et c'est une information majeure, parce que tu sizes probablement dessus.

### Tes renforcements

P&L des tickets initiaux vs P&L des adds. Sur ta campagne BTC :

> ticket initial **+380 $** · renforcements **−969 $**

Un seul échantillon ne prouve rien. Trente idées trancheront.

### Les ratios

**Sharpe et Sortino annualisés**, calculés depuis les rendements journaliers — pas depuis les P&L par trade, qui ne sont comparables à rien.

Ils sortent avec leur **intervalle de confiance**. Sous ~30 jours, l'IC couvre le zéro : le chiffre est affiché pour le voir grandir, pas pour en conclure quoi que ce soit. L'outil te le dit.

### Le drawdown — important pour ta prop firm

Il est mesuré **après chaque transaction**, pas en clôture de journée.

Le 9 juillet, ton solde a touché 99 014,06 à 09h59 avant de remonter à 99 411,26 à 10h51 :

| DD vu en clôture de journée | 0,59 % |
|---|---|
| **DD réellement touché** | **0,99 %** ← ce que voit MT5, ce que voit FundedNext |

Une prop firm contrôle le drawdown **en continu**. Un outil qui affiche 0,59 % pendant que la firme en voit 0,99 % te fait sauter un challenge en te croyant à l'abri.

---

## 7 bis. La page Compliance prop

Le tableau de bord répond à *« combien me reste-t-il avant de sauter ? »*. Cette
page répond à l'autre question : *« suis-je en règle sur **toutes** les lignes du
contrat ? »* — y compris celles qu'on oublie.

| Règle | Ce qui est mesuré | Piège |
|---|---|---|
| **Perte journalière** | P&L du jour ÷ solde **du début de ce jour-là** | 4 000 $ perdus sur un compte tombé à 95 000 $ font **4,21 %**, pas 4,00 % |
| **Drawdown max** | repli depuis la base, **statique** ou **trailing** | FundedNext est **statique** : le plancher à 90 000 $ ne bouge jamais, même après 20 000 $ de gains |
| **Objectif de profit** | avancement vers la cible | non atteint ≠ infraction |
| **Jours de trading min.** | jours distincts avec au moins une clôture | |
| **Position week-end** | y a-t-il un ticket **en cours** un samedi ? | la règle la plus bête à enfreindre, et elle coûte le compte. Alerte dès le vendredi soir |
| **Cohérence** | part du profit total que pèse ton meilleur jour | aucune firme ne coupe le compte pour ça — elle **bloque le retrait** |

Toutes ces règles sont **paramétrables** dans `Réglages`, par compte : elles sont
contractuelles et changent d'une firme à l'autre. Un chiffre codé en dur qui ne
correspond pas à ton contrat est pire que pas de chiffre du tout.

### Plusieurs comptes

Chaque compte a ses règles, ses statistiques et son journal d'idées — rien ne se
mélange. Le compte actif se change en bas du rail. (Il n'y a pas de
« déconnexion » : l'outil tourne en local, sans compte utilisateur ni mot de
passe. Il n'y a rien à quitter.)

---

## 8. Comment le R est calculé

### Étape 1 — D'où vient le stop de chaque ticket

L'outil ne demande pas *« quel est le stop ? »* mais **« puis-je lui faire confiance ? »**

| État | Condition | Ce qu'il fait |
|---|---|---|
| `prouvé` | SL au placement **=** SL final | Le stop n'a jamais bougé → **fiable, on le prend** |
| `déplacé` | SL au placement **≠** SL final | → on prend celui du **placement**, l'original |
| `suspect_breakeven` | Pas de SL au placement, SL final collé à l'entrée (< 0,15 %) | → **on refuse de calculer** |
| `non vérifié` | Pas de SL au placement, SL final à distance normale | → on le prend, faute de mieux |

La table **Ordres** contient le SL **au placement**. La table **Positions** contient le SL **final**. En croisant les deux, on récupère gratuitement le vrai stop.

Et le **ticket initial** reçoit toujours le stop de ta **thèse**, qui prime sur tout.

### Étape 2 — Le breakeven ne réduit jamais le dénominateur

Le R se mesure contre le risque **initialement mis sur la table**, pas contre le risque résiduel.

Si le breakeven comptait comme dénominateur, chaque trade sécurisé exploserait à +50 R et ton espérance deviendrait de la science-fiction.

### Étape 3 — Le risque de l'idée

```
risque de l'idée = somme des risques de tous ses tickets

  ticket initial   599,66 $   (ta thèse : stop 64 700)
  add 1            451,06 $   (stop PROUVÉ, récupéré du fichier)
  add 2            505,76 $
                 ───────────
                 1 556,48 $

R = −588,74 / 1 556,48 = −0,38 R
```

Si **un seul** ticket a un risque inconnu, l'outil renvoie « non calculable » pour l'idée entière. Un dénominateur partiel serait pire que rien.

### Étape 4 — L'exposition simultanée

Un chiffre différent, que MT5 ne donne **nulle part** : combien de risque portais-tu **en même temps** ?

Un ticket fermé ne compte plus. Un ticket au breakeven ne compte plus **à partir du moment où tu ajoutes** — d'où la case.

C'est le chiffre que regarde ta prop firm.

---

## 9. Utiliser depuis ton téléphone

Tu exécutes sur mobile, mais la thèse doit s'écrire **avant** d'entrer.

**PC allumé, même Wi-Fi** → double-clique **`Releve - acces telephone.bat`**.

Il affiche une adresse du type `http://192.168.1.42:8501`. Ouvre-la depuis le navigateur de ton téléphone : tu écris ta thèse depuis ton lit, ton PC la stocke.

**Aucun cloud, aucun tiers.** Rien ne sort de ton réseau local.

### Hors de chez toi, ça ne marche pas

Et je ne vais pas te vendre l'inverse. Mais si tu **poses ton SL directement dans le ticket d'ordre**, ton risque est capturé par MT5 de toute façon. La thèse écrite après ne dégrade alors que la partie narrative — pas tes chiffres.

---

## 10. Tes données

Tout vit dans un seul fichier : **`data/events.jsonl`**.

Une ligne = un événement, **jamais réécrit** :

```json
{"ts":"…","type":"thesis_created","payload":{…}}
{"ts":"…","type":"capture_added","payload":{…}}
{"ts":"…","type":"trade_opened","payload":{…}}
{"ts":"…","type":"trade_updated","payload":{…}}
{"ts":"…","type":"position_imported","payload":{…}}
{"ts":"…","type":"position_linked","payload":{…}}
{"ts":"…","type":"add_secured","payload":{…}}
{"ts":"…","type":"review_completed","payload":{…}}
```

| **Incorruptible** | une écriture interrompue perd au pire la dernière ligne |
|---|---|
| **Auditable** | si tu modifies une thèse *après* avoir vu le résultat, l'horodatage le sait |
| **Idempotent** | réimporte dix fois le même rapport, rien ne bouge |
| **Réparable** | c'est du texte. Un bloc-notes suffit. |

### Sauvegarde

**Copie le dossier `data/` entier quelque part.** Il contient le journal *et* tes
captures (`data/captures/`).

Il n'y a volontairement **aucun bouton** de sauvegarde dans l'application : une
copie faite par l'outil, sur le même disque, ne protège de rien le jour où la
machine meurt. Le geste qui protège est un glisser-déposer vers une clé, un
disque externe ou ton cloud — et il se fait dehors.

Les images ne sont pas dans le journal, seulement leur chemin : un JSONL doit
rester lisible au bloc-notes dans dix ans, une image en base64 le rendrait
impraticable.

Ton actif n'est ni le code ni le logiciel — le code se réécrit en un week-end. Ce sont tes **thèses annotées, année après année**. C'est pour ça que le format est du JSON brut plutôt qu'une base de données : dans dix ans, avec n'importe quel langage, ce fichier sera encore lisible.

---

## 11. Ce que l'outil ne fait pas

Autant être clair là-dessus.

- **Il ne se connecte pas à ton broker.** Tu exportes le fichier à la main.
- **Il n'a aucun flux de prix.** Un trade en cours n'affiche un flottant que si
  **tu** saisis un cours, et ce chiffre porte toujours son horodatage. Il
  n'entre dans aucune statistique.
- **Il ne connaît pas ton solde live.** Il connaît tes trades clôturés. Une
  position ouverte ne bouge le solde affiché que par le cours que tu as saisi.
- **Il ne lit pas le journal MT5.** Ce journal existe et contient l'horodatage de tes déplacements de stop — mais il est écrit par le terminal PC. Sur mobile, il n'existe pas. D'où la case breakeven manuelle.
- **Il ne te dira rien de fiable avant ~30 idées.** Les intervalles de confiance sont là pour te le rappeler à chaque écran.
- **Il ne compense pas une thèse écrite après coup.** Il la marquera `backfilled` et l'exclura.

---

## 12. Dépannage

| Symptôme | Cause | Solution |
|---|---|---|
| « Windows a protégé votre ordinateur » | programme non signé — Windows dit ça de tout ce qu'il ne connaît pas | *Informations complémentaires* → *Exécuter quand même* |
| L'antivirus met l'exe en quarantaine | même raison ; les exes fabriqués avec PyInstaller déclenchent parfois une heuristique | Autorise le dossier `Releve` dans ton antivirus |
| Rien ne se passe au double-clic de l'exe | l'application prépare (première ouverture) | Attends 10 à 20 secondes ; la fenêtre s'ouvre |
| Le navigateur affiche « connexion refusée » | le serveur n'a pas fini de démarrer | Reviens sur la fenêtre : clique *Ouvrir dans le navigateur* quand elle dit « C'est prêt » |
| `python n'est pas reconnu` | Python absent du PATH | Réinstalle depuis python.org en cochant *Add python.exe to PATH* |
| `No module named 'core'` | Mauvais dossier | Lance depuis le dossier contenant `core/` et `app/` — ou utilise `Releve.bat` |
| L'app ne s'ouvre pas | Le navigateur n'a pas suivi | Va sur `http://localhost:8501` |
| Le `.vbs` ne fait plus rien | Une instance tourne déjà (port occupé) | Double-clique **`Arreter Releve.bat`**, puis relance |
| Erreur invisible | — | Lance **`Releve.bat`** au lieu du `.vbs` : la fenêtre reste ouverte et affiche le message |
| « Aucune position trouvée » | Mauvais export MT5 | Prends un **Rapport d'historique**, pas un *Relevé* |
| Le téléphone ne se connecte pas | Pare-feu ou réseaux différents | Même Wi-Fi ; autorise Python dans le pare-feu Windows |
| Espérance affichée `—` | Aucun stop pré-engagé | Normal : tes idées `backfilled` sont exclues. Écris une thèse avant ton prochain trade. |

### Le fuseau horaire du broker

Toutes les dates du système vivent en **heure serveur** — celle du rapport MT5.

FundedNext est en **UTC+3**. Si tu changes de broker, corrige-le dans
`data/settings.json` :

```json
{ "server_utc_offset": 3 }
```

**Pourquoi ça compte** : le matcher rejette une thèse écrite *après* le ticket (une
thèse postérieure n'est pas une prédiction, c'est une justification). Si le fuseau
était faux, une thèse écrite deux heures avant ton entrée pourrait sembler
postérieure — et ton trade serait classé **hors-plan** à tort, sans un mot.

### Tout vérifier

```
python -m pytest tests/ -q
```

Doit afficher **`60 passed`**. Si un test échoue, quelque chose diverge — et ça se répare avant de faire confiance à un seul chiffre.

---

## Le mot de la fin

Cet outil n'a qu'un seul intérêt sur un tableur Excel : **il peut te contredire.**

Il ne peut le faire que si tu écris tes thèses **avant** d'entrer. Chaque thèse écrite après coup, chaque case cochée par complaisance, chaque `backfilled` déguisé en `computed` lui retire exactement ce qui le rend utile.

Ta prochaine thèse sera la première vraie donnée du système.
