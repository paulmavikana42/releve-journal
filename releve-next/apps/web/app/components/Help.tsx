// Petite infobulle « ? » réutilisable (façon ui.qmark de Streamlit) : un rond
// discret qui révèle une explication au survol. Rendu serveur, sans JS.
export default function Help({ tip }: { tip: string }) {
  return (
    <span className="help" data-tip={tip} role="img" aria-label={tip}>
      ?
    </span>
  );
}
