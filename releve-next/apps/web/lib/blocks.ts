// Éditeur d'écriture par blocs — modèle PARTAGÉ par l'idée (Thesis.blocks) et la
// thèse macro (Campaign.blocks). Miroir fidèle de app/blocks.py côté Streamlit.
//
// Un bloc :
//   { type: "text",  text, bid }
//   { type: "image", path: "<user>/<id>.<ext>", caption, width, bid }
//
// `bid` = identité stable par bloc (les clés React/drag s'appuient dessus, jamais
// la position — sinon un réordonnancement recolle le contenu au mauvais endroit).
// Le journal ne stocke que le CHEMIN de l'image (archi [P]).

export type TextBlock = { type: "text"; text: string; bid: string };
export type ImageBlock = { type: "image"; path: string; caption: string; width: number; bid: string };
export type Block = TextBlock | ImageBlock;

export function newBid(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

/** État de départ : un objet déjà en blocs les reprend ; un ancien (note + captures)
 *  est converti une fois — un bloc texte pour la note, un bloc image par capture. */
export function initBlocks(
  blocks: unknown[] | undefined,
  note = "",
  captures: { path: string; caption?: string }[] = [],
): Block[] {
  let src: Block[] = [];
  if (blocks && blocks.length) {
    src = (blocks as Record<string, unknown>[]).map((b) => normalize(b));
  } else {
    if (note) src.push({ type: "text", text: note, bid: newBid() });
    for (const a of captures) src.push({ type: "image", path: a.path, caption: a.caption ?? "", width: 100, bid: newBid() });
  }
  // bloc vide de départ : bid DÉTERMINISTE — sinon un composant client qui
  // appelle initBlocks au rendu génère un id différent au SSR et à l'hydratation.
  if (!src.length) src = [{ type: "text", text: "", bid: "seed" }];
  return src;
}

function normalize(b: Record<string, unknown>): Block {
  const bid = (b.bid as string) || newBid();
  if (b.type === "image") {
    return { type: "image", path: String(b.path ?? ""), caption: String(b.caption ?? ""), width: Number(b.width ?? 100), bid };
  }
  return { type: "text", text: String(b.text ?? ""), bid };
}

/** La note « à plat » : concat des blocs texte. Reflet pour la recherche et les
 *  anciens lecteurs — les blocs restent la source. */
export function toNote(blocks: Block[]): string {
  return blocks
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Prépare les blocs pour la persistance : on retire tout champ transitoire
 *  (URL signée d'aperçu) et on garde le modèle canonique. */
export function serializeBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) =>
    b.type === "image"
      ? { type: "image", path: b.path, caption: b.caption, width: b.width, bid: b.bid }
      : { type: "text", text: b.text, bid: b.bid },
  );
}

/** Les chemins d'images portés par des blocs — pour signer leurs URLs au rendu. */
export function imagePaths(blocks: unknown[] | undefined): string[] {
  if (!blocks) return [];
  return (blocks as Record<string, unknown>[])
    .filter((b) => b.type === "image" && b.path)
    .map((b) => String(b.path));
}
