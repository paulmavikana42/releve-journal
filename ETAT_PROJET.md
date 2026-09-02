# ÉTAT DU PROJET — Relevé

> Instantané **factuel** du code, vérifié fichier par fichier contre les sources
> le **25/08/2026**. Ce document prime sur toute doc antérieure (y compris
> `CLAUDE.md`, qui décrit l'intention de conception, pas toujours l'état réel).
> Chaque affirmation est vérifiable dans le code courant ; les points non
> vérifiés exhaustivement sont marqués « à vérifier ».

Résumé chiffré (mesuré le 01/09, après nettoyages `clock.py` + `metrics.py` +
unification des images) :
- `core/` : 17 fichiers, **5 344** lignes. `app/` : 14 fichiers, **5 694** lignes
  (dont `app/views/` = 4 206). Total core+app ≈ **11 038** lignes.
- Tests : **254 passent** (211 fonctions `test_*` + les cas `@pytest.mark.parametrize`).
- Migration Supabase : **rien commencé** (0 référence dans le code).

⚠️ Divergence avec `CLAUDE.md` §6/§11/§12 : il annonce « ~7000 lignes, 238 tests ».
Réel : **~11 038 lignes**, **254 tests**.

---

## 1. INVENTAIRE DES FICHIERS

### `core/` — noyau pur Python (aucune dépendance UI)

| Fichier | Lignes | Rôle réel (lu dans le code) | Dépendances internes |
|---|---:|---|---|
| `__init__.py` | 0 | paquet vide | — |
| `paths.py` | 99 | Où vivent les données : `%LOCALAPPDATA%\Releve\data` en `.exe`, `data/` en source ; `RELEVE_DATA` force le dossier. `is_frozen()`, `data_dir()`, `settings_path()`, `journal_path(demo)`. | (aucune) |
| `settings.py` | 56 | Lecture/écriture de `data/settings.json` : `read/write/get/set`, `path()` résolu à chaque appel. | `paths` |
| `clock.py` | 145 | Référentiel temporel unique (heure serveur UTC+3, naïve) + jours ouvrés (`business_days_between`, `review_due`, `business_days_left`). Doublons morts retirés le 25/08. | `settings` (import paresseux) |
| `symbols.py` | 72 | Registre de symboles + watchlist ; `learn()` apprend à l'import, `known()` pour le menu déroulant. Aucun alias (choix assumé). | `settings` |
| `captures.py` | 106 | Écriture des images sur disque `data/captures/<owner>/<id>.ext` : `save()`, `resolve()`, `read()`, `CaptureError`. | `clock`, `models` |
| `specs.py` | 131 | Valeur du point **apprise** depuis les trades (`SpecBook`, `SymbolSpec`, `snap()`), jamais une table en dur. | `models` |
| `models.py` | 1106 | Tout le domaine : enums + dataclasses + sérialisation. Voir §2. | `clock` |
| `matcher.py` | 210 | Propose (jamais décide) l'appariement position→idée : `Candidate`, `candidates()`, `best()`. Antériorité = drapeau `late`. | `models` |
| `csvimport.py` | 547 | Lit un CSV MT4/MT5/cTrader/générique, rapproche **par ticket** : `parse()`, `reconcile()`, `balance_deals()`, `CsvRow.to_position/to_open_trade`. | `models` |
| `parser.py` | 255 | Parse le rapport HTML MT5 (UTF-16, cellules cachées, NBSP) : `parse_report()`, `Report`, `num()`, `dt()`. | `models` |
| `migration.py` | 214 | Reprend un journal d'une version antérieure sans conversion : `inspect()`, `install()`, `sauvegarder()`, `MigrationError`. | `paths`, `settings` |
| `onboarding.py` | 196 | Premier lancement + mode démo et sa disparition : `configured()`, `demo_mode()`, `start_blank/start_demo`, `leave_demo()`, `reset_all()`. | `paths`, `settings` |
| `challenge.py` | 235 | Périodes mensuelles (lentille) + survie globale : `Period`, `ChallengeState`, `compute()`, `thesis_lines()`. | `models` |
| `prop.py` | 540 | Règles prop firm **paramétrables par compte** : `PropRules`, `accounts()`, `owner_uid()`, `belongs_to()`, `Equity`, `Compliance`, `evaluate()`/`equity_series()`. | `settings`, `models`, `clock` (paresseux) |
| `store.py` | 620 | Journal JSONL append-only + `load()` (rejoue les événements). Idempotent. Voir §3. | `clock`, `models` |
| `metrics.py` | 812 | Statistiques : expectancy, Sharpe/Sortino, drawdown, matrices, calibration, décision×résultat. Code mort retiré le 25/08 (voir §6.B). | `models` |

### `app/` — interface Streamlit

| Fichier | Lignes | Rôle réel | Dépendances internes |
|---|---:|---|---|
| `__init__.py` | 0 | paquet vide | — |
| `theme.py` | 630 | Palette WCAG + CSS (`base="dark"` forcé). Aucune logique. | (aucune) |
| `ui.py` | 303 | Helpers d'affichage : `kpi/stat/gauge/banner`, `fmt_money/fmt_r/fmt_price`, `set_currency()`, `data_uri()`, `chips/tags/quadrant_chip`. (`gallery`/`KIND_LABELS` retirés le 01/09.) | `core.models`, `theme`, `core.captures` (paresseux) |
| `blocks.py` | 187 | **NOUVEAU** — éditeur d'écriture par blocs (texte/image façon Notion) **partagé** thèse+idée : `init()`, `to_note()`, `editor()`, `render()`, `new_bid()`. | `core.captures`, `core.models`, `ui` |
| `main.py` | 368 | Routeur + rail + compte actif (mémorisé via `SET.last_account_uid`) + navigation différée + overlay fiche idée + cloisonnement par `uid`. | `core.specs/store/challenge/onboarding/paths/prop/settings`, `theme`, `ui`, `views.*` |
| `views/welcome.py` | 113 | Écran de premier lancement (compte + vierge/démo). | `core.onboarding/prop/store`, `theme`, `ui`, `.account_form` |
| `views/account_form.py` | 253 | Formulaire d'UN compte prop, partagé onboarding+réglages : `rules_form()`. Compte personnel → carte cadenassée (pas de widgets grisés). | `core.prop`, `ui` |
| `views/settings.py` | 257 | Comptes & règles, watchlist, horloge, sauvegarde, reprise/reset. Bouton « Enregistrer » par conteneur, suppression de compte. | `core.clock/migration/onboarding/paths/prop/symbols/store`, `theme`, `ui`, `.account_form` |
| `views/compliance.py` | 308 | Règles du challenge, jauges, verdicts ; écran verrouillé si compte personnel ; réutilise `_calendrier` du dashboard. | `core.prop/models`, `theme`, `ui`, `.dashboard` |
| `views/campaigns.py` | 309 | Thèses macro : liste + carte, menu 3 points (relire/modifier/abandonner), lecture read-only, **écriture par blocs** (`B.*`). | `core.models/store`, `blocks`, `theme`, `ui` |
| `views/ideas.py` | 566 | LE JOURNAL : liste en lignes natives + menu 3 points par idée, écriture d'idée (**blocs** + champ ticket), invite « idée incomplète ». | `core.clock/models/symbols/store`, `blocks`, `theme`, `ui` |
| `views/importer.py` | 662 | Import CSV/HTML, rapprochement par ticket, assistant d'appariement, garde-fou `_completer_tickets`. | `core.csvimport/matcher/onboarding/models/parser/symbols/store`, `theme`, `ui` |
| `views/detail.py` | 688 | Fiche d'une idée : thèse (dév. rendu par blocs, images comprises), trade en cours, risque, tickets, quadrant, review. (`_captures_block` retiré le 01/09 — un seul système d'images.) | `core.clock/models/store`, `blocks`, `theme`, `ui` |
| `views/dashboard.py` | 1050 | Tableau de bord : KPI, courbe R/%/argent, décision×résultat, calendrier, challenge, thèses, matrice, analyse. | `core.metrics/models/challenge`, `theme`, `ui` |

### Racine (hors distribution embarquée)

| Fichier | Lignes | Rôle |
|---|---:|---|
| `launcher.py` | 416 | Fenêtre Tkinter du `.exe` : prépare, lance le serveur (processus enfant), ouvre le navigateur, bouton Terminer. |
| `seed_demo.py` | 296 | Fabrique le journal de démo (100 % inventé, compte `DEMO-0001`). |
| `releve.spec` | — | Recette PyInstaller (n'embarque ni `data/` ni `tests/`). |

---

## 2. MODÈLE DE DONNÉES ACTUEL (`core/models.py`)

Sérialisation : `to_dict = asdict` (ligne 1105) ; encodage JSON via `_enc`/`_dec_hook`
(`Decimal → {"__dec__"}`, `datetime → {"__dt__"}`, `Enum → .value`).

### Enums (11)
`IdeaStatus` (brouillon/armee/en_cours/cloturee/revue/abandonnee), `Direction`
(buy/sell), `RiskSource` (computed/backfilled/unknown), `StopEvidence`
(capture/memoire), `StopProvenance` (prouve/deplace/non_verifie/suspect_breakeven/declare/aucun),
`RiskBasis` (somme/ticket_initial/max_simultane), `MissedOutcome`
(setup_absent/hesitation), `ThesisOutcome` (correcte/fausse/non_testee),
`ExitReason` (sl/tp/manual/unknown), `Quadrant` (maitrise/chance/erreur/alea_ok/en_attente),
`CaptureKind` (these/entree/gestion/sortie/autre).

Constantes : `BREAKEVEN_TOLERANCE = Decimal("0.0015")` (l.83), `GOOD_PROCESS_MIN = 4` (l.155).

⚠️ `CLAUDE.md` §6 liste 7 enums ; il y en a **11** (Direction, StopProvenance,
ThesisOutcome, ExitReason non listés).

### Dataclasses (champs exacts vérifiés)

**`Deal`** *(frozen)* — l.169. `deal_id, time, symbol, deal_type, entry, volume:Optional[Decimal], price:Optional[Decimal], order_id, commission:Decimal, fee:Decimal, swap:Decimal, profit:Decimal, balance:Decimal, comment=""`, `account_id=""`. Props : `is_trading`, `is_funding`.

**`Position`** *(frozen)* — l.200. `position_id, account_id, symbol, direction:Direction, volume:Decimal, open_time, open_price, close_time, close_price, commission, swap, profit_gross`, puis `sl_final=None, tp_final=None, sl_at_placement=None, exit_reason=ExitReason.UNKNOWN`. Props/méthodes clés : `uid` (=`account_id:position_id`), `pnl_net` (brut+commission+swap), `stop_provenance`, `stop_original`, `risk()`, `point_value` (rétro-calculée).

**`OpenTrade`** *(frozen)* — l.317. `ticket, symbol, direction, volume, open_time, open_price`, `account_id="", stop=None, take_profit=None, last_price=None, last_price_at=None, note=""`. `uid`=`account_id:ticket`. `risk()`, `floating_pnl()`.

**`Attachment`** *(frozen)* — l.381. `id, owner_type, owner_id, path`, `original_name="", kind=CaptureKind.OTHER, caption="", added_at=None, removed=False`.

**`Thesis`** — l.409. `instrument, direction`, `macro_theme="", catalyst="", macro_note=""`, **`blocks: list = []`** (l.425, éditeur par blocs), `setup="", timeframe="", technical_note=""`, `entry_planned=None, stop_initial=None, targets=[], risk_pct=None, thesis_kill_switch="", conviction=None, risk_source=RiskSource.COMPUTED`. Méthode `risk_per_lot()`.

**`Review`** — l.451. 5 bool (`entry_in_zone, size_conforme, stop_at_invalidation, stop_never_widened, exit_per_plan`), `thesis_outcome=UNTESTED, emotional_state="", lesson="", tags=[]`. Props `discipline_score` (somme des 5), `is_clean` (==5).

**`MissedReview`** — l.484. `setup_appeared=NO_SETUP, would_have_won=None, reason="", note=""`.

**`Idea`** — l.499. `id, created_at (heure serveur), thesis=None, review=None, status=DRAFT, position_uids=[], off_plan=False, label="", risk_basis=SUM, campaign_id=None, late_thesis=False, missed_review=None, account_id="", manual_stops={}, stop_evidence={}, secured_on_add={}`, + résolus au chargement (non persistés) : `positions=[], open_trades=[], attachments=[]`. ~30 méthodes/props (voir §3).

**`Campaign`** — l.970. `id, created_at, name="", macro_theme="", catalyst="", note=""`, **`blocks: list = []`** (l.1008), `conviction=None, kill_switch="", closed=False, abandoned=False, abandon_correct=None, account_id=""`, + résolus : `ideas=[], attachments=[]`. Props : `captures, executed_ideas, instruments, pnl_net, risk_total(), r_total(), r_weighted(), display_name`.

> Note : `Thesis.blocks` et `Campaign.blocks` **existent bien** ; `CLAUDE.md`
> (note MAJ 14/08) le mentionne — cohérent.

---

## 3. RÈGLES MÉTIER IMPLÉMENTÉES (fichier · fonction · comportement réel)

**Stop d'origine d'un ticket** — `Position.stop_provenance`/`stop_original` (models l.250-284).
Si `sl_at_placement == sl_final` → `PROVEN` (renvoie `sl_final`). Si différents → `MOVED` (renvoie `sl_at_placement`). Sans `sl_at_placement`, si `|sl_final-open|/open < 0.0015` → `SUSPECT_BE` → **renvoie None** (refus de calculer un +63 R absurde). Sinon `UNVERIFIED` → `sl_final`.

**Priorité du stop d'une idée** — `Idea.stop_for()` (models l.668-714). Ordre : (1) stop saisi à la main (`manual_stops`) ; (2) pour le **noyau et ses fragments**, le stop de l'idée ; (3-5) sinon le stop broker prouvé/déplacé/non-vérifié ; (6) rien pour un **add** sans stop propre (l'outil le réclame). Le stop de l'idée ne s'applique **jamais** à un add.

**Noyau vs fragment vs add** — `Idea.est_du_noyau()` (l.607), `adds` (l.627), `tickets_disjoints` (l.631). Un fragment = même heure ET même prix que l'`initial_position`. Un add = ni l'un ni l'autre. Un ticket qui ne chevauche aucun autre (`open_time` hors de tout `[open,close]`) est **signalé** comme disjoint (pas fusionné d'office).

**Risque de l'idée** — `Idea.risk_realized()` (l.798). Défaut `RiskBasis.SUM` = **somme** des risques de tous les tickets ; un seul ticket sans stop → **None** (total invalidé). `INITIAL_ONLY` = noyau seul ; `MAX_CONCURRENT` = pire exposition simultanée.

**Exposition simultanée** — `Idea.max_concurrent_risk()` (l.744). Balayage open/close ; un ticket fermé sort ; si `secured_on_add[uid]` vrai à l'ouverture d'un add, **tous les tickets déjà ouverts tombent à 0**. Un risque inconnu → **None**. `exposure_is_measured()` (l.789) : vrai seulement si **chaque** add porte une réponse breakeven, sinon l'affichage est un **majorant**.

**R calculable ?** — `Idea.risk_source` (l.870). `UNKNOWN` **uniquement** si pas de `stop_initial` du tout ; sinon `thesis.risk_source` (ne dégrade plus pour cause d'antériorité — décision [H bis]).

**Quadrant** — `Idea.quadrant` (l.892). `PENDING` sans exécution **ou** sans review. Sinon `discipline_score >= 4` × signe du P&L → maitrise/chance/erreur/alea_ok.

**Journal & rejeu** — `Store.load()` (store l.192-388). Rejoue **22** types d'événements (comptés depuis les 22 appels `append()` distincts de `store.py`) pour reconstruire idées/positions/deals/campagnes. Événements produits : `thesis_created, thesis_updated, trade_opened, trade_updated, trade_cancelled, capture_added, capture_removed, position_imported, deal_imported, position_linked, position_unlinked, add_secured, review_completed, campaign_created, campaign_updated, campaign_abandoned, idea_abandoned, idea_marked_late, idea_missed, idea_attached, idea_detached, ticket_stop_set`. **Aucun `trade_closed`** : la clôture EST l'arrivée de la position.

**Fermeture d'un trade déclaré par un import** — `Store.load()` (store l.332-388, modifié ce mois-ci). Un `OpenTrade` est considéré clôturé si son ticket a été importé ; le numéro de **compte** ne bloque que si c'en est un **vrai (numérique)** — un uid interne ou un champ vide laisse le **ticket** trancher (`tr.account_id.isdigit()`). La position clôturante est **rattachée à l'idée par le ticket** (`autolink`) même sans lien explicite → l'idée passe « clôturée » et devient relisible. `orphans()` (l.605) tient compte des positions résolues.

**Isolation par compte** — `prop.owner_uid()` (prop l.197). L'`uid` interne stable est la vraie clé ; le numéro broker (`account_id`) peut être vide/partagé. `app/main.py` filtre idées/thèses/deals via `_mine`.

**Mémoire du compte actif** — `app/main.py` l.114-135. Restaure `SET.last_account_uid` en début de session (par uid), réécrit uniquement si changement.

**Valeur du point** — `Position.point_value` (models l.298) et `core/specs.py` (`snap()`) : `pv = profit_brut/(volume×déplacement)`, arrondi « snappé ». Aucune table en dur.

**Fenêtre d'une idée armée** — `core/clock.py` : `REVIEW_WINDOW_BUSINESS_DAYS=5`, `review_due()`/`business_days_left()` sur jours ouvrés (via `business_days_between`, toujours ≥ 0).

**Survie challenge** — `core/challenge.py` (`ChallengeState`, `compute()`) : plancher absolu, marge globale même en vue mensuelle. Règles paramétrables : `core/prop.py` (`evaluate` → `Compliance`).

**Éditeur par blocs** — `app/blocks.py`. `init()` reprend `blocks` existants ou convertit `note`+`captures` en blocs ; `editor()` (hors `st.form`) gère paragraphes/images (widgets clés sur un `bid` stable), image redimensionnable en % (`height:auto`) ; `render()` = lecture seule. Images enregistrées via `CAP.save` sur disque, **sans** événement `capture_added` (le chemin vit dans le bloc).

---

## 4. COUVERTURE DE TESTS

`python -m pytest tests/` → **254 passed**. Fonctions `test_*` par fichier :
test_prop 31, test_core 28, test_analyse 26, test_cycle 25, test_onboarding 19,
test_contrast 18, test_csvimport 17, test_launcher 16, test_integration 15,
test_migration 11, test_render 5 (**211 fonctions** ; 254 après paramétrage).

**Bien couvert (comportement réel testé) :** tout `core/` — `models, store,
metrics, prop, challenge, csvimport, parser, matcher, migration, onboarding,
specs, symbols, clock, captures, paths, settings`. Plus `seed_demo`/`launcher`
(via test_launcher/test_onboarding).

**Couche `app/` — quasi non testée par automatisation.** Les seuls imports `app`
réels dans les tests (vérifié) :
- `app.theme` (test_contrast, test_render) — palette/CSS/contraste.
- `app.ui.fmt_money`, `app.ui.fmt_r` (test_contrast) — **ces deux helpers seulement**.
- `app.views.dashboard._bars, _calibration, _equity, _matrix, _couper_a_zero`
  (test_render, test_analyse) — quelques **constructeurs de figures purs**.
- `app.views.importer._appliquer` (test_cycle) — une passe d'import.

**AUCUN test n'exerce** (vérifié — honnête) :
- `app/main.py` (routage, overlay, mémoire compte, cloisonnement UI) ;
- `app/blocks.py` `editor()`/`render()`/`init()`/`to_note()` (seul `Campaign.blocks`/`Thesis.blocks` est couvert **indirectement** par le round-trip store dans test_cycle) ;
- `app/views/ideas.py` (formulaire, menu 3 points, déclaration ticket, invite « idée incomplète ») ;
- `app/views/detail.py` (`render`, `_thesis_block`, `_review_form`, `_risk_block`, etc.) ;
- `app/views/campaigns.py` (`_form`, `_lecture`, `_menu_these`) ;
- `app/views/compliance.py` (`render`) ;
- `app/views/settings.py` (`render`, formulaire compte, suppression) ;
- `app/views/account_form.py` (`rules_form`) — **0 import test** ;
- `app/views/welcome.py` — **0 import test** ;
- `app/ui.py` au-delà de `fmt_money`/`fmt_r` (qmark, data_uri, kpi, etc.).

En clair : la logique métier (core) est solide ; la logique **d'interface** est
validée **manuellement dans le navigateur**, pas par la suite. Un changement de
vue peut casser sans faire échouer un test.

---

## 5. ÉTAT DE LA MIGRATION SUPABASE

**Rien n'est fait dans le code.** `grep -riE "supabase|postgres|psycopg|sqlalchemy|st.login|oauth|oidc|vercel"` sur `core/ app/ *.py` → **0 résultat**.

- **Fait dans le code** : *néant*.
- **À moitié fait** : *néant*.
- **Seulement dans un prompt / doc, jamais exécuté** : le **plan** existe en
  documentation — `plan deploiement.md` (v2, 21/08, à la racine, non suivi par
  git) et la note mémoire `deploiement-en-ligne.md`. Décisions cadrées (auth A2
  Google natif Streamlit, table `events` append-only + RLS, Storage pour les
  captures, import JSONL depuis Réglages, export réservé aux bêta, gating
  `has_access`). **Aucune ligne de code, aucune infra, aucun schéma SQL créés.**

Le store reste **mono-backend JSONL** (`core/store.py`), pas encore enfichable.

---

## 6. DETTE ET INCOHÉRENCES CONNUES

**A. `core/clock.py` — définitions dupliquées → ✅ RÉSOLU (25/08/2026).**
Vérifié par nom exact : `business_days_between` avait un appelant vivant
(`review_due` ← `app/views/ideas.py`), `add_business_days` n'en avait aucun (son
cluster `thesis_deadline`/`is_expired` était mort). Nettoyage appliqué : doublon
mort de `business_days_between` retiré (une seule version conservée, celle qui
renvoie **0 si `end <= start`** — comportement documenté et **verrouillé par un
test**, `test_business_days_between_ne_renvoie_jamais_de_negatif`) ; cluster mort
`add_business_days`×2 + `thesis_deadline` + `is_expired` + `THESIS_WINDOW_DAYS`
supprimé intégralement. Plus aucun code mort sur ce point.

**B. `core/metrics.py` — code mort → ✅ RÉSOLU (25/08/2026).**
Vérifié par nom exact (core/ + app/ + tests/), puis supprimé : `plan_vs_offplan()`,
`PlanComparison`, `AddsAnalysis`, `adds_analysis()`, `size_conformity_stats()`
(896 → 812 lignes). Tests associés retirés : `test_hors_plan_vs_planifie`
(test_core) supprimé ; les assertions `adds_analysis` retirées de
`test_les_adds_ont_transforme_un_gagnant_en_perdant` (le reste, qui teste
`Idea.pnl_initial/pnl_adds`, est conservé) ; dans `test_trade_sans_these_est_hors_plan`
(test_integration) l'appel `plan_vs_offplan` remplacé par une assertion directe
équivalente. Suite : **254 passed**.
- Reste vivant (à ne pas confondre) : `daily_pnl_by_ticket()` est appelé en
  fallback par `daily_pnl_realise` (l.659) ; seul `daily_pnl()` n'a aucun appelant
  app — laissé en place, non signalé comme dette bloquante.

**C. Deux systèmes d'images sur une idée → ✅ UNIFIÉ (01/09/2026, sur « go » de Paul).**

Fait, appuyé sur des preuves reproductibles (vérifiées le 01/09) :
- **Sauvegarde préalable du journal** : `data/events.20260901-154213.bak` existe
  (`ls -la data/*.bak` → **156 385 octets**). Journal append-only, rien effacé.
- **Migration** : les **24** captures d'idée encore attachées repliées en blocs
  image dans `Thesis.blocks` via **10** événements `thesis_updated`. *Preuve
  reproductible* — compter dans `data/events.jsonl` les `thesis_updated` portant
  ≥ 1 bloc `type:"image"` → résultat **10 événements, 24 blocs image**.
- La capture de thèse macro + 3 captures d'idée faisaient partie des 4
  `capture_removed` → ignorées à juste titre (une capture retirée n'est pas
  ressuscitée).
- **Contrôles post-migration** : 24 blocs image sur les idées, **0** capture
  non-retirée sans bloc correspondant, migration **idempotente** (re-simulée →
  0 ajout), **0** fichier image introuvable sur disque.
- **Code** : `detail._captures_block` supprimé ; `ui.gallery`, `KIND_LABELS` et
  l'import `Attachment` de `ui.py`, devenus orphelins, retirés. Suite : **254 passed**.

**Résultat : un SEUL système d'images (les blocs).** Les anciens événements
`capture_added` restent dans le journal, **inertes** (réversible dans l'esprit —
on n'a rien effacé).

*Contexte historique (avant le 01/09, pour mémoire) :* deux modèles coexistaient
— `Thesis.blocks` (nouveau, sans `capture_added`) et `Idea.attachments` (ancien,
via `capture_added`, affiché en lecture seule par l'ex-`_captures_block`). Le
format `Attachment.path` = `"captures/<owner>/<id>.ext"` étant exactement celui
d'un bloc image, la conversion a été un 1:1 direct (path + caption → bloc image),
fichiers déjà sur disque.

**D. `Thesis.technical_note` en voie de dépréciation.** `ideas.py` écrit `technical_note=""` à l'enregistrement (l.256) et fond tout le texte dans `macro_note`/`blocks`. Mais `technical_note` est **encore lu** ailleurs : recherche du journal (ideas l.515), fallback d'affichage (detail `_thesis_block`, l.78). Champ à moitié retiré → incohérence douce à trancher.

**E. `Idea.has_reconstructed_stop`, `StopEvidence`, événement `idea_missed`, `MissedReview`, `Campaign.abandon_correct`** : conservés pour relire d'anciens journaux mais **ne dégradent plus rien / ne sont plus produits** (décisions [H bis], review d'abandon retirée). Legacy assumé, pas une erreur, mais du code qui n'a plus d'effet.

**F. Aucun marqueur `TODO/FIXME/HACK/XXX`** dans `core/` ni `app/` (vérifié). Le seul `_todo_block` est un nom de fonction UI (liste des tâches du dashboard), pas une dette.

**G. Fichiers de travail présents dans `data/`** (non distribués, gitignorés) : `events.jsonl` (156 Ko), deux `.bak`, `settings.json`, `captures/`. Sans incidence sur le code, mais le vrai journal de Paul vit là.

---

## 7. DÉPENDANCES ET VERSIONS

### `requirements.txt` (contenu exact)
```
beautifulsoup4>=4.12    # parsing MT5 (PAS pandas.read_html)
lxml>=5.0
streamlit>=1.35         # on utilise st.plotly_chart(on_select=...)
plotly>=5.20
pytest>=8.0             # dev
```
Pas de `pyproject.toml`, pas de `setup.py/cfg`.

### Versions réellement installées (`pip freeze`, venv courant)
| Paquet | Déclaré | Installé |
|---|---|---|
| streamlit | ≥1.35 | **1.59.1** |
| plotly | ≥5.20 | **6.9.0** |
| beautifulsoup4 | ≥4.12 | **4.15.0** |
| lxml | ≥5.0 | **6.1.1** |
| pytest | ≥8.0 | **9.1.1** |

Transitifs Streamlit présents : `altair 6.2.2`, `pandas 3.0.3`, `numpy 2.5.1`,
`pyarrow 25.0.0`, `python-dateutil 2.9.0.post0`.

⚠️ **PyInstaller n'est PAS installé dans ce venv** (`pip show pyinstaller` → absent).
`releve.spec` existe, mais construire le `.exe` depuis ce venv échouerait tant
que PyInstaller n'est pas installé — à vérifier avant toute construction.

Runtime Python de la suite de tests : **CPython 3.13** (visible dans les
`.pyc` : `cpython-313`). `requirements.txt` annonce « Python 3.11+ » ; l'exécution
réelle se fait en 3.13.

---

### Fiabilité de ce document
Vérifié par lecture directe : `models.py` (intégral), `store.py` (load + API),
`clock.py` (doublons), `prop.py` (champs `PropRules`), `metrics.py` (inventaire +
usages), `app/blocks.py`, `detail._thesis_block` (rendu des blocs), imports
internes de tous les fichiers, suite de tests exécutée. La section 6.C (migration
des images) est en plus adossée à des **preuves reproductibles** exécutées le
01/09 (existence du `.bak`, comptage des `thesis_updated` porteurs de blocs
image). **Non relus ligne à ligne** (rôle établi par docstring + signatures,
marqué « à vérifier » si un doute demeure) : le corps détaillé de `dashboard.py`,
`importer.py`, `parser.py`, `launcher.py`, `seed_demo.py`. Aucune affirmation de
ce document ne provient d'un souvenir non recoupé avec le code (base 25/08,
nettoyages et migration jusqu'au 01/09).
