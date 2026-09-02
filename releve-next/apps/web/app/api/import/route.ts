import { NextResponse } from "next/server";
import { parser, csv, Deal, Position } from "@releve/core";
import { currentUser, openStore } from "@/app/journal/data";
import { activeScope, learnSymbols } from "@/app/settings/data";

// Import MT5/CSV — TOUJOURS côté serveur. Parse le fichier, écrit les positions
// et transactions dans le journal (events), de façon IDEMPOTENTE (rapprochement
// par numéro de ticket : réimporter le même fichier n'ajoute rien). L'appariement
// idée↔ticket reste une décision humaine (tranche suivante).
export const runtime = "nodejs";

type Parsed = { kind: string; positions: Position[]; deals: Deal[] };

function parseFile(bytes: Uint8Array): Parsed {
  // 1) rapport HTML MT5 ?
  try {
    const report = parser.parseReport(bytes);
    return { kind: "mt5-html", positions: report.positions, deals: report.deals };
  } catch (e) {
    if (!(e instanceof parser.ParseError)) throw e;
  }
  // 2) sinon CSV (MT4/MT5/cTrader/générique)
  const cf = csv.parse(bytes);
  const acct = cf.account_id;
  const positions = cf.closed.map((r) => r.to_position(acct));
  const deals = csv.balanceDeals(cf, acct);
  return { kind: "csv", positions, deals };
}

export async function POST(request: Request) {
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "non authentifié" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "aucun fichier" }, { status: 400 });
  }

  let parsed: Parsed;
  try {
    parsed = parseFile(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    return NextResponse.json({ error: `Fichier non reconnu : ${String(e)}` }, { status: 400 });
  }

  // Cloisonnement : on tague positions et soldes avec le compte ACTIF (comme la
  // version Streamlit). Sans compte configuré (activeUid ""), on laisse tel quel.
  const { activeUid } = await activeScope(supabase, user.id);
  let positions = parsed.positions;
  let deals = parsed.deals;
  if (activeUid) {
    positions = parsed.positions.map(
      (p) => new Position({ ...p, account_id: activeUid } as unknown as ConstructorParameters<typeof Position>[0]),
    );
    deals = parsed.deals.map(
      (d) => new Deal({ ...d, account_id: activeUid } as unknown as ConstructorParameters<typeof Deal>[0]),
    );
  }

  const store = await openStore(supabase, user.id);
  const fresh = store.import_report(positions, deals);
  await store.flush();

  // Le broker fait foi : les symboles vus entrent dans la watchlist.
  await learnSymbols(supabase, user.id, parsed.positions.map((p) => p.symbol));

  const orphans = store.orphans();

  return NextResponse.json({
    kind: parsed.kind,
    parsed_positions: parsed.positions.length,
    parsed_deals: parsed.deals.length,
    imported_positions: fresh.length, // nouvelles (idempotent : 0 si déjà importées)
    orphans: orphans.length, // positions pas encore rattachées à une idée
  });
}
