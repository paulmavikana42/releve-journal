# -*- mode: python ; coding: utf-8 -*-
"""
Recette de fabrication du .exe.

    .venv\\Scripts\\python -m PyInstaller releve.spec --noconfirm

------------------------------------------------------------------------------
CE QUE CE FICHIER RÉSOUT

Streamlit n'est pas une bibliothèque ordinaire : il charge ses pages, ses
métadonnées de version et une bonne partie de ses modules **au moment de
l'exécution**, par des chemins que PyInstaller ne peut pas deviner en lisant le
code. Sans les trois précautions ci-dessous, l'exe se construit sans la moindre
erreur… et plante à la première seconde chez l'utilisateur :

  1. `collect_all` — embarque le code ET les fichiers de données (le front
     compilé de Streamlit, les schémas d'Altair, le JS de Plotly).
  2. `copy_metadata` — Streamlit lit sa propre version via importlib.metadata.
     Sans le dossier `.dist-info`, il lève une exception au démarrage.
  3. `--console` interdit — voir launcher.py : une fenêtre noire est lue comme
     un plantage ou un virus.

Mode « un seul dossier » (COLLECT) et pas « un seul fichier » : un exe unique se
décompresse en entier à CHAQUE lancement (ici ~250 Mo, soit 15 à 30 secondes
d'attente devant un écran vide, à chaque fois). Le dossier démarre en 2
secondes. On distribue un ZIP, ou un installateur si Paul en veut un un jour.
"""
from PyInstaller.utils.hooks import collect_all, copy_metadata

datas, binaries, hiddenimports = [], [], []

# Les paquets qui chargent des ressources à l'exécution.
for paquet in ("streamlit", "altair", "plotly", "pyarrow", "pandas", "numpy"):
    d, b, h = collect_all(paquet)
    datas += d
    binaries += b
    hiddenimports += h

# Les paquets qui lisent leur propre version.
for paquet in ("streamlit", "altair", "plotly", "pyarrow", "pandas", "numpy",
               "beautifulsoup4", "lxml"):
    try:
        datas += copy_metadata(paquet)
    except Exception:
        pass

# L'application elle-même. Elle est lue comme des FICHIERS (Streamlit exécute
# app/main.py comme un script), pas seulement importée.
#
# ⚠️ AUCUNE DONNÉE PERSONNELLE ICI. Ni `data/`, ni `tests/` : la démonstration
# est fabriquée par du CODE (seed_demo.py), plus par un rapport de broker réel.
# Un journal de trading est une donnée personnelle — elle n'a rien à faire dans
# un exécutable qu'on distribue. Un test le vérifie.
datas += [
    ("app", "app"),
    ("core", "core"),
    ("seed_demo.py", "."),
    (".streamlit/config.toml", ".streamlit"),
]

hiddenimports += [
    "streamlit.web.bootstrap", "streamlit.runtime.scriptrunner.magic_funcs",
    "bs4", "lxml", "lxml.etree", "lxml._elementpath",
    "core", "core.models", "core.store", "core.csvimport", "core.captures",
    "core.prop", "core.paths", "core.onboarding", "core.settings",
    "app.main", "app.theme", "app.ui",
    "app.views.dashboard", "app.views.ideas", "app.views.detail",
    "app.views.importer", "app.views.compliance", "app.views.settings",
    "app.views.campaigns", "app.views.welcome",
    "seed_demo",
]

a = Analysis(
    ["launcher.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Rien à exclure de lourd : tkinter EST l'interface du lanceur, et les tests
    # ne sont pas embarqués (ils ne sont pas dans `datas`).
    excludes=["pytest", "PyInstaller"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Releve",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,          # JAMAIS de fenêtre noire
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="Releve",
)
