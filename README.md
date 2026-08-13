# Relevé — journal de thèses

Un journal de trading qui peut te **contredire**. C'est la seule chose qui le
distingue d'un tableur.

---

## Démarrer

**Si tu n'as pas Python** — double-clique `Releve.exe` dans le dossier `Releve`.
Une fenêtre s'ouvre, prépare l'application, ouvre ton navigateur. Rien à
installer. Un bouton **Terminer** arrête tout.

**Depuis les sources :**

```bash
pip install -r requirements.txt
streamlit run app/main.py
```

Au premier lancement, l'application demande deux choses — ton compte, et si tu
veux démarrer avec un journal vierge ou avec des données de démonstration. Ça ne
se redemande jamais.

La démonstration est **entièrement fabriquée** (compte fictif, tickets fictifs)
et **supprimée** à ton premier import réel : aucun historique de trading ne
voyage dans le programme, et le tien ne se mélange jamais au décor.

**Tu viens d'une version précédente ?** `Réglages` → *Reprendre un journal
existant* → dépose ton `events.jsonl`. Rien à convertir : le format n'a jamais
changé, il a grandi.

**Pour fabriquer le `.exe`** (à donner à quelqu'un d'autre) : double-clique
`Construire l'exe.bat`. Il installe, lance les tests, et produit `dist\Releve\`.
Il refuse de construire si un test échoue.

Tout tourne en local. Aucune API, aucun cloud, aucun compte. Tu peux couper le Wi-Fi.

---

## Le principe

**L'idée précède le trade. Le broker vient la juger.**

```
tu écris l'idée   →  tu entres et tu       →  le trade VIT     →  tu déposes      →  tu relis
(thèse, invalidation, déclares ton ticket     dans l'outil        ton export CSV     (le juge)
 captures)           (n° du broker)           « en cours »        (rapproché par
                                                                   ce ticket)
```

Tout découle de là. Deux conséquences directes :

- Ton **stop initial** ne peut venir que de toi — jamais du broker, pour la
  raison expliquée plus bas.
- Le **numéro de ticket** que tu déclares à l'entrée est la clé qui clôturera ce
  trade précis à l'import : pas de doublon, pas d'appariement à la main, pas de
  ressaisie.

---

## Trois choses que ton fichier MT5 m'a apprises

### 1. Le stop archivé par MT5 est un mensonge

MT5 n'enregistre que ton **dernier** stop, pas le premier. Sur ta position
`251022835` :

| | |
|---|---|
| Entrée | 63 791.42 (sell) |
| Stop archivé par MT5 | 63 782.35 — soit **9 points au-dessus de l'entrée** |

C'est ton breakeven, pas ton stop d'origine. Calculer le R là-dessus donnerait
**+63,5 R** sur un trade qui a perdu de l'argent.

Et rien dans le fichier ne permet de distinguer un breakeven d'un scalp serré.
Ton pyramidage garantit que ce sera le cas majoritaire.

→ **Le stop initial est saisi dans la thèse. Il n'y a pas d'alternative technique.**

### 2. MT5 compte 3 trades là où tu en as fait 1

Tes trois tickets BTCUSD du 7–9 juillet : même sens, périodes qui se chevauchent.
Ce n'est pas trois trades, c'est **une thèse en trois tickets**.

| MT5 dit | La réalité |
|---|---|
| 3 trades, 33 % de réussite | 1 idée, 0 % de réussite |
| Sharpe −0,43 | non défini sur 3 points |
| Plus large gagnante : +397 | une jambe d'un trade perdant |

L'outil introduit donc une couche **Idée** au-dessus du ticket :

```
Thèse (1) → Idée (1) → Position MT5 (N) → Deal MT5 (N)
```

Toutes les statistiques se calculent sur l'**Idée**. Le détail des tickets ne sert
qu'à une question : *mes renforcements me rapportent-ils ?* Sur cette campagne :
ticket initial **+380 $**, renforcements **−969 $**.

### 3. Le drawdown se mesure après chaque transaction, pas en fin de journée

Le 9 juillet, ton solde touche 99 014.06 à 09h59, puis remonte à 99 411.26 à 10h51.

| | |
|---|---|
| DD vu en clôture de journée | 0,59 % |
| DD réellement touché | **0,99 %** ← ce que voit MT5, ce que voit FundedNext |

Une prop firm contrôle le drawdown **en continu**. Un outil qui affiche 0,59 %
pendant que la firme en voit 0,99 % te fait sauter un challenge en te croyant à
l'abri.

---

## Ce que l'outil mesure

### La matrice décision × résultat

Le verdict d'UN trade, dès sa review faite :

|  | Mauvais process | Bon process |
|---|---|---|
| **Gain** | chance ⚠ | maîtrise ✓ |
| **Perte** | erreur ✗ | aléa OK |

La case qui compte n'est pas « erreur », c'est **chance** : un mauvais process
qui a payé est celui qu'on répète. Sans review, aucun quadrant n'est attribué —
l'outil n'invente pas le process qu'il n'a pas mesuré.

### La matrice thèse × exécution

|  | Exécution propre (5/5) | Exécution dégradée (≤3/5) |
|---|---|---|
| **Thèse correcte** | ton vrai edge | ce que tu laisses sur la table |
| **Thèse fausse** | coût normal du business | zone rouge |

La seule question qui vaille : *ce qui me coûte de l'argent, c'est mon analyse,
ou c'est moi ?*

### Les autres

- **Plan vs hors-plan** — une position sans thèse préalable est, par construction,
  un trade que tu n'avais pas prévu. Comparé au reste.
- **Calibration de conviction** — tes idées à 5/5 surperforment-elles tes 2/5 ?
  Si non, tu sizes sur du bruit.
- **Conformité de taille** — risque réel / risque annoncé. Mesuré, pas auto-déclaré.
- **Qualité du pyramidage** — P&L des tickets initiaux vs P&L des renforcements.
- **Sharpe / Sortino** — annualisés depuis les rendements journaliers, **avec
  intervalle de confiance**. Sur 20 trades, l'IC couvre le zéro : le chiffre est
  affiché pour le voir grandir, pas pour en conclure quoi que ce soit.

### La discipline

Cinq critères objectifs, jamais un booléen :

1. Entrée dans la zone prévue
2. Taille conforme au risque défini
3. Stop placé à l'invalidation annoncée
4. Stop jamais élargi ni retiré
5. Sortie conforme au plan

Un booléen se note généreusement. Une checklist se vérifie.

---

## Traçabilité de la donnée

Chaque R porte sa provenance :

| | |
|---|---|
| ● `computed` | stop pré-engagé avant le trade → **fiable** |
| ○ `backfilled` | stop reconstitué de mémoire → indicatif, exclu par défaut |
| ○ `unknown` | pas de stop → R non calculable |

Les deux ne sont **jamais** mélangés en silence. C'est ce qu'un allocateur te
demandera de démontrer un jour.

---

## Architecture

```
core/            ← ton actif. Python pur, aucune dépendance à l'interface.
  models.py        Thesis · Idea · OpenTrade · Position · Deal · Review · Attachment
  parser.py        rapport MT5 HTML → objets
  csvimport.py     export CSV → objets, rapproché PAR NUMÉRO DE TICKET
  captures.py      les images, sur le disque
  specs.py         valeur du point, APPRISE depuis tes trades
  matcher.py       propose un rattachement, ne décide jamais
  metrics.py       R · expectancy · Sharpe · Sortino · DD · matrices
  prop.py          règles de la prop firm, paramétrables par compte
  store.py         journal JSONL append-only

app/             ← jetable, remplaçable. Streamlit + Plotly.
data/
  events.jsonl   ← LE fichier. Ton vrai patrimoine.
  captures/      ← tes images. À sauvegarder avec.
tests/           229 tests, tous à vérité connue
```

**`Decimal` partout, jamais de `float`** sur un prix ou un montant.

**On n'utilise pas `pandas.read_html`.** MT5 insère des `<td class="hidden">` qui
décalent silencieusement les colonnes : tu obtiendrais des chiffres faux sans la
moindre erreur. Le parser jette ces cellules explicitement.

**La valeur du point n'est jamais configurée.** Elle se rétro-calcule sur tes
trades clôturés (`profit / (volume × déplacement)`). BTCUSD → 1 lot = 1 BTC,
déduit sans aucune table. Ça marchera tout seul sur NAS100, US30, USDJPY.

---

## Le journal d'événements

`data/events.jsonl` — une ligne = un événement, jamais réécrit.

```json
{"ts":"…","type":"thesis_created","payload":{…}}
{"ts":"…","type":"capture_added","payload":{…}}
{"ts":"…","type":"trade_opened","payload":{…}}
{"ts":"…","type":"trade_updated","payload":{…}}
{"ts":"…","type":"position_imported","payload":{…}}
{"ts":"…","type":"position_linked","payload":{…}}
{"ts":"…","type":"review_completed","payload":{…}}
```

Il n'existe **aucun** événement `trade_closed` : la clôture *est* l'arrivée de la
position. Rien à synchroniser, donc rien à désynchroniser.

Les images ne sont pas dans le journal — seulement leur chemin. Un fichier JSONL
doit rester lisible au bloc-notes dans dix ans ; une image en base64 le rendrait
impraticable. **Sauvegarde le dossier `data/` entier** : le journal *et* les
captures.

- **Incorruptible** : une écriture interrompue perd au pire la dernière ligne.
- **Auditable** : si tu modifies une thèse *après* avoir vu le résultat,
  l'horodatage le sait.
- **Idempotent** : réimporte dix fois le même rapport, rien ne bouge.
- **Réparable au bloc-notes.**

Ton actif n'est ni le code ni la stack — le code se réécrit en un week-end. Ce
sont tes thèses annotées, année après année. C'est pour ça que le format est du
JSON brut plutôt qu'un SQLite ou un binaire : dans dix ans, avec n'importe quel
langage, ce fichier sera encore lisible.

---

## Tests

```bash
python -m pytest tests/ -q      # 229 passed
```

Chaque test a une vérité connue à l'avance. Le test d'or : la somme des P&L nets
doit reproduire **exactement** le « Profit Total Net » que MT5 affiche lui-même
(−588.74). S'il casse, le parser ment.

Certains tests ne sont là que pour documenter un piège, et empêcher qu'on le
réintroduise :

- `test_le_stop_de_mt5_produirait_un_R_absurde` — vérifie que la mauvaise
  méthode donne bien +63 R.
- `test_la_virgule_a_trois_chiffres_est_un_separateur_de_milliers` — « 1,234 »
  vaut mille deux cent trente-quatre, « 1,50 » vaut un et demi. Se tromper ici
  multiplie un volume par cent, sans lever la moindre erreur.
- `test_la_perte_du_jour_se_mesure_sur_la_base_du_JOUR` — 4 000 $ perdus sur un
  compte tombé à 95 000 $ font 4,21 %, pas 4,00 %. C'est ce 0,21 % qui fait
  sauter un challenge.
- `test_le_seuil_de_4_exigerait_un_gain_blanc` — la démonstration écrite de
  pourquoi un seuil de contraste daltonien de 4:1 est inatteignable sur fond
  sombre, pour qu'on ne le « répare » pas un jour en cassant la lisibilité.
