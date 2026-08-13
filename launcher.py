"""
Le lanceur : la fenêtre que voit quelqu'un qui n'a jamais installé Python.

------------------------------------------------------------------------------
CE QU'IL DOIT FAIRE, ET DANS QUEL ÉTAT D'ESPRIT

La personne qui double-clique n'a rien demandé à personne. Elle ne sait pas ce
qu'est un terminal, un port, un serveur local. Trois règles en découlent :

  1. AUCUNE fenêtre noire. Jamais. Une console qui s'ouvre est lue comme « le
     programme a planté » ou « c'est un virus ».
  2. Toujours dire ce qui se passe, en français, sans jargon. « Préparation de
     l'application… » plutôt que « unpacking wheels ».
  3. Un seul bouton à la fin : **Terminer**. Il arrête le serveur et ferme tout.
     Fermer la croix fait la même chose — on ne laisse jamais un processus
     orphelin qui bloquerait le port au prochain lancement.

------------------------------------------------------------------------------
DEUX MODES, UN SEUL CODE

  FIGÉ (le .exe)         Python, Streamlit et l'application sont DANS l'exe.
                         Il n'y a rien à installer, rien à télécharger, et ça
                         marche sans internet. La « préparation » de la première
                         fois, c'est la décompression + le dossier de données.

  SOURCES (développement) Le lanceur crée un environnement virtuel et installe
                         les dépendances au premier lancement. C'est là que le
                         mot « installation » a un sens littéral.

Tkinter est utilisé exprès : il est fourni avec Python, donc il n'ajoute aucune
dépendance à installer — ce qui serait le comble pour l'écran qui gère
l'installation.
"""
from __future__ import annotations

import os
import queue
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import tkinter as tk
from tkinter import font as tkfont

# --- la palette du thème sombre, recopiée ici EXPRÈS ------------------------
# Le lanceur doit pouvoir s'afficher avant que quoi que ce soit d'autre ne soit
# importable : il ne dépend d'aucun module de l'application. Trois couleurs
# recopiées valent mieux qu'un import qui peut échouer devant l'utilisateur.
FOND = "#0B1220"
CARTE = "#111B2E"
ENCRE = "#E9EFF7"
GRIS = "#93A4BD"
AMBRE = "#F5A83C"
VERT = "#4FE3A6"
ROUGE = "#FF8A7C"

PORT = 8501
TITRE = "Relevé"


def racine() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent


def port_libre(port: int = PORT) -> int:
    """
    Le premier port disponible à partir de 8501.

    Deux instances ouvertes en même temps, ou un port pris par un autre
    logiciel : plutôt que d'échouer avec un message que personne ne comprend, on
    prend le suivant.
    """
    for p in range(port, port + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    return port


def serveur_pret(port: int, timeout: float = 90) -> bool:
    """Attend que le serveur réponde vraiment, pas qu'il ait simplement démarré."""
    fin = time.time() + timeout
    while time.time() < fin:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.4)
    return False


class Fenetre:
    """L'écran unique. Une phrase, une barre, un bouton."""

    def __init__(self):
        self.messages: queue.Queue = queue.Queue()
        self.port = port_libre()
        self.serveur: subprocess.Popen | None = None
        self.thread_serveur: threading.Thread | None = None
        self.pret = False
        self.arret_demande = False

        self.root = tk.Tk()
        self.root.title(TITRE)
        self.root.configure(bg=FOND)
        self.root.geometry("520x330")
        self.root.resizable(False, False)
        self.root.protocol("WM_DELETE_WINDOW", self.terminer)
        self._centrer()

        titre_font = tkfont.Font(family="Georgia", size=24, weight="bold")
        texte_font = tkfont.Font(family="Segoe UI", size=10)
        petit_font = tkfont.Font(family="Segoe UI", size=9)
        bouton_font = tkfont.Font(family="Segoe UI", size=10, weight="bold")

        cadre = tk.Frame(self.root, bg=FOND, padx=34, pady=30)
        cadre.pack(fill="both", expand=True)

        entete = tk.Frame(cadre, bg=FOND)
        entete.pack(anchor="w")
        tk.Label(entete, text=" R ", bg=AMBRE, fg=FOND,
                 font=tkfont.Font(family="Georgia", size=16, weight="bold"),
                 padx=6, pady=2).pack(side="left")
        tk.Label(entete, text="  Relevé", bg=FOND, fg=ENCRE,
                 font=titre_font).pack(side="left")

        tk.Label(cadre, text="Ton journal de trading",
                 bg=FOND, fg=GRIS, font=texte_font).pack(anchor="w", pady=(2, 22))

        self.etat = tk.Label(cadre, text="Démarrage…", bg=FOND, fg=ENCRE,
                             font=texte_font, anchor="w", justify="left",
                             wraplength=440)
        self.etat.pack(anchor="w")

        self.detail = tk.Label(cadre, text="", bg=FOND, fg=GRIS,
                               font=petit_font, anchor="w", justify="left",
                               wraplength=440)
        self.detail.pack(anchor="w", pady=(4, 14))

        # La barre de progression : un simple rectangle qui avance. Aucune
        # dépendance, et surtout aucun thème ttk qui rendrait gris sur gris.
        self.piste = tk.Canvas(cadre, height=6, bg=CARTE, highlightthickness=0)
        self.piste.pack(fill="x")
        self.barre = self.piste.create_rectangle(0, 0, 0, 6, fill=AMBRE, width=0)
        self.progression = 0.0

        boutons = tk.Frame(cadre, bg=FOND)
        boutons.pack(side="bottom", fill="x", pady=(24, 0))

        self.bouton_ouvrir = tk.Button(
            boutons, text="Ouvrir dans le navigateur", command=self.ouvrir,
            bg=AMBRE, fg=FOND, activebackground="#E9B44C", activeforeground=FOND,
            font=bouton_font, relief="flat", padx=16, pady=8, cursor="hand2",
            state="disabled", disabledforeground="#6B7A90")
        self.bouton_ouvrir.pack(side="left")

        self.bouton_terminer = tk.Button(
            boutons, text="Terminer", command=self.terminer,
            bg=CARTE, fg=ENCRE, activebackground="#16213A", activeforeground=ENCRE,
            font=bouton_font, relief="flat", padx=16, pady=8, cursor="hand2")
        self.bouton_terminer.pack(side="right")

        self.root.after(100, self._pomper)

    # ---------------------------------------------------------------- fenêtre

    def _centrer(self):
        self.root.update_idletasks()
        w, h = 520, 330
        x = (self.root.winfo_screenwidth() - w) // 2
        y = (self.root.winfo_screenheight() - h) // 3
        self.root.geometry(f"{w}x{h}+{x}+{y}")

    def dire(self, texte: str, detail: str = "", avance: float | None = None):
        """Depuis n'importe quel fil d'exécution."""
        self.messages.put(("etat", texte, detail, avance))

    def _pomper(self):
        """Tkinter n'est pas thread-safe : tout passe par cette file."""
        try:
            while True:
                genre, *reste = self.messages.get_nowait()
                if genre == "etat":
                    texte, detail, avance = reste
                    self.etat.config(text=texte)
                    self.detail.config(text=detail)
                    if avance is not None:
                        self._avancer(avance)
                elif genre == "pret":
                    self._devenir_pret()
                elif genre == "echec":
                    self._echouer(reste[0])
        except queue.Empty:
            pass
        self.root.after(100, self._pomper)

    def _avancer(self, valeur: float):
        self.progression = max(0.0, min(1.0, valeur))
        largeur = self.piste.winfo_width() or 440
        self.piste.coords(self.barre, 0, 0, largeur * self.progression, 6)

    def _devenir_pret(self):
        self.pret = True
        self._avancer(1.0)
        self.etat.config(text="C'est prêt.", fg=VERT)
        self.detail.config(
            text=f"L'application tourne sur cet ordinateur, à l'adresse "
                 f"localhost:{self.port}. Rien ne part sur internet.\n"
                 f"Laisse cette fenêtre ouverte pendant que tu t'en sers.")
        self.bouton_ouvrir.config(state="normal")

    def _echouer(self, message: str):
        self.etat.config(text="Le démarrage a échoué.", fg=ROUGE)
        self.detail.config(text=message)
        self._avancer(1.0)
        self.piste.itemconfig(self.barre, fill=ROUGE)

    # ---------------------------------------------------------------- travail

    def demarrer(self):
        threading.Thread(target=self._preparer_et_lancer, daemon=True).start()
        self.root.mainloop()

    def _preparer_et_lancer(self):
        try:
            python = self._preparer()
            self.dire("Ouverture de ton journal…",
                      "Encore quelques secondes.", 0.75)
            self._lancer_serveur(python)
            if self._attendre():
                self.messages.put(("pret",))
                self.ouvrir()
            else:
                self.messages.put((
                    "echec",
                    "L'application n'a pas réussi à démarrer. Ferme cette "
                    "fenêtre et réessaie ; si ça recommence, redémarre "
                    "l'ordinateur."))
        except Exception as e:                        # noqa: BLE001
            self.messages.put(("echec", f"{type(e).__name__} : {e}"))

    def _attendre(self, timeout: float = 90) -> bool:
        """
        Attend que le serveur RÉPONDE, en surveillant aussi qu'il soit vivant.

        Guetter uniquement le port ferait patienter 90 secondes devant une barre
        de progression alors que le serveur est déjà mort. Surveiller le
        processus permet d'annoncer l'échec tout de suite.
        """
        fin = time.time() + timeout
        while time.time() < fin:
            if self.serveur is not None and self.serveur.poll() is not None:
                return False
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.5)
                if s.connect_ex(("127.0.0.1", self.port)) == 0:
                    return True
            time.sleep(0.4)
        return False

    def _preparer(self) -> str:
        """Renvoie l'interpréteur à utiliser. Installe ce qu'il faut si besoin."""
        if getattr(sys, "frozen", False):
            # Tout est déjà dans l'exe : la « préparation » consiste à créer le
            # dossier de données de l'utilisateur, et c'est instantané.
            self.dire("Préparation de l'application…",
                      "Première ouverture : quelques secondes.", 0.35)
            sys.path.insert(0, str(racine()))
            from core import paths
            paths.data_dir()
            self.dire("Préparation terminée.", "", 0.6)
            return sys.executable

        venv = racine() / ".venv"
        python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

        if not python.exists():
            self.dire("Installation en cours…",
                      "C'est la première fois : 2 à 3 minutes, une seule fois.\n"
                      "Tu peux laisser tourner.", 0.15)
            subprocess.run([sys.executable, "-m", "venv", str(venv)],
                           check=True, creationflags=self._sans_console())
            self.dire("Installation des composants…",
                      "Téléchargement des bibliothèques nécessaires.", 0.35)
            subprocess.run([str(python), "-m", "pip", "install", "--quiet",
                            "--disable-pip-version-check", "-r",
                            str(racine() / "requirements.txt")],
                           check=True, creationflags=self._sans_console())
            self.dire("Installation terminée.", "", 0.65)
        return str(python)

    @staticmethod
    def _sans_console() -> int:
        """Sous Windows : jamais de fenêtre noire. Ailleurs : sans effet."""
        return getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

    def _lancer_serveur(self, python: str):
        script = str(racine() / "app" / "main.py")
        commun = [
            "--server.port", str(self.port),
            "--server.headless", "true",
            "--browser.gatherUsageStats", "false",
            "--server.fileWatcherType", "none",
            "--global.developmentMode", "false",
        ]
        env = dict(os.environ, STREAMLIT_SERVER_HEADLESS="true")

        if getattr(sys, "frozen", False):
            # Dans l'exe, il n'y a pas d'exécutable `streamlit` à appeler. On
            # relance donc L'EXE LUI-MÊME avec un drapeau : le processus enfant
            # sert l'application, la fenêtre reste au parent.
            #
            # Pourquoi un processus et pas un simple fil d'exécution : Streamlit
            # installe des gestionnaires de signaux au démarrage, et
            # `signal.signal()` n'est autorisé QUE sur le fil principal. Sur un
            # fil secondaire, le serveur démarre, affiche son adresse, puis meurt
            # sur `ValueError: signal only works in main thread`. Un processus
            # enfant a son propre fil principal — et se termine proprement.
            self.serveur = subprocess.Popen(
                [sys.executable, "--serveur", "--port", str(self.port)],
                cwd=str(racine()), env=env,
                creationflags=self._sans_console(),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            self.serveur = subprocess.Popen(
                [python, "-m", "streamlit", "run", script] + commun,
                cwd=str(racine()), env=env,
                creationflags=self._sans_console(),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # ---------------------------------------------------------------- actions

    def ouvrir(self):
        webbrowser.open(f"http://localhost:{self.port}")

    def terminer(self):
        """
        Arrêt propre : le serveur meurt avec la fenêtre.

        Sans ça, le processus resterait vivant, garderait le port, et le
        lancement suivant s'ouvrirait sur… la session précédente. C'est
        exactement le genre de bug qu'un non-technicien ne peut pas diagnostiquer.
        """
        if self.arret_demande:
            return
        self.arret_demande = True
        self.etat.config(text="Fermeture…", fg=GRIS)
        self.detail.config(text="")
        self.root.update_idletasks()

        if self.serveur and self.serveur.poll() is None:
            self.serveur.terminate()
            try:
                self.serveur.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.serveur.kill()

        self.root.destroy()
        # Sortie forcée : Tkinter et les fils de préparation peuvent encore
        # attendre quelque chose, et une fenêtre qui « refuse de se fermer » est
        # exactement ce qu'on veut éviter chez quelqu'un qui n'ouvrira jamais le
        # gestionnaire des tâches.
        os._exit(0)


def servir(port: int):
    """
    Le serveur, sur le fil principal d'un processus dédié.

    Deux réglages qui ne s'improvisent pas :

      - `global.developmentMode` doit être mis à False AVANT le port, sinon
        Streamlit refuse : « server.port does not work when global.developmentMode
        is true ». `load_config_options` est la seule API qui garantit l'ordre.
      - Streamlit cherche `.streamlit/config.toml` dans le dossier COURANT.
        Lancé depuis un raccourci du bureau, il ne trouvait pas le nôtre et le
        thème repassait sur celui du système : d'où le `chdir`.
    """
    os.chdir(racine())
    if str(racine()) not in sys.path:
        sys.path.insert(0, str(racine()))

    from streamlit.web import bootstrap

    options = {
        "global.developmentMode": False,
        "server.port": port,
        "server.headless": True,
        "server.fileWatcherType": "none",
        "browser.gatherUsageStats": False,
    }
    script = str(racine() / "app" / "main.py")
    bootstrap.load_config_options(flag_options=options)
    sys.argv = ["streamlit", "run", script]
    bootstrap.run(script, False, [], options)


def main():
    # Le même exe joue deux rôles : la fenêtre, ou le serveur qu'elle lance.
    if "--serveur" in sys.argv:
        port = PORT
        if "--port" in sys.argv:
            port = int(sys.argv[sys.argv.index("--port") + 1])
        servir(port)
        return
    Fenetre().demarrer()


if __name__ == "__main__":
    main()
