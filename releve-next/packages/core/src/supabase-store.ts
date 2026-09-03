// Journal adossé à un backend d'événements (Supabase, ou tout EventBackend).
//
// Un journal de trading personnel est PETIT (quelques milliers d'événements au
// plus) : on hydrate TOUT en mémoire à l'ouverture, exactement comme JsonlStore
// relit le fichier entier. Les lectures (load, orphans, campaigns…) restent donc
// SYNCHRONES et héritées telles quelles du Store de base — zéro duplication.
//
// Les écritures, elles, sont asynchrones par nature. On garde l'API synchrone du
// Store (create_thesis, link, …) : chaque mutation s'applique en mémoire ET va
// dans un tampon. `flush()` persiste le tampon. Dans le modèle Next.js (une
// requête = une ou quelques mutations puis réponse), on `await store.flush()`
// avant de répondre — atomicité simple, ordre préservé, durabilité contrôlée.
import { Store, EventRecord, SCHEMA_VERSION, encode } from "./store";
import { EventBackend } from "./events-backend";

export class SupabaseStore extends Store {
  private _pending: EventRecord[] = [];

  private constructor(
    private readonly backend: EventBackend,
    events: EventRecord[],
    demo: boolean,
  ) {
    super({ demo, events });
  }

  /** Hydrate TOUT le journal depuis le backend, puis rend un store prêt. */
  static async open(backend: EventBackend, opts: { demo?: boolean } = {}): Promise<SupabaseStore> {
    const events = await backend.list();
    return new SupabaseStore(backend, events, opts.demo ?? false);
  }

  override append(eventType: string, payload: Record<string, unknown>): EventRecord {
    const ev: EventRecord = {
      v: SCHEMA_VERSION,
      ts: new Date().toISOString(),
      type: eventType,
      payload: encode(payload),
    };
    if (this.demo) ev.demo = true;
    this._events.push(ev); // visible immédiatement pour les lectures de cette session
    this._pending.push(ev); // en attente de persistance
    this._loadCache = null;
    return ev;
  }

  /** Y a-t-il des mutations non encore persistées ? */
  get dirty(): boolean {
    return this._pending.length > 0;
  }

  /** Persiste le tampon dans le backend, dans l'ordre. Vide le tampon au succès. */
  async flush(): Promise<void> {
    if (!this._pending.length) return;
    // Fige ce qu'on persiste MAINTENANT : d'éventuelles mutations arrivées
    // pendant l'await restent en attente pour le prochain flush.
    const n = this._pending.length;
    const batch = this._pending.slice(0, n);
    await this.backend.appendMany(batch);
    // Ne retire QU'APRÈS un succès : une insertion qui échoue garde le tampon,
    // la session reste cohérente et l'appelant peut réessayer.
    this._pending = this._pending.slice(n);
  }
}
