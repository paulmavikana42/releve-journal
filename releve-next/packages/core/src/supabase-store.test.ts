// PHASE 6 — la couche données. Preuve que le journal vit aussi bien dans une
// table `events` (Supabase) que dans un fichier : même contrat, même rejeu, même
// état. Aucune UI, aucun credential — backend mocké.
import { describe, it, expect } from "vitest";
import { Decimal } from "./decimal";
import { Store, EventRecord, encode, decode } from "./store";
import { SupabaseStore } from "./supabase-store";
import {
  MemoryBackend, eventToRow, rowToEvent, supabaseBackend,
  EventRow, SupabaseClientLike, PostgrestError,
} from "./events-backend";
import { Direction, RiskSource, Thesis } from "./models";

const D = (s: string) => new Decimal(s);

function petitJournal(store: Store) {
  const idea = store.create_thesis(
    new Thesis({ instrument: "BTCUSD", direction: Direction.SELL, entry_planned: D("63000"),
      stop_initial: D("63600"), risk_pct: D("0.6"), conviction: 4, risk_source: RiskSource.COMPUTED }),
    { label: "Short BTC", account_id: "u-acct" });
  return idea;
}

describe("PHASE 6 — codec EventRecord ↔ ligne de table", () => {
  it("aller-retour fidèle, y compris payload encodé et drapeau demo", () => {
    const ev: EventRecord = {
      v: 1, ts: "2026-07-07T12:00:00.000Z", type: "thesis_created",
      payload: encode({ id: "abc", when: new Date(Date.UTC(2026, 6, 7, 12)), risk: D("0.6") }),
      demo: true,
    };
    const row = eventToRow(ev, "user-42");
    expect(row.user_id).toBe("user-42");
    expect(row.demo).toBe(true);
    const back = rowToEvent(row);
    expect(back).toEqual(ev);
    // le payload reste décodable en Decimal/Date après le tour
    const p = decode(back.payload) as { risk: Decimal; when: Date };
    expect(p.risk.eq("0.6")).toBe(true);
    expect(p.when.getUTCHours()).toBe(12);
  });

  it("un événement non-demo n'emporte pas le champ demo", () => {
    const ev: EventRecord = { v: 1, ts: "t", type: "x", payload: {} };
    expect(rowToEvent(eventToRow(ev)).demo).toBeUndefined();
    expect(eventToRow(ev).demo).toBe(false);
  });
});

describe("PHASE 6 — SupabaseStore : event-sourcing sur backend", () => {
  it("open sur backend vide → journal vide", async () => {
    const store = await SupabaseStore.open(new MemoryBackend());
    expect(store.events()).toEqual([]);
    expect(store.load().ideas.size).toBe(0);
  });

  it("une mutation est en attente, flush la persiste, la réouverture la relit", async () => {
    const backend = new MemoryBackend();
    const store = await SupabaseStore.open(backend);
    const idea = petitJournal(store);
    expect(store.dirty).toBe(true);
    // visible en mémoire tout de suite…
    expect(store.load().ideas.get(idea.id)!.label).toBe("Short BTC");
    // …pas encore côté backend
    expect((await backend.list()).length).toBe(0);

    await store.flush();
    expect(store.dirty).toBe(false);
    expect((await backend.list()).length).toBe(1);

    // une NOUVELLE session rejoue depuis le backend et retrouve l'idée
    const rechargé = await SupabaseStore.open(backend);
    expect(rechargé.load().ideas.get(idea.id)!.label).toBe("Short BTC");
  });

  it("flush n'insère qu'une fois (tampon vidé au succès)", async () => {
    const backend = new MemoryBackend();
    const store = await SupabaseStore.open(backend);
    petitJournal(store);
    await store.flush();
    await store.flush(); // rien à faire
    expect((await backend.list()).length).toBe(1);
  });

  it("un backend qui échoue garde le tampon (réessayable)", async () => {
    let fail = true;
    const backend = {
      async list() { return [] as EventRecord[]; },
      async appendMany() { if (fail) throw new Error("réseau"); },
    };
    const store = await SupabaseStore.open(backend);
    petitJournal(store);
    await expect(store.flush()).rejects.toThrow("réseau");
    expect(store.dirty).toBe(true); // rien perdu
    fail = false;
    await store.flush(); // le retry passe
    expect(store.dirty).toBe(false);
  });
});

describe("PHASE 6 — parité fichier ⇄ table & conversion JSONL→events", () => {
  it("le même journal rejoué depuis un backend donne le MÊME état qu'en mémoire", async () => {
    // 1) construit un journal en mémoire (la vérité de référence)
    const ref = new Store();
    const idea = petitJournal(ref);
    const refState = ref.load();

    // 2) convertit ses événements en lignes puis les rejoue via un backend
    //    (c'est exactement la conversion JSONL → table events)
    const rows: EventRow[] = ref.events().map((e) => eventToRow(e, "user-1"));
    const backend = new MemoryBackend(rows.map(rowToEvent), "user-1");
    const cloud = await SupabaseStore.open(backend);
    const cloudState = cloud.load();

    expect(cloudState.ideas.size).toBe(refState.ideas.size);
    const a = cloudState.ideas.get(idea.id)!;
    const b = refState.ideas.get(idea.id)!;
    expect(a.label).toBe(b.label);
    expect(a.account_id).toBe(b.account_id);
    expect(a.thesis!.stop_initial!.eq(b.thesis!.stop_initial!)).toBe(true);
  });
});

describe("PHASE 6 — adaptateur Supabase (client mocké)", () => {
  class FakeClient implements SupabaseClientLike {
    rows: EventRow[] = [];
    failInsert: PostgrestError | null = null;
    failSelect: PostgrestError | null = null;
    from() {
      return {
        select: (_c: string) => ({
          order: async (_col: string, _o: { ascending: boolean }) =>
            ({ data: this.failSelect ? null : [...this.rows], error: this.failSelect }),
        }),
        insert: async (rows: EventRow[]) => {
          if (this.failInsert) return { error: this.failInsert };
          this.rows.push(...rows);
          return { error: null };
        },
      };
    }
  }

  it("appendMany écrit des lignes taguées user_id ; list les relit dans l'ordre", async () => {
    const client = new FakeClient();
    const backend = supabaseBackend(client, "user-77");
    const s = new Store();
    petitJournal(s);
    s.create_thesis(new Thesis({ instrument: "NDX100", direction: Direction.SELL }), { label: "2e" });

    await backend.appendMany(s.events());
    expect(client.rows.length).toBe(2);
    expect(client.rows.every((r) => r.user_id === "user-77")).toBe(true);

    const relu = await backend.list();
    expect(relu.map((e) => e.type)).toEqual(["thesis_created", "thesis_created"]);
    // rejouable directement
    const store = Store.fromEvents(relu);
    expect(store.load().ideas.size).toBe(2);
  });

  it("les erreurs Postgrest remontent clairement", async () => {
    const client = new FakeClient();
    const backend = supabaseBackend(client, "u");
    client.failInsert = { message: "duplicate key" };
    await expect(backend.appendMany([{ v: 1, ts: "t", type: "x", payload: {} }])).rejects.toThrow("duplicate key");
    client.failSelect = { message: "jwt expired" };
    await expect(backend.list()).rejects.toThrow("jwt expired");
  });
});
