"use client";

import { useEffect, useRef } from "react";

// Zone de texte qui grandit vers le BAS avec le contenu (façon Notion), au lieu
// de rester une petite boîte à hauteur fixe. Utilisable dans les <form> serveur
// (non contrôlée : defaultValue). Empêche aussi le débordement à droite des mots
// très longs.
export default function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  };
  useEffect(resize, []);
  const { style, onInput, rows, ...rest } = props;
  return (
    <textarea
      ref={ref}
      rows={rows ?? 2}
      onInput={(e) => {
        resize();
        onInput?.(e);
      }}
      style={{ resize: "none", overflow: "hidden", overflowWrap: "anywhere", ...style }}
      {...rest}
    />
  );
}
