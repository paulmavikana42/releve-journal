"""
L'éditeur d'écriture par blocs — PARTAGÉ par la thèse macro et l'idée.

Écriture façon Notion : une pile de blocs, texte OU image+légende, dans l'ordre
où l'on écrit. Chaque bloc se déplace (↑↓), se retire (✕) ; une image se
redimensionne en gardant ses proportions (height:auto → jamais déformée). Le
journal ne stocke que le CHEMIN de l'image (archi [P]) — auditable dix ans.

Un bloc :
  {"type": "text",  "text": "...", "bid": "..."}
  {"type": "image", "path": "captures/<owner>/<id>.png", "caption": "...",
   "width": 100, "bid": "..."}

Le `bid` est une identité STABLE par bloc : les widgets sont clés dessus, jamais
sur la position — sinon un réordonnancement laisserait le texte d'un bloc collé
à son ancienne place (piège Streamlit classique).
"""
from __future__ import annotations

import uuid
from pathlib import Path

import streamlit as st

from core import captures as CAP
from core.models import CaptureKind
from . import ui


def new_bid() -> str:
    return uuid.uuid4().hex[:8]


def init(blocks, note: str = "", captures=()) -> list:
    """
    L'état de départ de l'éditeur. Un objet déjà écrit en blocs les reprend ;
    un ancien (note + captures) est converti une fois — un bloc texte pour la
    note, un bloc image par capture. Rien n'est perdu, rien n'est deviné.
    """
    src = []
    if blocks:
        src = [dict(b) for b in blocks]
    else:
        if note:
            src.append({"type": "text", "text": note})
        for a in captures:
            src.append({"type": "image", "path": a.path,
                        "caption": a.caption or ""})
    if not src:
        src = [{"type": "text", "text": ""}]
    for b in src:
        b.setdefault("bid", new_bid())
    return src


def to_note(blocs) -> str:
    """La note « à plat » : concat des blocs texte. Sert la recherche et les
    anciens lecteurs — les blocs restent la source, la note en est le reflet."""
    return "\n\n".join(
        b.get("text", "").strip() for b in blocs
        if b.get("type") == "text" and b.get("text", "").strip())


def editor(bkey: str, owner_type: str, owner_id: str, data_dir):
    """
    L'éditeur, HORS d'un st.form : chaque geste (ajout, déplacement, retrait)
    doit réagir tout de suite, ce qu'un formulaire (qui n'agit qu'à la
    validation) interdit. `owner_type` : "campaign" ou "idea" — il range les
    images sous le bon dossier de captures.
    """
    blocs = st.session_state[bkey]

    for idx, b in enumerate(blocs):
        bid = b.setdefault("bid", new_bid())
        with st.container():
            if b.get("type") == "text":
                blocs[idx]["text"] = st.text_area(
                    f"Paragraphe {idx + 1}", value=b.get("text", ""),
                    key=f"{bkey}_txt_{bid}", height=110,
                    label_visibility="collapsed",
                    placeholder="Écris ici. Ajoute une image à la suite quand tu "
                                "veux, puis continue.")
            else:
                # Taille de l'image (%) : elle SE RÉDUIT en gardant sa forme. Le
                # curseur est au-dessus pour que l'aperçu se mette à jour tout de
                # suite.
                w = st.slider(
                    "Taille de l'image (%)", 25, 100,
                    int(b.get("width", 100)), step=5, key=f"{bkey}_w_{bid}",
                    help="Réduit la largeur ; la hauteur suit, l'image garde "
                         "ses proportions.")
                blocs[idx]["width"] = w
                p = Path(data_dir) / b["path"] if data_dir else None
                uri = ui.data_uri(p) if (p is not None and p.exists()) else None
                if uri:
                    st.markdown(
                        f'<img src="{uri}" style="width:{w}%;height:auto;'
                        f'display:block;margin:4px auto;border-radius:8px">',
                        unsafe_allow_html=True)
                else:
                    st.markdown('<div class="note">image introuvable sur le '
                                'disque</div>', unsafe_allow_html=True)
                st.markdown('<div style="height:6px"></div>',
                            unsafe_allow_html=True)
                blocs[idx]["caption"] = st.text_input(
                    "Légende", value=b.get("caption", ""),
                    key=f"{bkey}_cap_{bid}",
                    placeholder="Légende (facultative)")
                st.markdown('<div style="height:6px"></div>',
                            unsafe_allow_html=True)

            m1, m2, m3, _ = st.columns([1, 1, 1, 6])
            if m1.button("↑", key=f"{bkey}_up_{bid}", disabled=idx == 0,
                         help="Monter ce bloc"):
                blocs[idx - 1], blocs[idx] = blocs[idx], blocs[idx - 1]
                st.rerun()
            if m2.button("↓", key=f"{bkey}_dn_{bid}",
                         disabled=idx == len(blocs) - 1, help="Descendre ce bloc"):
                blocs[idx + 1], blocs[idx] = blocs[idx], blocs[idx + 1]
                st.rerun()
            if m3.button("✕", key=f"{bkey}_rm_{bid}", help="Retirer ce bloc"):
                blocs.pop(idx)
                if not blocs:
                    blocs.append({"type": "text", "text": "", "bid": new_bid()})
                st.rerun()
        ui.rule()

    # --- ajouter à la suite : un paragraphe, ou une image + légende
    ca, cb = st.columns([1, 1])
    if ca.button("＋ Paragraphe", key=f"{bkey}_add_txt",
                 use_container_width=True):
        blocs.append({"type": "text", "text": "", "bid": new_bid()})
        st.rerun()

    with cb:
        with st.popover("＋ Image", use_container_width=True):
            img = st.file_uploader(
                "Image (PNG, JPG, WEBP)", key=f"{bkey}_upimg",
                type=["png", "jpg", "jpeg", "webp", "gif"])
            cap = st.text_input("Légende (facultative)", key=f"{bkey}_upcap",
                                placeholder="Ce que cette image montre")
            if st.button("Insérer à la suite", key=f"{bkey}_ins",
                         type="primary", disabled=img is None):
                try:
                    att = CAP.save(data_dir, owner_type, owner_id, img.name,
                                   img.getvalue(), kind=CaptureKind.THESIS,
                                   caption=cap.strip())
                    blocs.append({"type": "image", "path": att.path,
                                  "caption": cap.strip(), "bid": new_bid()})
                    st.rerun()
                except CAP.CaptureError as e:
                    st.error(str(e))


def _para(corps: str):
    st.markdown(
        f'<div style="font-size:0.98rem;line-height:1.65;margin:0 0 14px 0;'
        f'white-space:pre-wrap">{corps}</div>', unsafe_allow_html=True)


def _image(path: str, caption: str, width, data_dir):
    p = Path(data_dir) / path if data_dir else None
    uri = ui.data_uri(p) if (p is not None and p.exists()) else None
    st.markdown('<div style="height:8px"></div>', unsafe_allow_html=True)
    if uri:
        st.markdown(
            f'<img src="{uri}" style="width:{int(width)}%;height:auto;'
            f'display:block;margin:0 auto;border-radius:8px">',
            unsafe_allow_html=True)
    else:
        st.markdown('<div class="note">image introuvable sur le disque</div>',
                    unsafe_allow_html=True)
    if caption:
        st.markdown(
            f'<div class="note" style="text-align:center;margin:6px 0 14px 0">'
            f'{caption}</div>', unsafe_allow_html=True)


def render(blocs, data_dir):
    """Lecture seule : les blocs dans l'ordre écrit, texte et images entremêlés.
    Aucun widget désactivé — le curseur reste normal, le texte sélectionnable."""
    for b in blocs or []:
        if b.get("type") == "image":
            _image(b.get("path", ""), b.get("caption", ""),
                   b.get("width", 100), data_dir)
        elif b.get("text", "").strip():
            _para(b["text"])
