#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
    echo "Premier lancement : preparation de l'environnement..."
    python3 -m venv .venv
    .venv/bin/pip install --upgrade pip -q
    .venv/bin/pip install -r requirements.txt -q
fi
.venv/bin/python -m streamlit run app/main.py
