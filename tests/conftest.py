"""
Garde-fou global : AUCUN test ne doit pouvoir toucher aux vraies données.

------------------------------------------------------------------------------
LE BUG QUI A RENDU CE FICHIER NÉCESSAIRE

Un test de l'interface d'import (`test_le_bouton_appliquer…`) travaillait sur un
journal temporaire, comme il faut. Mais le code qu'il exerce appelle
`onboarding.demo_mode()`, qui lit `settings.json` — et ce fichier-là était lu
dans le VRAI dossier de données, faute d'isolation.

Résultat : lancer la suite de tests pendant qu'on était en mode démonstration
faisait sortir du mode démonstration et SUPPRIMAIT `demo.jsonl`. Le test
échouait, ce qui a permis de s'en apercevoir — mais il aurait tout aussi bien pu
passer en silence en détruisant des données.

C'est d'autant moins acceptable que `Construire l'exe.bat` lance les tests avant
chaque construction : fabriquer un exécutable ne doit jamais rien changer au
journal de celui qui le fabrique.

------------------------------------------------------------------------------
LA PARADE

`RELEVE_DATA` détourne TOUT le dossier de données (journal, réglages, captures)
— voir core/paths.py. On le pointe ici, pour toute la session de tests, vers un
dossier temporaire. Un test qui oublierait de s'isoler lui-même est désormais
isolé quand même.
"""
import os

import pytest


@pytest.fixture(autouse=True, scope="session")
def _donnees_hors_du_vrai_dossier(tmp_path_factory):
    ancien = os.environ.get("RELEVE_DATA")
    os.environ["RELEVE_DATA"] = str(tmp_path_factory.mktemp("donnees"))
    yield
    if ancien is None:
        os.environ.pop("RELEVE_DATA", None)
    else:
        os.environ["RELEVE_DATA"] = ancien
