"""
Le lanceur et la recette de fabrication du .exe.

Ce que ces tests protègent : des erreurs qui ne se voient PAS à la construction.
Un exe se fabrique sans le moindre avertissement et plante à la première seconde
chez l'utilisateur — qui n'aura ni console, ni message, ni moyen de le dire.
Chaque cas ci-dessous correspond à un plantage réellement rencontré.
"""
import re
from pathlib import Path

import pytest

import launcher

RACINE = Path(__file__).resolve().parent.parent
SPEC = (RACINE / "releve.spec").read_text(encoding="utf-8")
SRC = (RACINE / "launcher.py").read_text(encoding="utf-8")


# ------------------------------------------------------------------- le port

def test_le_port_suivant_est_pris_si_8501_est_occupe():
    """
    Deux fenêtres ouvertes, ou un autre logiciel sur 8501 : plutôt qu'un échec
    incompréhensible, on prend le port suivant.
    """
    import socket
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(1)
    occupe = s.getsockname()[1]
    try:
        assert launcher.port_libre(occupe) == occupe + 1
    finally:
        s.close()


def test_serveur_pret_ne_ment_pas():
    """Un port fermé n'est jamais annoncé comme prêt."""
    assert launcher.serveur_pret(1, timeout=0.6) is False


# --------------------------------------------------- les pièges du mode figé

def test_le_serveur_tourne_dans_son_propre_processus():
    """
    Streamlit installe des gestionnaires de signaux au démarrage, et
    `signal.signal()` n'est autorisé QUE sur le fil principal. Lancé sur un fil
    secondaire, le serveur démarre, affiche son adresse… puis meurt sur
    « ValueError: signal only works in main thread ». D'où le processus enfant.
    """
    assert "--serveur" in SRC
    assert "def servir(" in SRC
    bloc = SRC[SRC.index("def _lancer_serveur"):SRC.index("# ------", SRC.index("def _lancer_serveur"))]
    assert "threading.Thread" not in bloc, (
        "le serveur ne doit plus être démarré sur un fil d'exécution")


def test_le_mode_developpement_est_coupe_avant_le_port():
    """
    `set_option("server.port")` lève « server.port does not work when
    global.developmentMode is true ». L'ordre compte, et load_config_options
    est la seule API qui le garantit.
    """
    bloc = SRC[SRC.index("def servir("):]
    assert "load_config_options" in bloc
    i_dev = bloc.index("global.developmentMode")
    i_port = bloc.index('"server.port"')
    assert i_dev < i_port, "developmentMode doit être déclaré avant le port"


def test_le_dossier_courant_est_force_avant_de_servir():
    """
    Streamlit cherche `.streamlit/config.toml` dans le dossier COURANT. Lancé
    depuis un raccourci du bureau, il ne le trouvait pas et le thème repassait
    sur celui du système — l'interface entière changeait d'apparence.
    """
    bloc = SRC[SRC.index("def servir("):]
    assert "os.chdir(racine())" in bloc


def test_jamais_de_fenetre_noire():
    """Une console qui s'ouvre est lue comme « ça a planté » ou « c'est un virus »."""
    assert "console=False" in SPEC
    assert "CREATE_NO_WINDOW" in SRC


def test_le_bouton_terminer_tue_le_serveur():
    """
    Sans ça, le processus resterait vivant, garderait le port, et le lancement
    suivant rouvrirait la session précédente — indiagnosticable pour un
    non-technicien.
    """
    bloc = SRC[SRC.index("def terminer("):]
    assert "terminate()" in bloc and "kill()" in bloc
    assert "WM_DELETE_WINDOW" in SRC, "la croix doit faire la même chose"


# ------------------------------------------------------ la recette de l'exe

@pytest.mark.parametrize("paquet", ["streamlit", "altair", "plotly", "pyarrow"])
def test_les_paquets_a_ressources_sont_embarques(paquet):
    """
    Ces paquets chargent des fichiers à l'exécution (front compilé, schémas,
    JS). Sans `collect_all`, l'exe se construit et plante à l'ouverture.
    """
    assert re.search(rf'["\']{paquet}["\']', SPEC)
    assert "collect_all" in SPEC


def test_les_metadonnees_sont_copiees():
    """Streamlit lit sa propre version : sans le .dist-info, il lève au démarrage."""
    assert "copy_metadata" in SPEC


def test_l_application_est_embarquee_comme_des_fichiers():
    """Streamlit EXÉCUTE app/main.py comme un script : il lui faut le fichier."""
    for chemin in ('("app", "app")', '("core", "core")',
                   '(".streamlit/config.toml"'):
        assert chemin in SPEC, f"{chemin} absent de la recette"


def test_aucune_donnee_personnelle_dans_l_exe():
    """
    LE test qui protège la vie privée de celui qui distribue le programme.

    La démonstration a longtemps rejoué un VRAI rapport MT5 : pratique, mais
    toute personne recevant l'exe repartait avec l'historique de trading — et le
    numéro de compte — de celui qui l'avait construit. Elle est désormais
    fabriquée par du code.
    """
    assert "ReportHistory" not in SPEC, (
        "un rapport de broker réel est reparti dans la recette de l'exe")
    for interdit in ('("tests"', '("data"', "fixtures"):
        assert interdit not in SPEC, f"{interdit} ne doit pas être embarqué"


def test_aucun_identifiant_personnel_dans_le_code_embarque():
    """
    Le code source EST embarqué dans l'exe (Streamlit exécute app/main.py comme
    un script). Un numéro de compte laissé dans un commentaire d'architecture
    part donc chez tous ceux à qui on donne le programme — c'est ainsi qu'un
    identifiant réel a voyagé sans que personne y pense.

    Les fichiers de travail (CLAUDE.md, tests/) ne sont pas concernés : ils ne
    sont pas distribués.
    """
    import re

    embarques = []
    for dossier in ("core", "app"):
        embarques += list((RACINE / dossier).rglob("*.py"))
    embarques += [RACINE / "seed_demo.py", RACINE / "launcher.py"]

    fuites = []
    for f in embarques:
        texte = f.read_text(encoding="utf-8")
        # un numéro de compte ou de ticket réel : 8 chiffres ou plus à la suite
        for m in re.finditer(r"\b\d{8,}\b", texte):
            # les nombres du code (millisecondes, tailles) ne sont pas des
            # identifiants : on ne retient que ce qui est dans un commentaire
            # ou une chaîne de documentation.
            ligne = texte[:m.start()].count("\n") + 1
            fuites.append(f"{f.name}:{ligne} → {m.group()}")

    autorises = {"86_400_000", "86400000"}
    fuites = [x for x in fuites if x.split("→ ")[1] not in autorises]
    assert not fuites, "identifiants suspects dans du code distribué : " + str(fuites)


def test_la_demonstration_est_fabriquee_pas_rejouee():
    """Aucun fichier externe : la démonstration se construit en mémoire."""
    seed = (RACINE / "seed_demo.py").read_text(encoding="utf-8")
    assert "parse_report" not in seed
    assert "ReportHistory" not in seed
    assert "DEMO" in seed, "le compte de démonstration doit être visiblement fictif"


def test_les_tests_ne_touchent_jamais_aux_vraies_donnees():
    """
    `Construire l'exe.bat` lance la suite avant chaque construction : fabriquer
    un exécutable ne doit jamais rien changer au journal de celui qui le
    fabrique. Un test avait pourtant supprimé un `demo.jsonl` réel, faute
    d'isolation — d'où le garde-fou global de tests/conftest.py.
    """
    import os
    from core import paths

    assert os.environ.get("RELEVE_DATA"), "conftest.py doit détourner le dossier"
    assert paths.data_dir() != paths.repo_root() / "data"


def test_le_dossier_de_sortie_est_vide_avant_construction():
    """
    PyInstaller ÉCRASE les fichiers qu'il produit, mais ne supprime jamais ceux
    qu'il ne produit plus. Un fichier retiré de la recette resterait donc dans le
    programme distribué — c'est exactement ainsi qu'un rapport de trading
    personnel a failli repartir dans un exe après avoir été « retiré ».
    """
    bat = (RACINE / "Construire l'exe.bat").read_text(encoding="utf-8", errors="replace")
    assert "rmdir /s /q" in bat
    i_purge = bat.index("rmdir /s /q")
    i_build = bat.index("PyInstaller releve.spec")
    assert i_purge < i_build, "la purge doit précéder la construction"


def test_le_programme_distribue_ne_contient_aucune_donnee_personnelle():
    """
    Le contrôle sur le RÉSULTAT, pas sur l'intention. Ne s'exécute que si un
    programme a déjà été construit — sinon il n'y a rien à vérifier.
    """
    dist = RACINE / "dist" / "Releve"
    if not dist.exists():
        pytest.skip("aucun programme construit")
    fuites = [p.name for p in dist.rglob("*ReportHistory*")]
    assert not fuites, f"données personnelles dans le programme : {fuites}"
