"""
Identité visuelle : « Relevé », version sombre.

Le monde du sujet, c'est le terminal la nuit et le ticket d'ordre : des chiffres
alignés en chasse fixe sur un fond profond, un seul accent ambre pour dire où
regarder. Les titres sont en serif — c'est un journal, pas un tableau de bord
d'usine.

------------------------------------------------------------------------------
CONTRASTES — mesurés (WCAG 2.1), pas estimés. Seuil 4.5 texte, 3.0 interface.

                 /fond    /carte   requis
    INK          16.19    14.88     4.5     OK
    MUTED         7.39     6.79     4.5     OK
    GAIN         10.55     9.68     4.5     OK
    LOSS          7.52     6.90     4.5     OK
    SIGNAL        8.35     7.66     4.5     OK
    WARN          9.87     9.06     4.5     OK
    ACCENT        9.41     8.65     4.5     OK
    RULE          3.81     3.51     3.0     OK   (bordures d'éléments actifs)

RULE_SOFT (1.42 / 1.30) ne vise PAS le seuil de 3.0, et c'est délibéré :
WCAG 1.4.11 couvre les composants d'interface — un bouton, un champ — pas les
filets décoratifs entre deux lignes d'un tableau. Un séparateur interne à 3:1
sur fond sombre produit une grille de barreaux qui hurle plus fort que les
chiffres. Les bordures qui doivent être vues (boutons, champs, menus) utilisent
RULE et franchissent le seuil.

DALTONISME — le seuil de 4.0 de la version claire est MATHÉMATIQUEMENT
INATTEIGNABLE sur fond sombre, et le constater vaut mieux que le contourner :
sur ce fond, une couleur lisible à 4.5:1 a une luminance ≥ 0.224 ; deux couleurs
au-dessus de ce plancher ne peuvent pas différer de plus de (1.05 / 0.274) =
3.84:1, et encore, seulement si l'une est blanc pur. Le meilleur couple
atteignable est 2.59:1 (gain vert clair / perte corail clair), et c'est celui
retenu. La compensation n'est pas cosmétique : le signe (+/−) est TOUJOURS
imprimé, la barre se place au-dessus ou en dessous du zéro, et la discipline
passe par la texture. Retirer toutes les couleurs ne fait perdre aucune donnée —
un test le vérifie.

------------------------------------------------------------------------------
VERROU ANTI-STREAMLIT. Streamlit recolore ses éléments internes APRÈS notre CSS
(le <p> d'un bouton, les headings, les labels). Le bloc en fin de feuille force
la couleur sur ces enfants, en zone principale uniquement (le rail garde la
sienne). Le thème est en outre déclaré en dur dans .streamlit/config.toml :
sans ça, Streamlit suit le thème du système et rend ses widgets à contre-sens.
------------------------------------------------------------------------------
"""

# ------------------------------------------------------------------- palette

PAPER = "#0B1220"      # le fond : bleu-graphite très profond
CARD = "#111B2E"       # la carte : un cran au-dessus, jamais un aplat noir
CARD_HI = "#16213A"    # survol / ligne active
INK = "#E9EFF7"        # texte principal
MUTED = "#93A4BD"      # texte secondaire — le plus fréquent, donc le plus soigné
RULE = "#617289"       # bordures d'éléments ACTIFS (boutons, champs) — 3.0 franchi
RULE_SOFT = "#22304A"  # filets décoratifs (cartes, lignes de tableau)

GAIN = "#4FE3A6"       # vert menthe
LOSS = "#FF8A7C"       # corail — écart de luminance maximal avec le gain
SIGNAL = "#8AA9FF"     # indigo clair : en attente, aléa maîtrisé, sélection
WARN = "#E9B44C"       # ocre : hors-plan, données reconstituées, alerte
ACCENT = "#F5A83C"     # l'ambre de marque : nav active, primaire, filets de titre
ACCENT_INK = "#0B1220" # texte posé SUR l'ambre (9.41:1)

GAIN_SOFT = "#4FE3A61F"
LOSS_SOFT = "#FF8A7C1F"
SIGNAL_SOFT = "#8AA9FF1C"
WARN_SOFT = "#E9B44C1C"
ACCENT_SOFT = "#F5A83C1C"

# --- le rail de navigation ---
# Sur fond clair, le rail devait TRANCHER (il était sombre sur du papier). Ici
# tout est sombre : il se distingue par un cran de luminance et un filet, pas
# par un contraste violent qui découperait l'écran en deux.
RAIL = "#0E1727"
RAIL_TEXT = "#E9EFF7"
RAIL_MUTED = "#8496AF"
RAIL_RULE = "#22304A"
RAIL_GAIN = GAIN
RAIL_LOSS = LOSS
RAIL_SIGNAL = SIGNAL
RAIL_WARN = WARN

FONT_UI = "'Space Grotesk', system-ui, -apple-system, sans-serif"
FONT_MONO = "'JetBrains Mono', ui-monospace, 'Cascadia Mono', monospace"
FONT_TITLE = "'Newsreader', 'Iowan Old Style', Georgia, 'Times New Roman', serif"

TRANSPARENT = "rgba(0,0,0,0)"


def rgba(hex_color: str, alpha: float) -> str:
    """
    '#FF8A7C' + 0.33 -> 'rgba(255,138,124,0.33)'
    Plotly refuse le hex à 8 chiffres sur marker.color ; toute transparence de
    graphique passe par ici.
    """
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"rgba({r},{g},{b},{alpha})"


CSS = f"""
<style>
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500;600;700&family=Newsreader:wght@400;500;600;700&display=swap');

.stApp {{ background: {PAPER}; }}
html, body, [class*="css"] {{ font-family: {FONT_UI}; color: {INK}; }}

h1, h2, h3, h4, h5, h6 {{ font-family: {FONT_TITLE}; color: {INK}; letter-spacing: -0.01em; }}
h1 {{ font-weight: 600; font-size: 2rem; margin-bottom: 2px; }}
h2 {{ font-weight: 600; font-size: 1.25rem; }}
h3 {{ font-weight: 600; font-size: 1.02rem; }}

.mono, code {{
  font-family: {FONT_MONO} !important;
  font-variant-numeric: tabular-nums;
}}

.subtitle {{ color: {MUTED}; font-size: 0.92rem; margin: -2px 0 14px 0; }}

/* --- titre de section : le filet ambre des maquettes ------------------- */
.eyebrow {{
  font-family: {FONT_MONO};
  font-size: 0.70rem;
  font-weight: 600;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: {MUTED};
  margin-bottom: 6px;
}}
.eyebrow.bar {{ border-left: 3px solid {ACCENT}; padding-left: 9px; }}

.card {{
  background: {CARD};
  border: 1px solid {RULE_SOFT};
  border-radius: 10px;
  padding: 18px 20px;
  margin-bottom: 12px;
}}
.card.flat {{ background: transparent; }}

/* Tuiles KPI : MÊME hauteur sur toute une rangée, et la note calée en bas —
   sinon une tuile à note longue dépasse ses voisines et la ligne « saute ». */
/* Tuiles KPI : plancher de hauteur commun + note calée en bas → une rangée
   s'aligne dès lors que les notes tiennent en 2 lignes (d'où des notes courtes). */
.card.kpi {{
  display: flex; flex-direction: column; min-height: 148px;
}}
.card.kpi .note {{ margin-top: auto; padding-top: 6px; }}

/* Le petit texte ne se colle JAMAIS au grand chiffre au-dessus. */
.stat + .note {{ margin-top: 6px; }}

/* --- bandeau d'état (dans les clous / alerte) ------------------------- */
.banner {{
  display: flex; align-items: center; justify-content: space-between;
  gap: 18px; border-radius: 10px; padding: 16px 20px; margin-bottom: 16px;
  border: 1px solid {RULE_SOFT};
}}
.banner.gain {{ background: {GAIN_SOFT}; border-color: {rgba(GAIN, 0.35)}; }}
.banner.warn {{ background: {WARN_SOFT}; border-color: {rgba(WARN, 0.35)}; }}
.banner.loss {{ background: {LOSS_SOFT}; border-color: {rgba(LOSS, 0.40)}; }}
.banner .title {{ font-weight: 700; font-size: 1.02rem; }}
.banner.gain .title {{ color: {GAIN}; }}
.banner.warn .title {{ color: {WARN}; }}
.banner.loss .title {{ color: {LOSS}; }}
.banner .right {{ text-align: right; white-space: nowrap; }}

.verdict {{
  font-family: {FONT_MONO};
  font-weight: 700;
  font-size: 2.6rem;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}}
.verdict.gain {{ color: {GAIN}; }}
.verdict.loss {{ color: {LOSS}; }}
.verdict.none {{ color: {MUTED}; }}

.stat {{
  font-family: {FONT_MONO};
  font-weight: 600;
  font-size: 1.6rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  color: {INK};
}}
.stat.gain {{ color: {GAIN}; }}
.stat.loss {{ color: {LOSS}; }}
.stat.warn {{ color: {WARN}; }}
.stat.none {{ color: {MUTED}; }}
.stat.big {{ font-size: 2.1rem; }}

.note {{ font-size: 0.83rem; color: {MUTED}; line-height: 1.55; }}
.note b {{ color: {INK}; font-weight: 600; }}

/* utilitaires de couleur — pour un mot dans une phrase, pas pour un bloc */
.txt-gain {{ color: {GAIN}; font-weight: 600; }}
.txt-loss {{ color: {LOSS}; font-weight: 600; }}
.txt-warn {{ color: {WARN}; font-weight: 600; }}
.txt-sig {{ color: {SIGNAL}; font-weight: 600; }}
.txt-acc {{ color: {ACCENT}; font-weight: 600; }}

/* --- jauge : ce qui reste avant la limite ----------------------------- */
.gauge {{
  height: 7px; border-radius: 4px; background: {RULE_SOFT};
  margin: 10px 0 6px 0; overflow: hidden;
}}
.gauge > span {{ display: block; height: 100%; border-radius: 4px; }}
.gauge.gain > span {{ background: {GAIN}; }}
.gauge.warn > span {{ background: {WARN}; }}
.gauge.loss > span {{ background: {LOSS}; }}
.gauge-ends {{ display: flex; justify-content: space-between; }}

/* --- PASTILLES ------------------------------------------------------
   Deux pièges d'espacement, tous deux visibles à l'œil avant d'être
   mesurables : une pastille sans marge BASSE se colle à celle de la ligne du
   dessus dès que la liste passe à deux lignes ; et une pastille qui autorise
   le retour à la ligne se coupe en deux au milieu d'un mot. D'où `margin`
   sur les quatre côtés utiles et `white-space: nowrap`. */
.chip {{
  display: inline-block;
  font-family: {FONT_MONO};
  font-size: 0.68rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 3px 8px;
  border: 1px solid {RULE_SOFT};
  border-radius: 5px;
  margin: 0 6px 6px 0;
  color: {MUTED};
  background: {rgba(INK, 0.03)};
  white-space: nowrap;
  vertical-align: middle;
}}
/* un groupe de pastilles : une vraie grille, pas des marges qui s'additionnent */
.chips {{ display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }}
.chips .chip {{ margin: 0; }}
.chip.ok {{ color: {GAIN}; border-color: {rgba(GAIN, 0.4)}; background: {GAIN_SOFT}; }}
.chip.bad {{ color: {LOSS}; border-color: {rgba(LOSS, 0.4)}; background: {LOSS_SOFT}; }}
.chip.warn {{ color: {WARN}; border-color: {rgba(WARN, 0.4)}; background: {WARN_SOFT}; }}
.chip.sig {{ color: {SIGNAL}; border-color: {rgba(SIGNAL, 0.4)}; background: {SIGNAL_SOFT}; }}
.chip.acc {{ color: {ACCENT}; border-color: {rgba(ACCENT, 0.45)}; background: {ACCENT_SOFT}; }}

.dot {{ font-size: 0.78rem; margin-right: 4px; }}

.stepper {{ display: flex; gap: 0; margin: 8px 0 14px 0; flex-wrap: wrap; }}
.step {{
  font-family: {FONT_MONO};
  font-size: 0.68rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 5px 12px;
  border: 1px solid {RULE_SOFT};
  border-right: none;
  color: {MUTED};
  background: {CARD};
}}
.step:first-child {{ border-radius: 6px 0 0 6px; }}
.step:last-child {{ border-right: 1px solid {RULE_SOFT}; border-radius: 0 6px 6px 0; }}
.step.on {{ background: {ACCENT}; color: {ACCENT_INK}; border-color: {ACCENT}; font-weight: 700; }}
.step.done {{ color: {INK}; background: {CARD_HI}; }}

.rule {{ border: none; border-top: 1px solid {RULE_SOFT}; margin: 22px 0 16px 0; }}

/* --- la matrice décision x résultat ----------------------------------- */
.quad {{
  border: 1px solid {RULE_SOFT}; border-radius: 8px; padding: 12px 14px;
  min-height: 96px; background: {rgba(INK, 0.02)};
}}
.quad .lab {{
  font-family: {FONT_MONO}; font-size: 0.63rem; letter-spacing: 0.09em;
  text-transform: uppercase; color: {MUTED};
}}
.quad .n {{ font-family: {FONT_MONO}; font-size: 1.7rem; font-weight: 700; margin-top: 10px; }}
.quad.mastery {{ background: {GAIN_SOFT}; border-color: {rgba(GAIN, 0.35)}; }}
.quad.mastery .n {{ color: {GAIN}; }}
.quad.luck {{ background: {LOSS_SOFT}; border-color: {rgba(LOSS, 0.30)}; }}
.quad.luck .n {{ color: {LOSS}; }}
.quad.error {{ background: {LOSS_SOFT}; border-color: {rgba(LOSS, 0.30)}; }}
.quad.error .n {{ color: {LOSS}; }}
.quad.variance {{ background: {SIGNAL_SOFT}; border-color: {rgba(SIGNAL, 0.30)}; }}
.quad.variance .n {{ color: {SIGNAL}; }}

table.t {{ width: 100%; border-collapse: collapse; font-family: {FONT_MONO}; font-size: 0.83rem; }}
table.t th {{
  text-align: left; font-weight: 600; color: {MUTED};
  font-size: 0.66rem; letter-spacing: 0.09em; text-transform: uppercase;
  padding: 9px 14px 9px 0; border-bottom: 1px solid {RULE_SOFT};
  white-space: nowrap;
}}
table.t td {{
  padding: 13px 14px 13px 0; border-bottom: 1px solid {RULE_SOFT};
  font-variant-numeric: tabular-nums; color: {INK};
  vertical-align: middle;
}}
table.t tr:last-child td {{ border-bottom: none; }}
/* Un chiffre coupé en deux lignes (« 63 / 791.42 ») se lit comme deux chiffres.
   Les colonnes de valeurs et de pastilles ne se cassent jamais ; seule la
   colonne de gauche, qui porte du texte libre, a le droit de replier. */
table.t td.num {{ text-align: right; white-space: nowrap; }}
table.t td.tight {{ white-space: nowrap; }}
/* La colonne de gauche (symbole, décision…) respire : elle ne colle plus au bord. */
table.t th:first-child, table.t td:first-child {{ padding-left: 4px; }}
table.t td:first-child {{ padding-right: 18px; }}
table.t td.gain {{ color: {GAIN}; font-weight: 600; }}
table.t td.loss {{ color: {LOSS}; font-weight: 600; }}
table.t td.warn {{ color: {WARN}; font-weight: 600; }}
table.t td.note {{ color: {MUTED}; }}
table.t td b {{ font-family: {FONT_UI}; }}

/* --- le calendrier ---------------------------------------------------- */
.cal {{
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}}
.cal-head {{
  font-family: {FONT_MONO}; font-size: 0.64rem; letter-spacing: 0.09em;
  text-transform: uppercase; color: {MUTED}; text-align: center;
  padding-bottom: 2px;
}}
.cal-day {{
  border: 1px solid {RULE_SOFT}; border-radius: 8px;
  min-height: 62px; padding: 6px 8px;
  display: flex; flex-direction: column; justify-content: space-between;
  background: {rgba(INK, 0.02)};
}}
.cal-day.vide {{ border-color: transparent; background: transparent; }}
.cal-day .num {{
  font-family: {FONT_MONO}; font-size: 0.70rem; color: {MUTED};
}}
.cal-day .pnl {{
  font-family: {FONT_MONO}; font-size: 0.78rem; font-weight: 600;
  text-align: right; font-variant-numeric: tabular-nums;
}}
/* Seuls les jours de CLÔTURE sont colorés : un jour sans clôture n'est pas un
   jour à zéro, c'est un jour où rien n'a été tranché. */
.cal-day.gain {{ background: {GAIN_SOFT}; border-color: {rgba(GAIN, 0.40)}; }}
.cal-day.gain .pnl {{ color: {GAIN}; }}
.cal-day.gain .num {{ color: {GAIN}; }}
.cal-day.loss {{ background: {LOSS_SOFT}; border-color: {rgba(LOSS, 0.40)}; }}
.cal-day.loss .pnl {{ color: {LOSS}; }}
.cal-day.loss .num {{ color: {LOSS}; }}
.cal-day.flat {{ background: {SIGNAL_SOFT}; border-color: {rgba(SIGNAL, 0.30)}; }}
.cal-day.flat .pnl {{ color: {SIGNAL}; }}

/* --- galerie de captures --------------------------------------------- */
.shot {{
  border: 1px solid {RULE_SOFT}; border-radius: 8px; padding: 6px;
  background: {rgba(INK, 0.02)};
}}
.shot .cap {{ font-size: 0.74rem; color: {MUTED}; padding: 6px 4px 2px 4px; }}

/* --- le rail de navigation ------------------------------------------- */
[data-testid="stSidebar"] {{ background: {RAIL}; border-right: 1px solid {RAIL_RULE}; }}
[data-testid="stSidebar"] * {{ color: {RAIL_TEXT}; }}
[data-testid="stSidebar"] .note {{ color: {RAIL_MUTED}; }}
[data-testid="stSidebar"] .note b {{ color: {RAIL_TEXT}; }}
[data-testid="stSidebar"] .eyebrow {{ color: {RAIL_MUTED}; }}
[data-testid="stSidebar"] .rule {{ border-top: 1px solid {RAIL_RULE}; }}
[data-testid="stSidebar"] code {{
  background: {rgba(INK, 0.07)}; color: {RAIL_TEXT}; padding: 1px 4px; border-radius: 4px;
}}
[data-testid="stSidebar"] .chip {{ background: transparent; border-color: {RAIL_RULE}; color: {RAIL_MUTED}; }}
[data-testid="stSidebar"] .chip.ok {{ color: {RAIL_GAIN}; border-color: {rgba(GAIN, 0.4)}; }}
[data-testid="stSidebar"] .chip.bad {{ color: {RAIL_LOSS}; border-color: {rgba(LOSS, 0.4)}; }}
[data-testid="stSidebar"] .chip.warn {{ color: {RAIL_WARN}; border-color: {rgba(WARN, 0.4)}; }}
[data-testid="stSidebar"] .chip.sig {{ color: {RAIL_SIGNAL}; border-color: {rgba(SIGNAL, 0.4)}; }}
[data-testid="stSidebar"] [role="radiogroup"] label {{
  padding: 7px 10px; border-radius: 8px; border-left: 2px solid transparent;
}}
[data-testid="stSidebar"] [role="radiogroup"] label:has(input:checked) {{
  background: {ACCENT_SOFT}; border-left-color: {ACCENT};
}}
[data-testid="stSidebar"] [role="radiogroup"] label:has(input:checked) p {{
  color: {ACCENT} !important; font-weight: 600;
}}
/* le bouton du rail : même règle que ceux de la zone principale — fond ET
   texte déclarés ensemble, jamais l'un sans l'autre. */
[data-testid="stSidebar"] button {{
  background: {rgba(INK, 0.04)} !important;
  border: 1px solid {RAIL_RULE} !important;
  border-radius: 8px !important;
  color: {RAIL_TEXT} !important;
  -webkit-text-fill-color: {RAIL_TEXT} !important;
  font-family: {FONT_UI}; font-weight: 500;
}}
[data-testid="stSidebar"] button * {{
  color: {RAIL_TEXT} !important;
  -webkit-text-fill-color: {RAIL_TEXT} !important;
}}
[data-testid="stSidebar"] button:hover {{ border-color: {ACCENT} !important; }}

/* ====================================================================== */
/*  VERROU ANTI-STREAMLIT — zone principale uniquement.                    */
/* ====================================================================== */

section[data-testid="stMain"] h1,
section[data-testid="stMain"] h2,
section[data-testid="stMain"] h3,
section[data-testid="stMain"] h4,
section[data-testid="stMain"] [data-testid="stMarkdownContainer"] p,
section[data-testid="stMain"] [data-testid="stMarkdownContainer"] li,
section[data-testid="stMain"] label,
section[data-testid="stMain"] [data-testid="stWidgetLabel"] * {{
  color: {INK} !important;
}}

.card, .card * {{ color: {INK} !important; }}
.card .note, .card .note *, .card .eyebrow {{ color: {MUTED} !important; }}
.card .chip.ok, .card .chip.ok * {{ color: {GAIN} !important; }}
.card .chip.bad, .card .chip.bad * {{ color: {LOSS} !important; }}
.card .chip.warn, .card .chip.warn * {{ color: {WARN} !important; }}
.card .chip.sig, .card .chip.sig * {{ color: {SIGNAL} !important; }}
.card .chip.acc, .card .chip.acc * {{ color: {ACCENT} !important; }}

/* --- BOUTONS ---------------------------------------------------------
   L'histoire, pour ne pas la refaire : en version claire, les boutons
   « primary » étaient remplis d'encre avec du texte blanc, et selon la version
   de Streamlit le markup change — un sélecteur qui ne matche pas laissait un
   bouton entièrement noir, lisible au seul survol. La parade avait été de
   n'avoir AUCUN bouton à fond sombre.

   Sur fond sombre, la même règle deviendrait absurde (tout est sombre). La
   règle devient donc : le fond d'un bouton et son texte sont TOUJOURS déclarés
   ENSEMBLE, dans la même règle, et leur contraste est vérifié par un test.

     secondaire : texte encre        sur carte  -> 14.88:1
     primaire   : texte fond profond sur ambre  ->  9.41:1

   `-webkit-text-fill-color` accompagne chaque `color` : sans elle, WebKit
   ignore la couleur sur un <button>. */

section[data-testid="stMain"] button {{
  border-radius: 8px !important;
  border: 1px solid {RULE} !important;
  background: {CARD} !important;
  color: {INK} !important;
  -webkit-text-fill-color: {INK} !important;
  font-family: {FONT_UI};
  font-weight: 500;
}}
section[data-testid="stMain"] button * {{
  color: {INK} !important;
  -webkit-text-fill-color: {INK} !important;
}}
section[data-testid="stMain"] button:hover {{
  border-color: {ACCENT} !important;
  background: {CARD_HI} !important;
}}

section[data-testid="stMain"] button[kind="primary"],
section[data-testid="stMain"] button[kind="primaryFormSubmit"],
section[data-testid="stMain"] button[data-testid*="primary"] {{
  border: 1px solid {ACCENT} !important;
  background: {ACCENT} !important;
  color: {ACCENT_INK} !important;
  -webkit-text-fill-color: {ACCENT_INK} !important;
  font-weight: 700 !important;
}}
section[data-testid="stMain"] button[kind="primary"] *,
section[data-testid="stMain"] button[kind="primaryFormSubmit"] *,
section[data-testid="stMain"] button[data-testid*="primary"] * {{
  color: {ACCENT_INK} !important;
  -webkit-text-fill-color: {ACCENT_INK} !important;
}}
section[data-testid="stMain"] button[kind="primary"]:hover,
section[data-testid="stMain"] button[kind="primaryFormSubmit"]:hover,
section[data-testid="stMain"] button[data-testid*="primary"]:hover {{
  background: {WARN} !important;
  border-color: {WARN} !important;
}}

/* --- RIEN DE « ROND BARRÉ » -----------------------------------------
   Le curseur `not-allowed` (le rond barré) sur un widget désactivé fait peu
   pro. Partout où un contrôle est momentanément grisé (bouton de confirmation
   en attente d'une case cochée), on garde un curseur normal et un simple
   affaiblissement — jamais l'icône d'interdiction. Les vraies zones sans objet,
   elles, ne sont plus rendues du tout mais remplacées par une carte cadenassée. */
section[data-testid="stMain"] :disabled,
section[data-testid="stMain"] [aria-disabled="true"] {{
  cursor: default !important;
}}
section[data-testid="stMain"] button:disabled {{
  opacity: 0.45 !important;
}}

/* --- LES 3 POINTS (popover) -----------------------------------------
   Le déclencheur « ⋮ » d'un conteneur : discret, carré, sans le remplissage
   d'un vrai bouton — un point de menu, pas une action. Le panneau, lui, reprend
   la couleur d'une carte pour ne pas flotter en gris Streamlit. */
section[data-testid="stMain"] [data-testid="stPopover"] button {{
  border: 1px solid {RULE_SOFT} !important;
  background: transparent !important;
  color: {MUTED} !important;
  -webkit-text-fill-color: {MUTED} !important;
  font-size: 1.15rem !important;
  line-height: 1 !important;
  padding: 2px 8px !important;
  min-height: 0 !important;
}}
section[data-testid="stMain"] [data-testid="stPopover"] button:hover {{
  color: {INK} !important;
  -webkit-text-fill-color: {INK} !important;
  border-color: {ACCENT} !important;
  background: {CARD_HI} !important;
}}
[data-testid="stPopoverBody"] {{
  background: {CARD} !important;
  border: 1px solid {RULE} !important;
  border-radius: 10px !important;
}}
[data-testid="stPopoverBody"] * {{ color: {INK} !important; }}

/* --- CASES À COCHER, RADIOS, DÉPÔT DE FICHIER ------------------------ */
section[data-testid="stMain"] [data-testid="stCheckbox"] *,
section[data-testid="stMain"] [data-testid="stRadio"] *,
section[data-testid="stMain"] [data-testid="stWidgetLabel"] * {{
  color: {INK} !important;
}}
/* --- DÉPÔT DE FICHIER ------------------------------------------------
   Le cadre appartient à la ZONE DE DÉPÔT, jamais au widget entier : posé sur
   le widget, il enfermait aussi le libellé et l'infobulle « ? », qui se
   retrouvaient collés au trait — et l'infobulle chevauchait carrément la
   bordure droite. Le libellé vit au-dessus du cadre, avec sa respiration. */
section[data-testid="stMain"] [data-testid="stFileUploader"] {{
  background: transparent !important;
  border: none !important;
}}
section[data-testid="stMain"] [data-testid="stFileUploader"] > label {{
  margin-bottom: 10px !important;
  padding-right: 4px;
}}
section[data-testid="stMain"] [data-testid="stFileUploader"] * {{ color: {INK} !important; }}
section[data-testid="stMain"] [data-testid="stFileUploaderDropzone"] {{
  background: {CARD} !important;
  border: 1px dashed {RULE} !important;
  border-radius: 10px;
  padding: 20px 22px !important;
  gap: 16px;
}}
section[data-testid="stMain"] [data-testid="stFileUploaderDropzoneInstructions"] {{
  padding-right: 12px;
}}
section[data-testid="stMain"] [data-testid="stFileUploaderDropzoneInstructions"] * {{
  color: {MUTED} !important;
}}
section[data-testid="stMain"] [data-testid="stSlider"] * {{ color: {INK} !important; }}
section[data-testid="stMain"] [data-testid="stSlider"] [role="slider"] {{
  background: {ACCENT} !important;
}}
section[data-testid="stMain"] [data-testid="stSliderTickBarMin"],
section[data-testid="stMain"] [data-testid="stSliderTickBarMax"] {{
  color: {MUTED} !important;
}}

/* onglets et dépliants */
section[data-testid="stMain"] .stTabs [data-baseweb="tab"] *,
section[data-testid="stMain"] [data-testid="stExpander"] summary * {{
  color: {INK} !important;
}}
section[data-testid="stMain"] .stTabs [aria-selected="true"] * {{ color: {ACCENT} !important; }}
section[data-testid="stMain"] [data-testid="stExpander"] details {{
  background: {CARD} !important; border-color: {RULE_SOFT} !important;
  border-radius: 10px;
}}

/* --- MENUS DÉROULANTS ET CHAMPS -------------------------------------- */
section[data-testid="stMain"] [data-baseweb="select"] > div,
section[data-testid="stMain"] [data-baseweb="input"] > div,
section[data-testid="stMain"] [data-baseweb="textarea"] > div {{
  background: {CARD} !important;
  border-color: {RULE} !important;
  color: {INK} !important;
  border-radius: 8px;
}}
section[data-testid="stMain"] [data-baseweb="select"] *,
section[data-testid="stMain"] [data-baseweb="input"] input,
section[data-testid="stMain"] [data-baseweb="textarea"] textarea {{
  color: {INK} !important;
}}
[data-baseweb="popover"] [role="listbox"],
[data-baseweb="menu"] {{ background: {CARD} !important; }}
[data-baseweb="popover"] [role="option"],
[data-baseweb="menu"] li, [data-baseweb="menu"] li * {{ color: {INK} !important; }}
[data-baseweb="popover"] [role="option"]:hover {{ background: {CARD_HI} !important; }}

[data-testid="stMetricLabel"] {{ font-size: 0.7rem !important; color: {MUTED} !important; }}

.stTabs [data-baseweb="tab"] {{ font-family: {FONT_UI}; font-weight: 500; }}
#MainMenu, footer {{ visibility: hidden; }}
</style>
"""


# -------------------------------------------------------------- Plotly

def layout(height=320, **kw):
    """Base commune à tous les graphiques."""
    base = dict(
        height=height,
        margin=dict(l=8, r=8, t=28, b=8),
        paper_bgcolor=TRANSPARENT,
        plot_bgcolor=TRANSPARENT,
        font=dict(family="JetBrains Mono, monospace", size=11, color=INK),
        xaxis=dict(showgrid=False, zeroline=False, linecolor=RULE_SOFT,
                   ticks="outside", tickcolor=RULE_SOFT,
                   tickfont=dict(size=10, color=MUTED)),
        yaxis=dict(gridcolor=rgba(RULE_SOFT, 0.9), zeroline=True,
                   zerolinecolor=RULE, zerolinewidth=1.2,
                   linecolor=TRANSPARENT, tickfont=dict(size=10, color=MUTED)),
        hoverlabel=dict(bgcolor=CARD_HI,
                        font=dict(family="JetBrains Mono, monospace",
                                  size=11, color=INK),
                        bordercolor=RULE),
        showlegend=False,
        dragmode=False,
    )
    base.update(kw)
    return base


def dot(filled: bool, color: str = MUTED) -> str:
    """Provenance de la donnée, en un caractère."""
    return f'<span class="dot" style="color:{color}">{"●" if filled else "○"}</span>'
