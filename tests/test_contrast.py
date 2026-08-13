"""
Contrastes.

La lisibilité n'est pas une affaire de goût : elle se mesure. Ces tests
appliquent la norme WCAG 2.1 (ratio de luminance relative entre deux couleurs)
et refusent toute palette qui repasserait sous les seuils.

    4.5:1   texte courant
    3.0:1   éléments d'interface ACTIFS (bordures de boutons, de champs)

La v1 échouait sur MUTED (3.43), WARN (3.92) et RULE (1.20) — c'est pourquoi
l'interface était « presque illisible ». Ce fichier existe pour que ça ne
puisse plus arriver en silence.

CE QUI A CHANGÉ AVEC LE THÈME SOMBRE, et pourquoi ce n'est pas un relâchement :

  - RULE_SOFT (filets décoratifs) ne vise plus 3.0. WCAG 1.4.11 couvre les
    COMPOSANTS d'interface, pas les séparateurs de tableau. RULE, qui borde les
    boutons et les champs, franchit toujours le seuil — et un test le vérifie.

  - Le seuil de 4.0 en deutéranopie devient MATHÉMATIQUEMENT INATTEIGNABLE sur
    fond sombre. La démonstration est dans le test dédié : elle est plus utile
    qu'un seuil abaissé sans explication.
"""
import pytest

from app import theme as T

TEXT_MIN = 4.5
UI_MIN = 3.0


def _lum(hex_color: str) -> float:
    """Luminance relative, formule WCAG 2.1."""
    h = hex_color.lstrip("#")
    ch = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    ch = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in ch]
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]


def contrast(a: str, b: str) -> float:
    la, lb = _lum(a), _lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def _deuteranopia(hex_color: str) -> str:
    """Simulation du daltonisme rouge-vert le plus fréquent (Viénot et al.)."""
    h = hex_color.lstrip("#")
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    r2 = 0.625 * r + 0.375 * g
    g2 = 0.700 * r + 0.300 * g
    b2 = 0.300 * g + 0.700 * b
    return "#%02X%02X%02X" % tuple(
        min(255, max(0, round(x * 255))) for x in (r2, g2, b2))


# --------------------------------------------------------------- texte

@pytest.mark.parametrize("name", ["INK", "MUTED", "GAIN", "LOSS", "SIGNAL",
                                  "WARN", "ACCENT"])
@pytest.mark.parametrize("bg_name", ["PAPER", "CARD"])
def test_texte_lisible(name, bg_name):
    """Chaque couleur de texte, sur chacun des deux fonds."""
    fg = getattr(T, name)
    bg = getattr(T, bg_name)
    r = contrast(fg, bg)
    assert r >= TEXT_MIN, (
        f"{name} ({fg}) sur {bg_name} ({bg}) : {r:.2f}:1 — "
        f"sous le seuil de {TEXT_MIN}. Le texte serait pénible à lire.")


def test_muted_etait_le_coupable():
    """
    MUTED est la couleur du texte secondaire : notes, eyebrows, légendes.
    C'est la plus fréquente de l'interface, donc la moins pardonnable.
    L'ancienne valeur (#767E8B) plafonnait à 3.43:1 sur son fond.
    """
    assert contrast("#767E8B", "#E9EBEF") < TEXT_MIN      # l'ancienne : échouait
    assert contrast(T.MUTED, T.PAPER) >= TEXT_MIN         # la nouvelle : passe


# --------------------------------------------------------------- interface

def test_bordures_actives_visibles():
    """
    Une bordure de bouton ou de champ EST un composant d'interface : WCAG 1.4.11
    lui impose 3:1. C'est RULE, et il franchit le seuil.
    """
    assert contrast(T.RULE, T.PAPER) >= UI_MIN
    assert contrast(T.RULE, T.CARD) >= UI_MIN


def test_filets_decoratifs_restent_discrets_mais_perceptibles():
    """
    RULE_SOFT sépare deux lignes d'un tableau. À 3:1 sur fond sombre, il
    produirait une grille de barreaux plus bruyante que les chiffres qu'elle
    sépare. Il doit rester PERCEPTIBLE, pas conforme à un seuil qui ne le vise
    pas — et surtout, il ne doit jamais servir de bordure à un bouton.
    """
    assert contrast(T.RULE_SOFT, T.PAPER) >= 1.25
    assert contrast(T.RULE_SOFT, T.CARD) >= 1.15
    assert f"border: 1px solid {T.RULE} !important" in T.CSS, (
        "les boutons doivent utiliser RULE, pas RULE_SOFT")


def test_cartes_se_detachent_du_fond():
    """Sinon la hiérarchie visuelle s'effondre et tout se vaut."""
    assert contrast(T.PAPER, T.CARD) >= 1.06


# --------------------------------------------------------------- daltonisme

def test_le_seuil_de_4_exigerait_un_gain_blanc():
    """
    La démonstration, figée ici pour qu'on ne « corrige » pas ce seuil un jour
    en croyant réparer une régression.

    Sur ce fond, une couleur lisible à 4.5:1 a une luminance relative d'au moins
    ~0.20. Pour que le gain s'en écarte de 4.0:1, il lui faudrait une luminance
    d'environ 0.96 — c'est-à-dire du BLANC. Or le texte courant est déjà presque
    blanc : un gain blanc ne se distinguerait plus d'une phrase ordinaire, et on
    aurait réglé le daltonisme en cassant la lecture de tout le monde.

    Le compromis retenu : le meilleur écart atteignable avec un vert qui reste
    un vert, doublé d'indices non colorés (signe, position, texture).
    """
    plancher = 4.5 * (_lum(T.PAPER) + 0.05) - 0.05      # L min pour 4.5:1
    assert 0.19 < plancher < 0.21

    lum_gain_requise = 4.0 * (plancher + 0.05) - 0.05
    assert lum_gain_requise > 0.95, "le calcul a changé : revoir le raisonnement"

    # ce « gain » serait indiscernable du texte courant
    assert contrast("#FFFFFF", T.INK) < 1.5


def test_gain_et_perte_distinguables_en_deuteranopie():
    """
    Le meilleur couple atteignable sous la contrainte ci-dessus. 2.5:1 est un
    écart de luminance franc — le vert est nettement plus clair que le corail —
    et il est doublé par des indices non colorés (voir le test suivant).
    """
    g, l = _deuteranopia(T.GAIN), _deuteranopia(T.LOSS)
    assert contrast(g, l) >= 2.5, (
        f"gain et perte se confondent en deutéranopie : {contrast(g, l):.2f}:1")


def test_le_signe_est_toujours_imprime():
    """
    La compensation du point précédent : le signe ne dépend JAMAIS de la
    couleur. Un daltonien total lit +2.40 R et −1.00 R sans ambiguïté.
    """
    from app.ui import fmt_money, fmt_r
    assert fmt_r(2.4).startswith("+")
    assert fmt_r(-1).startswith("-") or fmt_r(-1).startswith("−")
    assert fmt_money(1920).startswith("+")
    assert "-" in fmt_money(-1920)


def test_la_couleur_ne_porte_jamais_seule_l_information():
    """
    Garde-fou de conception : le signe du R est aussi encodé par la position de
    la barre (au-dessus / en dessous du zéro), et la discipline par la texture
    (plein / hachuré / contour). Retirer toutes les couleurs ne fait perdre
    aucune donnée.
    """
    from app.views.dashboard import _bars
    from tests.test_render import _idea

    ideas = [_idea(2.0, score=5, day=1), _idea(-1.0, score=2, day=2),
             _idea(1.2, score=None, day=3)]
    fig, _ = _bars(ideas, spec_book=None)
    bar = fig.data[0]

    # le signe vient de y, pas de la couleur
    assert bar.y[0] > 0 and bar.y[1] < 0

    # la discipline vient de la texture, pas de la couleur
    shapes = list(bar.marker.pattern.shape)
    assert shapes[0] == ""     # 5/5 -> plein
    assert shapes[1] == "/"    # 2/5 -> hachuré
    widths = list(bar.marker.line.width)
    assert widths[2] > 0       # non relu -> contour seul


# --------------------------------------------------------------- le rail

@pytest.mark.parametrize("name,need", [
    ("RAIL_TEXT", TEXT_MIN),
    ("RAIL_MUTED", TEXT_MIN),
    ("RAIL_RULE", 1.15),      # filet décoratif : perceptible, pas conforme 1.4.11
    ("RAIL_GAIN", TEXT_MIN),
    ("RAIL_LOSS", TEXT_MIN),
    ("RAIL_SIGNAL", TEXT_MIN),
    ("RAIL_WARN", TEXT_MIN),
])
def test_rail_lisible(name, need):
    """
    Tout ce qui s'écrit dans le rail doit s'y lire. RAIL_RULE fait exception :
    c'est le trait qui sépare deux blocs de navigation, pas un composant — même
    raisonnement que RULE_SOFT en zone principale.
    """
    fg = getattr(T, name)
    r = contrast(fg, T.RAIL)
    assert r >= need, f"{name} ({fg}) sur le rail : {r:.2f}:1 — requis {need}"


def test_les_variantes_du_rail_restent_lisibles():
    """
    En version claire, le rail était sombre au milieu d'un fond clair : les
    couleurs du contenu y devenaient illisibles, d'où des variantes éclaircies.

    Tout étant désormais sombre, les mêmes couleurs conviennent aux deux
    surfaces — les constantes RAIL_* subsistent pour que le jour où le rail
    change de teinte, il y ait un seul endroit à modifier. Le test vérifie donc
    la LISIBILITÉ, pas la divergence.
    """
    for nom in ("RAIL_GAIN", "RAIL_LOSS", "RAIL_SIGNAL", "RAIL_WARN"):
        assert contrast(getattr(T, nom), T.RAIL) >= TEXT_MIN


def test_hierarchie_des_surfaces():
    """
    fond (le plus sombre) < rail (chrome) < carte (contenu).

    Le contenu doit être la surface la plus claire de l'écran : c'est ce qui
    fait remonter les cartes vers l'œil. Un rail plus clair que les cartes
    rivaliserait avec le contenu au lieu de l'encadrer.
    """
    def L(h):
        return _lum(h)

    assert L(T.PAPER) < L(T.RAIL) < L(T.CARD)
    # Sur fond sombre, la séparation se joue en dixièmes : exiger un contraste
    # fort découperait l'écran en deux zones qui se disputent l'attention.
    assert contrast(T.PAPER, T.CARD) >= 1.06
    assert contrast(T.RAIL, T.CARD) >= 1.02


# --------------------------------------------------------------- rgba

def test_rgba_pour_plotly():
    """Plotly refuse le hex à 8 chiffres. Toute transparence de graphique passe ici."""
    assert T.rgba("#B03A2E", 0.33) == "rgba(176,58,46,0.33)"
    assert T.rgba("#FFFFFF", 1) == "rgba(255,255,255,1)"


# ------------------------------------------- couverture des widgets Streamlit

# Correspondance : widget Streamlit -> sélecteur CSS qui doit le couvrir.
# st.form_submit_button rend un .stFormSubmitButton, PAS un .stButton — c'est
# le piège qui laissait « Armer la thèse » en noir sur noir.
WIDGET_SELECTORS = {
    # Un sélecteur générique `stMain button` couvre TOUTES les variantes de
    # bouton — présentes et futures — sans dépendre du markup interne de
    # Streamlit, qui change de version en version.
    "st.button": '[data-testid="stMain"] button',
    "st.form_submit_button": '[data-testid="stMain"] button',
    "st.download_button": '[data-testid="stMain"] button',
    "st.checkbox": "stCheckbox",
    "st.radio": "stRadio",
    "st.selectbox": 'baseweb="select"',
    "st.multiselect": 'baseweb="select"',
    "st.text_input": 'baseweb="input"',
    "st.number_input": 'baseweb="input"',
    "st.text_area": 'baseweb="textarea"',
    "st.file_uploader": "stFileUploader",
    "st.expander": "stExpander",
    "st.tabs": "stTabs",
    "st.slider": "stSlider",
}


def _widgets_used() -> set:
    """Tous les widgets réellement appelés dans l'application."""
    import re
    from pathlib import Path
    app = Path(__file__).parent.parent / "app"
    code = "\n".join(f.read_text(encoding="utf-8") for f in app.rglob("*.py"))
    found = set()
    for w in WIDGET_SELECTORS:
        method = w.split(".", 1)[1]
        # Un widget peut être appelé sur `st` MAIS AUSSI sur une colonne
        # (c1.selectbox, c3.slider…). Ne chercher que « st. » laissait des
        # widgets hors audit — c'est ainsi que st.slider est passé au travers.
        if re.search(rf"\b\w+\.{re.escape(method)}\s*\(", code):
            found.add(w)
    return found


def test_chaque_widget_utilise_a_une_regle_css():
    """
    Garde-fou : tout widget employé dans l'app DOIT avoir une règle de couleur.

    Sans ce test, ajouter un st.download_button ou un st.toggle demain le
    laisserait aux couleurs par défaut de Streamlit — c'est-à-dire, sur ce
    thème, potentiellement illisible. Le bug se verrait à l'écran, pas ici.
    """
    css = T.CSS
    manquants = [w for w in _widgets_used() if WIDGET_SELECTORS[w] not in css]
    assert not manquants, (
        "widgets sans règle CSS (risque de texte invisible) : "
        + ", ".join(sorted(manquants)))


def test_aucun_bouton_illisible():
    """
    Garde-fou définitif contre le bouton noir sur noir.

    Trois tentatives ont échoué à rendre fiablement lisible le texte d'un bouton
    dont seul le FOND était déclaré : selon la version de Streamlit le markup
    change, et un sélecteur qui ne matche pas laisse un texte de la couleur du
    fond — un bouton lisible au seul survol.

    La règle est donc structurelle : chaque variante de bouton déclare son fond
    ET son texte dans la MÊME règle, et le contraste des deux couples est
    vérifié ici. Un texte invisible redevient impossible.

        secondaire : INK sur CARD
        primaire   : ACCENT_INK sur ACCENT
        survol     : INK sur CARD_HI
    """
    css = T.CSS
    bloc = css[css.index("--- BOUTONS"):css.index("--- CASES À COCHER")]

    for fond, texte in ((T.CARD, T.INK), (T.ACCENT, T.ACCENT_INK)):
        assert f"background: {fond} !important" in bloc, f"fond {fond} absent"
        assert f"color: {texte} !important" in bloc, f"texte {texte} absent"
        assert contrast(texte, fond) >= TEXT_MIN, (
            f"texte {texte} sur fond {fond} : {contrast(texte, fond):.2f}:1")

    # la couleur du texte doit être forcée, y compris contre -webkit-text-fill-color
    assert "-webkit-text-fill-color" in bloc, (
        "sans cette propriété, WebKit peut ignorer `color` sur un bouton")

    assert contrast(T.INK, T.CARD_HI) >= TEXT_MIN     # état survol
    assert contrast(T.ACCENT_INK, T.WARN) >= TEXT_MIN  # survol du primaire

    # le bouton du rail (« Gérer les comptes ») suit la même règle
    assert '[data-testid="stSidebar"] button' in css
    assert contrast(T.RAIL_TEXT, T.RAIL) >= TEXT_MIN


def test_le_theme_streamlit_est_declare_en_dur():
    """
    Sans section [theme] dans config.toml, Streamlit suit le thème du SYSTÈME.
    Sur un Windows en mode sombre, il rend ses widgets en sombre — boutons noirs,
    menus noirs — pendant que notre CSS peint le fond en clair.

    On se retrouve alors à repeindre chaque widget à la main, et le premier
    oublié reste illisible. Fixer le thème à la racine règle la cause, pas les
    symptômes.
    """
    import tomllib
    from pathlib import Path

    cfg = Path(__file__).parent.parent / ".streamlit" / "config.toml"
    assert cfg.exists(), "config.toml manquant : le thème suivrait le système"

    data = tomllib.loads(cfg.read_text(encoding="utf-8"))
    theme = data.get("theme")
    assert theme, "section [theme] absente : Streamlit suivrait le thème du système"
    assert theme["base"] == "dark"

    # les couleurs déclarées doivent être celles du thème Python, sans divergence
    assert theme["backgroundColor"].upper() == T.PAPER.upper()
    assert theme["secondaryBackgroundColor"].upper() == T.CARD.upper()
    assert theme["textColor"].upper() == T.INK.upper()
    assert theme["primaryColor"].upper() == T.ACCENT.upper()


def test_la_traduction_automatique_est_bloquee():
    """
    LA cause des « NotFoundError : removeChild » qui polluaient l'écran.

    Chrome prenait la page pour de l'anglais et la traduisait : « Compliance
    prop » devenait « Hélice de conformité », « conviction » devenait
    « Condamnation ». Le traducteur remplace les nœuds de texte dans le DOM ;
    React, qui croit encore les tenir, échoue ensuite à les retirer.

    Aucun correctif côté Streamlit n'y pouvait quoi que ce soit — le coupable
    était le navigateur. On déclare la langue et on interdit la traduction.
    """
    from pathlib import Path

    main = (Path(__file__).parent.parent / "app" / "main.py").read_text(encoding="utf-8")
    assert "notranslate" in main
    assert "lang = 'fr'" in main or 'lang = "fr"' in main
    assert 'name = \'google\'' in main or 'name = "google"' in main


def test_aucune_boucle_de_markdown_dans_le_rail():
    """
    Une boucle de st.markdown produit N éléments distincts. Quand N change (un
    nouveau symbole importé fait passer la liste de 2 à 3), React échoue à
    réconcilier et lève NotFoundError « removeChild » — l'erreur rouge qui
    polluait le rail.

    La parade : un seul st.markdown dont le contenu varie.
    """
    from pathlib import Path
    import re

    main = (Path(__file__).parent.parent / "app" / "main.py").read_text(encoding="utf-8")
    # pas de st.markdown directement dans un for, dans la sidebar
    bloc = main.split("with st.sidebar:")[1].split("# ---")[0]
    lignes = bloc.splitlines()
    for i, l in enumerate(lignes):
        if re.match(r"\s*for .+ in .+:", l):
            suite = "\n".join(lignes[i + 1:i + 4])
            assert "st.markdown" not in suite, (
                f"boucle de st.markdown dans le rail (ligne ~{i}) : "
                "risque de NotFoundError removeChild")
