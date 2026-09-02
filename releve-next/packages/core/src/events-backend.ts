// La couche données : où vivent les événements — port de l'idée du journal JSONL
// vers un backend enfichable (fichier local, ou table Supabase `events`).
//
// Le contrat est minuscule : LISTER (dans l'ordre de rejeu) et AJOUTER. Tout le
// reste — reconstruction de l'état, cloisonnement, métriques — se fait au rejeu,
// identiquement quelle que soit la source. C'est ce qui permet au même moteur de
// tourner sur un fichier (JsonlStore) et sur Supabase (SupabaseStore).
import { EventRecord } from "./store";

/** Une ligne de la table `events` (voir supabase/migrations/0001_events.sql). */
export interface EventRow {
  user_id?: string;
  v: number;
  ts: string;
  type: string;
  payload: unknown; // jsonb — déjà encodé ($dec / $dt)
  demo: boolean;
}

/** EventRecord (journal) → ligne de table. Le payload est déjà JSON-safe. */
export function eventToRow(ev: EventRecord, userId?: string): EventRow {
  const row: EventRow = {
    v: ev.v,
    ts: ev.ts,
    type: ev.type,
    payload: ev.payload,
    demo: ev.demo ?? false,
  };
  if (userId !== undefined) row.user_id = userId;
  return row;
}

/** Ligne de table → EventRecord. On laisse tomber id/user_id (hors journal). */
export function rowToEvent(row: EventRow): EventRecord {
  const ev: EventRecord = { v: row.v, ts: row.ts, type: row.type, payload: row.payload };
  if (row.demo) ev.demo = true;
  return ev;
}

/** Le backend enfichable. `list` renvoie TOUT, dans l'ordre de rejeu. */
export interface EventBackend {
  list(): Promise<EventRecord[]>;
  appendMany(events: EventRecord[]): Promise<void>;
}

/** Backend en mémoire — pour les tests et le rejeu d'un journal déjà chargé. */
export class MemoryBackend implements EventBackend {
  private _rows: EventRow[] = [];
  constructor(seed: EventRecord[] = [], readonly userId = "u") {
    this._rows = seed.map((e) => eventToRow(e, userId));
  }
  async list(): Promise<EventRecord[]> {
    return this._rows.map(rowToEvent);
  }
  async appendMany(events: EventRecord[]): Promise<void> {
    for (const e of events) this._rows.push(eventToRow(e, this.userId));
  }
  /** Vue brute des lignes stockées (tests). */
  rows(): readonly EventRow[] {
    return this._rows;
  }
}

// --------------------------------------------------------------- Supabase
//
// Typé STRUCTURELLEMENT contre @supabase/supabase-js, sans en dépendre : le vrai
// client (fourni par l'app Next) satisfait cette forme. La RLS filtre déjà par
// user_id ; user_id est aussi posé à l'écriture (défaut auth.uid() côté SQL, mais
// on l'écrit explicitement pour être sans ambiguïté).

export interface PostgrestError {
  message: string;
}
export interface SupabaseClientLike {
  from(table: string): {
    select(columns: string): {
      order(
        column: string,
        opts: { ascending: boolean },
      ): PromiseLike<{ data: EventRow[] | null; error: PostgrestError | null }>;
    };
    insert(rows: EventRow[]): PromiseLike<{ error: PostgrestError | null }>;
  };
}

const TABLE = "events";

/** Adaptateur Supabase. `userId` est écrit sur chaque ligne insérée. */
export function supabaseBackend(client: SupabaseClientLike, userId: string): EventBackend {
  return {
    async list(): Promise<EventRecord[]> {
      const { data, error } = await client.from(TABLE).select("*").order("id", { ascending: true });
      if (error) throw new Error(`Supabase list events: ${error.message}`);
      return (data ?? []).map(rowToEvent);
    },
    async appendMany(events: EventRecord[]): Promise<void> {
      if (!events.length) return;
      const rows = events.map((e) => eventToRow(e, userId));
      const { error } = await client.from(TABLE).insert(rows);
      if (error) throw new Error(`Supabase insert events: ${error.message}`);
    },
  };
}
