# CLAUDE.md — Relevé

> Ce fichier est lu automatiquement par Claude Code au démarrage. Il contient
> tout ce qu'il faut savoir pour reprendre le projet sans le réexpliquer.
> Écrit pour Paul, étudiant et swing trader sur challenge prop firm.

---

## 1. Ce qu'est Relevé, en une phrase

Un journal de trading qui **peut te contredire** — et c'est sa seule raison
d'exister face à un tableur.

Il ne peut te contredire que si la prédiction (l'**idée**) est écrite **avant**
le trade. Tout le reste de l'architecture découle de ce principe.

Le cycle, dans l'ordre où il se vit :

```
  écrire l'idée (thèse, invalidation, captures)      -> armée
  entrer, déclarer le n° de ticket                    -> EN COURS
  le trade vit : stop déplacé, captures ajoutées      -> EN COURS
  sortir, déposer l'export CSV (rapproché par ticket) -> clôturée
  relire                                              -> revue, dans les stats
```

---

## 2. Le vocabulaire (à respecter absolument)

| Terme | Ce que c'est |
|---|---|
| **Idée** | L'unité de base. Un instrument, un sens, un stop, une conviction. Écrite avant d'entrer. C'est ce que l'utilisateur rédige. |
| **Thèse** | Un regroupement macro de plusieurs idées sur des instruments **différents** (« dollar fort » joué en short EURUSD *et* long USDJPY). Optionnelle. Dans le code : classe `Campaign`. |
| **Ticket** | Un ordre du broker. Plusieurs tickets peuvent appartenir à une seule idée (pyramidage). |
| **Trade ouvert** | Un ticket **déclaré à l'entrée**, pas encore clôturé. Classe `OpenTrade`. C'est lui qui fait vivre l'idée à l'état « en cours ». |
| **Capture** | Une image jointe à une idée ou à une thèse. Classe `Attachment`. Prise au moment du trade, c'est une donnée **pré-engagée**, pas une décoration. |

⚠️ Dans le CODE, la thèse macro s'appelle `Campaign` (historique). Dans
l'INTERFACE, on dit « thèse ». L'objet `Thesis` du code, lui, désigne le contenu
pré-trade d'une **idée** (instrument, stop, conviction) — pas la thèse macro. Ne
pas confondre les deux.

---

## 3. Contexte utilisateur (contraintes réelles, non négociables)

- **Paul** : étudiant, emploi du temps irrégulier, trade principalement sur
  **mobile (app MT5)**.
- **Challenge FundedNext, compte 100 000 $**, ID `14124899`.
- **Règles** : daily drawdown 5 %, **max drawdown 10 % FIXE base 100k** →
  plancher fatal à **90 000 $** (ne bouge jamais, même après gains).
- **Serveur FundedNext en UTC+3.** Les rapports MT5 sont horodatés en heure
  serveur.
- **Jamais de position sur le week-end** (swing) → une idée armée a **5 jours
  ouvrés** pour se réaliser, week-ends sautés.
- **Watchlist MT5 réelle** : EURUSD, GBPUSD, USDJPY, BTCUSD, NDX100, SPX500,
  US30, **USOUSD** (=USOIL), **UKOUSD** (=BRENT), XAUUSD.

---

## 4. Décisions d'architecture (le cœur — ne pas défaire sans raison)

Chacune vient d'un vrai problème rencontré sur les données de Paul, jamais d'une
supposition théorique.

**[A] L'idée précède le trade.** Une idée écrite après coup est marquée
`late` / `backfilled`, jamais rejetée — Paul trade le matin et journalise le
soir. Antériorité = drapeau souple, fenêtre 30 jours. (`core/matcher.py`)

**[B] L'unité d'analyse est l'idée, pas le ticket MT5.** MT5 compte 3 tickets là
où Paul prend 1 décision (pyramidage). Toutes les stats sont sur l'idée.

**[C] Le stop initial vient de l'idée, JAMAIS de MT5.** MT5 n'archive que le
DERNIER stop. Garde-fou `SUSPECT_BE` : un stop à moins de 0,15 % de l'entrée est
un breakeven → l'outil **refuse de calculer** plutôt que de sortir un +63R
absurde. Exception : si SL au placement == SL final (table Ordres MT5), le stop
est `PROVEN`, récupéré automatiquement.

**[D] R de l'idée = SOMME des risques de tous les tickets.** Chaque add porte son
propre stop. Le modèle initial « adds gratuits » était FAUX. Campagne BTC réelle
= **−0,38 R** (pas −1,18).

**[E] Deux R affichés côte à côte, jamais confondus :**
- **R engagé** (ponctuel) = `résultat / risque réel du trade` → mesure l'**edge**,
  neutralise le sizing. C'est la référence.
- **R compte** (normalisé) = `résultat / (risque_%_déclaré × 100k)` → mesure
  l'**impact sur le compte**. Sert au pilotage du drawdown. La base est le risque
  déclaré réel, PAS une base 1 % fictive.

**[F] Case « noyau au breakeven » à l'appariement.** Si le noyau était au BE quand
un add s'ouvre, son risque sort du calcul d'exposition simultanée. Sur BTC : 0,60 %
(mesuré) vs 1,11 % (majorant). Sans réponse → l'outil affiche un MAJORANT et le dit.

**[G] Drawdown mesuré transaction par transaction**, pas en clôture de journée —
c'est ainsi que FundedNext surveille. Le 09/07, le solde a touché 99 014 $ avant
de remonter : DD réel 0,99 % vs 0,59 % en clôture.

**[H bis] LE GARDE-FOU « RECONSTITUÉ » A ÉTÉ RETIRÉ, sur décision de Paul.**
Une idée écrite le soir pour un trade du matin, ou un ticket dont l'export ne
porte pas de SL (ordre au marché), ne dégradent plus rien : ni pastille
« thèse tardive », ni point creux « stop reconstitué », ni exclusion des
statistiques. Sur son usage réel, la règle marquait la MAJORITÉ du journal — un
avertissement permanent ne distingue plus rien. `Idea.risk_source` ne renvoie
plus que COMPUTED ou UNKNOWN (aucun stop du tout = R incalculable, ce qui reste
mécaniquement vrai). Le drapeau `late` subsiste pour l'appariement, les
événements `idea_marked_late` et les évidences `MEMORY` se relisent — sans effet.
La description [H] ci-dessous décrit l'ancien fonctionnement, gardée pour
comprendre pourquoi il existait.

**[H ter] Le filet du stop vaut pour le NOYAU, jamais pour un ADD.**

    ticket initial : saisie manuelle → stop de l'idée → broker
    renforcement   : saisie manuelle → broker → RIEN (on demande)

Le noyau prend le stop de l'idée parce qu'il a été écrit avant d'entrer, et
parce que le broker n'archive que le DERNIER stop — celui d'un trade passé au
BE vaut 9 points et produirait un +63 R.

Un renforcement, non : **il peut être pris plus serré que le noyau** (décision
de Paul, cas fréquent chez lui). Le faire hériter du stop de l'idée
surestimerait son risque et sous-estimerait le R, en silence. Tant qu'il
manque, le R de l'idée reste incalculable et l'outil le réclame — à
l'appariement (champ pré-rempli avec le SL de l'export s'il existe) puis dans le
détail. Base vraie plutôt que base plausible.

⚠️ En implémentant ce filet j'avais d'abord inversé l'ordre par inadvertance :
les R changeaient en silence (USOUSD 1,02 → 1,83). Des tests figent désormais
chaque priorité.

**[H quater] La case « noyau au breakeven » RESTE, et c'est vital.** Aucun
broker n'archive l'heure des déplacements de stop, et sur mobile ce journal
n'existe pas : cette case est la seule source. L'écart n'est pas cosmétique —
campagne BTC réelle : 1,11 % d'exposition simultanée si le noyau risquait
encore, 0,60 % s'il était sécurisé. Sans réponse, l'outil affiche un MAJORANT et
l'écrit : il montre pire que la réalité, jamais mieux. C'est la seule direction
d'erreur acceptable sur une métrique que la prop firm surveille.

**[H] Traçabilité du stop = pré-engagé vs reconstitué** (PAS auto vs manuel).
Une capture d'écran du ticket est pré-engagée (`capture`), horodatée par l'image
→ ne dégrade rien, au même niveau qu'un champ MT5. Un stop de mémoire (`memoire`)
dégrade l'idée entière en `backfilled`. La fiabilité d'une idée = son maillon le
plus faible.

**[I] Alerte de survie TOUJOURS globale, stats mensuelles.** Le plancher 90 000 $
est absolu, il ne se remet pas à zéro chaque mois. La marge avant échec se calcule
sur tout l'historique même en vue mensuelle — sinon l'outil dirait « tu es large »
alors qu'un mois précédent t'a rapproché du plancher. (`core/challenge.py`)

**[J] Un trade appartient au mois de sa CLÔTURE.** Le mois est une lentille posée
à la lecture sur le journal, pas un stockage séparé. Un seul `events.jsonl`.

**[K] Abandon = marqué, jamais effacé.** Le journal est append-only. Une idée ou
une thèse abandonnée reste, pour permettre un jour la métrique « mes renoncements
étaient-ils justifiés ? ». Abandonner une thèse libère ses idées (elles
redeviennent autonomes).

**[L] Review d'abandon : « ai-je eu l'occasion », pas « avais-je raison ».**
Setup absent = non-événement. Hésitation devant un setup valide = l'information
qui compte. (`MissedOutcome`, `MissedReview`)

**[M] Symboles : menu déroulant, jamais de saisie libre.** Paul écrit « NASDAQ »,
le broker écrit « NDX100 » → l'idée partait en hors-plan à tort. Le registre
apprend tout symbole importé (le broker fait foi). (`core/symbols.py`)

**[N] LE TRADE VIT DANS L'OUTIL ENTRE L'ENTRÉE ET LA SORTIE.** Un rapport de
broker ne contient que des trades CLÔTURÉS : tant que la position vivait, elle
n'existait nulle part, l'idée restait « armée » et le stop réellement placé était
perdu au premier breakeven. En déclarant le ticket à l'entrée (30 s sur mobile),
l'idée passe **en cours**, le stop réel est enregistré avant que le broker ne
l'écrase, et le NUMÉRO DE TICKET devient la clé de clôture. (`OpenTrade`)

**[O] Le rapprochement se fait par NUMÉRO DE TICKET, jamais par ressemblance.**
Comparer symbole + heure + prix, c'est deviner ; deux entrées à 30 secondes
d'écart et l'heuristique se trompe. Le ticket sort du terminal, il est unique.
Conséquence gratuite : l'import est idempotent par construction.
(`core/csvimport.py`) Il n'existe AUCUN événement `trade_closed` : la clôture
**est** l'arrivée de la position. Rien à synchroniser, donc rien à
désynchroniser.

**[P] Les images vivent sur le disque, pas dans le journal.**
`data/captures/<owner>/<id>.png`, le JSONL ne stocke que le chemin. Une image en
base64 rendrait `events.jsonl` impraticable à la main — or c'est lui qui doit
survivre dix ans. Retirer une capture la **marque**, le fichier reste.
(`core/captures.py`)

**[Q] Les règles de la prop firm sont paramétrables, le plancher ne l'est pas.**
Elles sont contractuelles et varient d'une firme à l'autre : les coder en dur
produisait un chiffre faux dès le second compte. Elles vivent dans
`data/settings.json` par compte. (`core/prop.py`) La marge de survie de
`challenge.py`, elle, reste globale et absolue — les deux modules répondent à
deux questions différentes, voir l'en-tête de `prop.py`.

**[S] Le journal ne vit JAMAIS à côté du programme.** `core/paths.py` le place
dans `%LOCALAPPDATA%\Releve\data` dès que l'outil tourne en `.exe`. Deux raisons
non négociables : un programme dans `Program Files` n'a pas le droit d'écrire à
côté de lui, et un exe « un seul fichier » se décompresse dans un dossier
TEMPORAIRE effacé à la fermeture — le journal serait perdu à chaque session.
`RELEVE_DATA` force le dossier (tests, clé USB).

**[T] La démonstration vit dans un fichier SÉPARÉ, et ce fichier est supprimé.**
`data/demo.jsonl`, jamais `events.jsonl`, chaque événement portant le drapeau
`demo`. Au premier import réel : on recopie dans le vrai journal ce que
l'utilisateur avait écrit LUI-MÊME, on `fsync`, PUIS on efface `demo.jsonl`.
Deux conséquences voulues — `events.jsonl` reste append-only (il n'a jamais rien
contenu de faux, donc rien à y supprimer), et le trade BTC de démonstration ne
survit dans **aucun** fichier. Le garder « au cas où » reviendrait à laisser dans
le dossier de données de quelqu'un un trade qui n'a jamais été le sien.
L'ordre — écrire, puis effacer — est la seule chose qui protège vraiment.
(`core/onboarding.py`)

**[V bis] LES COMMENTAIRES AUSSI SONT DISTRIBUÉS.** `core/` et `app/` sont
embarqués **en clair** dans l'exe (Streamlit exécute `app/main.py` comme un
script). Un numéro de compte laissé dans un commentaire d'architecture part donc
chez tout le monde — c'est arrivé, avec le vrai numéro de compte, dans six
fichiers. Les commentaires disent maintenant « le compte de référence ». Un test
(`test_aucun_identifiant_personnel_dans_le_code_embarque`) refuse toute suite de
8 chiffres ou plus dans le code distribué. `CLAUDE.md` et `tests/`, eux, ne sont
pas embarqués : ils peuvent rester explicites.

**[V] RIEN DE PERSONNEL DANS L'EXE.** La démonstration rejouait le vrai rapport
MT5 de Paul (compte `14124899`, ses trades) : pratique, mais toute personne
recevant l'exe repartait avec son historique de trading. Elle est désormais
FABRIQUÉE par du code (`seed_demo.py`, compte `DEMO-0001`, tickets inventés), et
`releve.spec` n'embarque ni `tests/` ni `data/`. Deux tests le vérifient — un sur
la recette, un sur le journal produit. Le vrai rapport reste dans `tests/` pour
le parser (le « test d'or » du P&L), il ne quitte jamais la machine de Paul.

**[W] Un ancien journal se reprend sans conversion.** Le format n'a jamais
changé, il a grandi : champ absent = valeur par défaut, type inconnu = ignoré
mais signalé. `core/migration.py` regarde le fichier, refuse ce qui n'est pas un
journal, sauvegarde l'existant, puis installe (remplacer ou ajouter sans doublon
strict). Il n'y a donc AUCUN script de migration à écrire ni à rejouer.

**[U] Aucun compte n'est supposé.** L'écran d'accueil demande capital et limites
avant le premier écran. « FundedNext, 100 000 $ » codé en dur donnait des jauges
fausses dès le second utilisateur — et une jauge fausse est pire qu'une jauge
absente.

**[AA] UN RENFORCEMENT S'OUVRE PENDANT QUE L'IDÉE VIT.** Critère objectif, pas
heuristique : un ticket n'est un « add » que s'il s'ouvre alors qu'un autre
ticket de l'idée est ENCORE OUVERT. Cas réel qui l'a imposé — un trade ouvert
jeudi, clôturé au BE vendredi matin, et un autre ouvert vendredi après-midi sur
le même instrument : le matcher proposait le second comme renforcement du
premier. Les deux paris additionnaient leurs risques, le R devenait faux, et la
conviction déclarée sur la seconde idée (3/5) disparaissait au profit de la
première (5/5). `Idea.tickets_disjoints` signale les cas DÉJÀ enregistrés, et le
détail propose de détacher — le journal étant append-only, on ajoute
l'annulation, on n'efface pas.

**[AB] Le calendrier découpe par TICKET, les statistiques par IDÉE.** Une sortie
partielle tombe au jour où elle a eu lieu, le solde au jour de la clôture
totale : c'est ce qui est réellement tombé sur le compte, et c'est ce jour-là
que la prop firm a regardé. Les métriques, elles, gardent l'idée comme unité —
deux sorties sur un même trade restent une seule décision.

**[AC] UN FRAGMENT DE NOYAU N'EST PAS UN ADD, Y COMPRIS À L'APPARIEMENT.** Une
sortie partielle scinde la position en deux lignes de même heure et de même prix
d'entrée, mais de tickets différents. Tu n'en as déclaré qu'un : l'autre arrive à
l'appariement. `matcher.Candidate.is_add = bool(idea.positions)` le présentait
comme un renforcement — carte « add », champ stop, et surtout case « noyau au
breakeven » COCHÉE PAR DÉFAUT. Un simple clic mettait le noyau à zéro dans le
calcul d'exposition simultanée : 120 affiché au lieu de 240, la seule direction
d'erreur interdite ([H quater]). Le matcher applique désormais le test des
métriques (`est_du_noyau` : même heure ET même prix qu'un ticket déjà rattaché) et
sort un `Candidate.kind = "fragment"` ; l'assistant le rattache alors en un clic,
sans stop ni case breakeven. Les deux couches — appariement et métriques —
disent enfin la même chose. Un vrai add (heure OU prix différent) reste un add.

**[AD] JUSTESSE ≠ P&L, ET LES RENONCEMENTS SE MESURENT.** Trois taux au tableau
de bord (`metrics.CorrectnessRate`), tous « le marché t'a-t-il donné raison »,
indépendants du gain : idées exécutées correctes (`ideas_correct_rate`, via
`Review.thesis_outcome`), idées abandonnées justes (`abandoned_ideas_correct_rate`,
via `MissedReview.would_have_won`), thèses abandonnées justes
(`abandoned_theses_correct_rate`, via `Campaign.abandon_correct`). Les deux
derniers jugent les RENONCEMENTS — abandonner une bonne idée coûte, abandonner
une mauvaise protège. La review d'abandon est réduite à une question (« la thèse
était-elle correcte ? »), proposée à 5 jours ouvrés écoulés comme pour une idée
armée. Un verdict indécis (None) ne compte pas dans le taux.

**[X] L'UNITÉ D'ANALYSE EST LA DÉCISION, PAS L'IDÉE.** Par défaut, une thèse
macro compte pour UNE unité, quel que soit le nombre de jambes : « dollar fort »
joué sur trois instruments est UN pari. Le compter trois fois triple
mécaniquement l'échantillon et fait passer une conviction pour trois
confirmations. Une idée sans thèse compte pour elle-même. Le mode « par idée »
existe (juger l'exécution instrument par instrument), il est ANNONCÉ à l'écran
dans les deux sens. Tout part de `metrics.analysis_rows()` — espérance, matrice,
courbe et calendrier — donc changer de mode change tout d'un bloc, sans qu'un
écran puisse rester en désaccord avec un autre. (`metrics.Unit`)

**[Y] Sharpe et Sortino ne dépendent plus du broker.** Sans colonne « solde »
dans le CSV, les rendements sont reconstitués depuis les clôtures
(`daily_returns_from_rows`), et l'écran DIT laquelle des deux sources il a
utilisée. Un chiffre absent parce qu'un fichier n'avait pas la bonne colonne
n'aidait personne ; un chiffre dont on ignore la provenance serait pire.

**[Z] Les tests ne touchent JAMAIS aux vraies données.** `tests/conftest.py`
détourne `RELEVE_DATA` vers un dossier temporaire pour toute la session. Sans
lui, un test de l'interface d'import lisait `settings.json` dans le vrai dossier,
faisait sortir du mode démonstration et supprimait `demo.jsonl` — et
`Construire l'exe.bat` lance la suite avant CHAQUE construction. Fabriquer un
exécutable ne doit rien changer au journal de celui qui le fabrique.

**[R] Décision × résultat : un quadrant par trade, dès la review.**
maîtrise / chance / erreur / aléa OK. Distincte de la matrice thèse × exécution
(qui agrège et demande un échantillon). Le quadrant qui compte est **chance** :
un mauvais process qui a payé est celui qu'on répète. Sans review, le quadrant
reste `PENDING` — l'outil n'invente pas le process qu'il n'a pas mesuré.

---

## 5. Stack technique

- **Python 3.11+**, **Streamlit** (UI), **Plotly** (graphes), **BeautifulSoup4 +
  lxml** (parsing HTML MT5), **pytest**.
- **Decimal partout, jamais float** (montants financiers).
- Rapports MT5 en **UTF-16LE**, cellules `<td class="hidden">` à jeter
  (raison pour laquelle on n'utilise pas `pandas.read_html`), séparateurs NBSP.

---

## 6. Structure du code (~7000 lignes, 238 tests)

```
core/            NOYAU pur Python, zéro dépendance UI, tout est testé
  models.py      dataclasses : Idea, Thesis, Position, OpenTrade, Attachment,
                 Campaign, Review, MissedReview + enums (IdeaStatus, RiskSource,
                 StopEvidence, MissedOutcome, RiskBasis, Quadrant, CaptureKind).
                 Toute la logique métier est ici.
  parser.py      lit le rapport HTML MT5 (UTF-16, cellules cachées, NBSP)
  csvimport.py   lit un CSV MT4/MT5/cTrader/générique, rapproche PAR TICKET.
                 Dialectes de nombres et de dates, mapping manuel de secours.
  migration.py   reprend un journal d'une version précédente : inspection,
                 refus de ce qui n'est pas un journal, sauvegarde, install
  onboarding.py  premier lancement, mode démonstration et sa disparition
  captures.py    écriture des images sur disque (data/captures/), formats, taille
  store.py       journal JSONL append-only (data/events.jsonl). Idempotent.
  metrics.py     expectancy, Sharpe/Sortino (annualisés, avec IC), drawdown,
                 matrice thèse×exécution, matrice décision×résultat, calibration
  matcher.py     propose idée↔ticket pour les tickets NON déclarés. Antériorité
                 = drapeau `late`
  specs.py       valeur du point auto-déduite (BTCUSD=1, NDX100=10, USOUSD=100…)
  clock.py       référentiel temporel UNIQUE (heure serveur UTC+3, sans fuseau)
  challenge.py   périodes mensuelles, ChallengeState (survie globale)
  prop.py        règles prop firm PARAMÉTRABLES par compte + évaluation
  settings.py    lecture/écriture de data/settings.json
  symbols.py     registre des symboles + watchlist, apprentissage à l'import

app/             INTERFACE Streamlit
  main.py        routeur, rail, compte actif, navigation différée (voir §8)
  theme.py       palette WCAG + CSS. base="dark" FORCÉ (voir §8)
  ui.py          helpers d'affichage (kpi, gauge, banner, galerie, fmt_*)
  views/
    dashboard.py 4 KPI → courbe de R cumulé + décision×résultat → trades en
                 cours → challenge → récents → thèses → ratios → histogramme →
                 Analyse (verrouillée < 30 idées revues)
    ideas.py     LE JOURNAL : liste filtrable, écriture d'une idée, captures,
                 déclaration du ticket à l'ouverture, review d'abandon
    detail.py    une idée : trade en cours, thèse, captures, quadrant, risque,
                 tickets, review
    importer.py  import CSV (rapprochement par ticket) ou HTML + appariement
    compliance.py les règles du challenge, jauges et verdicts
    settings.py  comptes et règles, watchlist, horloge, sauvegarde
    campaigns.py thèses macro : créer, voir le R agrégé, captures, abandonner

tests/           238 tests — test_core, test_integration, test_render,
                 test_contrast, test_csvimport, test_cycle, test_prop
seed_demo.py     fabrique le journal de démo — 100 % INVENTÉ (compte DEMO-0001,
                 tickets fictifs). Ne rejoue plus aucun rapport réel : voir [V]
```

---

## 7. Le journal de données (`data/events.jsonl`)

**C'est le seul actif irremplaçable.** Le code se régénère, pas les thèses
annotées année après année. Format JSON brut exprès : lisible dans 10 ans avec
n'importe quel langage.

- Une ligne = un événement, **jamais réécrit** (append-only).
- Événements : `thesis_created`, `thesis_updated`, `position_imported`,
  `position_linked`, `add_secured`, `ticket_stop_set`, `review_completed`,
  `campaign_created`, `idea_attached`, `idea_marked_late`, `idea_missed`,
  `campaign_abandoned`, `idea_abandoned`, `trade_opened`, `trade_updated`,
  `trade_cancelled`, `capture_added`, `capture_removed`, etc.
- **Pas de `trade_closed`** : la clôture EST l'arrivée de la position (voir [O]).
- Les images ne sont PAS dans le journal, seulement leur chemin (voir [P]).
  Sauvegarder `data/` entier = le journal **et** les captures.
- **Idempotent** : réimporter le même rapport n'ajoute rien.
- Toute évolution du modèle doit rester **rétrocompatible en lecture** (champs
  absents = valeur par défaut). Un test le vérifie.

⚠️ **Réflexe à marteler à Paul : sauvegarder `events.jsonl` après chaque
session.** Il l'a déjà perdu une fois.

---

## 8. Pièges Streamlit déjà résolus (ne pas les réintroduire)

**Thème suivi du système.** Sans section `[theme]` dans `.streamlit/config.toml`,
Streamlit suit le thème du système et rend ses widgets dans une palette qui n'est
pas la nôtre. Le thème est **déclaré en dur** : `base="dark"` + les 4 couleurs =
palette du `theme.py`. Un test vérifie la correspondance.

**Boutons illisibles.** La règle : le fond d'un bouton et la couleur de son texte
sont TOUJOURS déclarés dans la MÊME règle CSS, jamais l'un sans l'autre, et un
test mesure le contraste des deux couples (secondaire encre/carte, primaire
fond-profond/ambre). Inclut `-webkit-text-fill-color` (WebKit ignore `color`
sinon). `st.form_submit_button` rend un `.stFormSubmitButton`, PAS un
`.stButton` — piège classique. Un test liste tous les widgets utilisés et exige
une règle CSS pour chacun.

**Espacement des pastilles et des tableaux.** Une pastille sans marge BASSE se
colle à la ligne du dessus dès qu'une liste passe à deux lignes ; un nombre sans
`white-space: nowrap` se coupe en deux (« 63 / 791.42 ») et se lit comme deux
nombres. D'où `.chips` (flex + gap) pour les groupes, `nowrap` sur les colonnes
de valeurs, et 2 étiquettes maximum par ligne de journal.

**Libellés de `number_input` sur colonnes étroites.** Le widget porte ses
boutons −/+ à droite ET une infobulle « ? » à gauche. Sur trois colonnes, un
libellé qui passe à la ligne décale ses boutons d'un demi-champ et l'infobulle
chevauche le libellé voisin. Deux colonnes, libellés courts, explications en
note sous le champ.

**Erreur `removeChild`.** Deux causes : (1) double `st.rerun()` — après un
`on_select="rerun"` de Plotly, ne PAS rappeler rerun ; utiliser `pending_nav`
consommé en tête de `main.py`. (2) boucle de `st.markdown` dont la longueur varie
→ fusionner en UN seul `st.markdown`.

**CSS.** Streamlit recolore ses éléments internes après notre CSS → nombreux
`!important` sur `section[data-testid="stMain"]` et `.card *`. Le rail (sidebar)
est volontairement sombre, ciblé séparément.

---

## 9. Lanceurs Windows et distribution

**Pour Paul, depuis les sources :**

- `Releve.bat` — premier lancement : crée le venv, installe, lance les tests
  (affiche `238 passed`), ouvre le navigateur. Détecte une instance déjà lancée.
- `Releve.vbs` — lancements suivants, fenêtre réduite (PAS cachée : un échec
  invisible est pire qu'un échec visible).
- `Releve - acces telephone.bat` — expose l'app sur le réseau local (Paul écrit
  ses idées depuis son mobile). Aucun cloud.
- `Arreter Releve.bat` — libère le port 8501.

**Pour quelqu'un d'autre — le `.exe` :**

- `launcher.py` — la fenêtre Tkinter. Prépare, lance le serveur, ouvre le
  navigateur, et **Terminer** arrête tout. Tkinter est choisi exprès : livré
  avec Python, donc zéro dépendance pour l'écran qui gère les dépendances.
- `releve.spec` — la recette PyInstaller.
- `Construire l'exe.bat` — venv + dépendances + **tests** + construction. Il
  refuse de construire si un test échoue : on ne distribue pas un programme dont
  on sait qu'il ment.
- Résultat : `dist\Releve\` (~300 Mo, exe de 33 Mo). À zipper et envoyer. Rien à
  installer chez la personne, aucune connexion nécessaire.

⚠️ **Quatre pièges du mode figé, tous rencontrés pour de vrai** (chacun a son
test dans `tests/test_launcher.py`) :

1. Le serveur tourne dans un **processus enfant**, pas un fil : Streamlit
   installe des gestionnaires de signaux, et `signal.signal()` n'est autorisé
   que sur le fil principal. Sur un fil, le serveur démarre, affiche son
   adresse, puis meurt.
2. `global.developmentMode` doit être coupé **avant** `server.port`, sinon
   Streamlit refuse. Seul `bootstrap.load_config_options` garantit l'ordre.
3. `os.chdir(racine())` avant de servir : Streamlit cherche
   `.streamlit/config.toml` dans le dossier COURANT. Sans ça, lancé depuis un
   raccourci, le thème repasse sur celui du système.
4. Mode **un dossier**, pas un fichier unique : un exe unique se décompresse
   entièrement à chaque lancement (~300 Mo, 15-30 s d'attente à chaque fois).

---

## 10. Règles de collaboration (comment Paul veut qu'on travaille)

- **Répondre en français.**
- **Pratique > esthétique.** Paul veut de l'usage, pas du beau.
- **Tester avant de livrer.** Toujours faire tourner `pytest` et vérifier sur le
  vrai journal de Paul avant de dire « c'est fait ».
- **Être honnête sur les limites de l'outil** : pas de flottant intraday, pas
  d'historique de prix, données autodéclaratives biaisées. Le dire clairement.
- **Expliquer les décisions**, surtout quand on refuse une demande (ex. refuser
  le vrai `DELETE`, refuser de retirer l'antériorité).
- **Livrer SOIT l'archive complète, SOIT les fichiers isolés — jamais les deux**
  (source de confusion passée).
- Ne jamais dégrader la rigueur des données pour faire plaisir.

---

## 11. État actuel & pistes ouvertes

**Fait :** noyau complet, 238 tests, tableau de bord mensuel, thèses macro,
abandon idée+thèse, review d'abandon (5 j ouvrés), Sharpe/Sortino/DD au dashboard,
registre de symboles, tous les bugs CSS/rerun résolus.

**Fait en v2 (le trade qui vit) :**
- déclaration du ticket à l'ouverture → état « en cours », stop réel enregistré
- import CSV (MT4/MT5/cTrader/générique) rapproché **par numéro de ticket**,
  mapping manuel de secours, clôture automatique du trade déclaré
- captures multiples sur une idée ET sur une thèse macro (fichiers sur disque)
- page **Compliance prop** : règles paramétrables par compte, jauges, verdicts
- page **Réglages** : comptes et règles, watchlist, horloge, sauvegarde
- matrice **décision × résultat** (maîtrise / chance / erreur / aléa OK)
- front sombre d'après les maquettes, palette re-mesurée (WCAG)

**Fait en v3 (distribuable) :**
- `.exe` autonome : Python + Streamlit + l'app embarqués, rien à installer chez
  la personne, aucune connexion nécessaire
- fenêtre de lancement Tkinter (préparation, progression, ouverture du
  navigateur, bouton **Terminer** qui arrête le serveur)
- données dans le profil utilisateur, jamais à côté du programme
- écran de premier lancement : compte + « vierge ou démonstration »
- démonstration dans un fichier séparé, qui saute au premier import réel
- remise à zéro complète depuis Réglages (avec conservation de l'ancien journal)

**En attente / à valider avec Paul :**
- Le CSV de FundedNext contient-il une colonne « balance » ? Si non, le drawdown
  restera reconstitué depuis les clôtures tant qu'on n'importe pas le HTML —
  l'écran le dit, mais autant le savoir.
- Le flottant d'un trade en cours vient d'un cours saisi À LA MAIN. Si Paul ne
  le saisit jamais, la colonne restera vide : c'est assumé, pas un bug.
- L'exe n'est pas signé : Windows affichera « Windows a protégé votre
  ordinateur » au premier lancement chez chaque nouvelle personne. Seul un
  certificat payant supprime ce message ; le manuel explique le contournement.
- Si le processus PARENT est tué de force (gestionnaire des tâches), le serveur
  enfant survit et garde le port. `Terminer` et la croix gèrent le cas normal ;
  un Job Object Windows serait la parade complète, si ça se produit vraiment.
- Un ordre MT5 **au marché** avec SL rempli alimente-t-il la colonne SL de la
  table Ordres chez FundedNext ? À trancher avec un trade test + export. Détermine
  si la saisie manuelle du stop sera rare ou systématique.
- Corriger ses idées `USOIL → USOUSD` et `BRENT → UKOUSD` (le menu déroulant l'y
  force désormais).
- Apparier les tickets orphelins BTCUSD et NDX100 **avant** de les juger comme
  abandonnés (ce sont de vrais trades).
- Ticket USOUSD **+607,16 $** à rattacher.
- Alias de symboles (`NASDAQ→NDX100`) évoqués mais non implémentés (le registre +
  menu suffit pour l'instant).

---

## 12. Commande de vérification

```bash
python -m pytest tests/ -q     # doit afficher : 238 passed
```

Si un test échoue, quelque chose diverge — le réparer **avant** de faire confiance
à un seul chiffre affiché.
