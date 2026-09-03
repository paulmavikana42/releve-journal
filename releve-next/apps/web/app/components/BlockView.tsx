import { initBlocks, type Block } from "@/lib/blocks";

// Rendu LECTURE des blocs (fiche idée / thèse) : paragraphes de texte + images à
// leur largeur %. Reprend un ancien contenu (note + captures) via initBlocks.

export default function BlockView({
  blocks,
  note = "",
  urls = {},
}: {
  blocks: unknown[] | undefined;
  note?: string;
  urls?: Record<string, string>;
}) {
  const list: Block[] = initBlocks(blocks, note, []);
  const hasContent = list.some((b) => (b.type === "text" ? b.text.trim() : b.path));
  if (!hasContent) return <div className="note">Rien d&apos;écrit pour l&apos;instant.</div>;

  return (
    <div className="blk-view">
      {list.map((b) =>
        b.type === "text" ? (
          b.text.trim() ? (
            <p key={b.bid} className="blk-p">{b.text}</p>
          ) : null
        ) : (
          <figure key={b.bid} className="blk-fig" style={{ width: `${b.width}%` }}>
            {urls[b.path] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[b.path]} alt={b.caption || "capture"} />
            ) : (
              <div className="blk-img-ph">image indisponible</div>
            )}
            {b.caption && <figcaption className="blk-cap-view">{b.caption}</figcaption>}
          </figure>
        ),
      )}
    </div>
  );
}
