import { NextResponse } from "next/server";
import { parser, csv } from "@releve/core";
import { currentUser } from "@/app/journal/data";

// Parsing MT5/CSV — TOUJOURS côté serveur (jamais dans le navigateur). Cette
// première tranche PARSE et renvoie un résumé ; la persistance (rapprochement
// par ticket → events) viendra dans une tranche suivante.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user } = await currentUser();
  if (!user) return NextResponse.json({ error: "non authentifié" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "aucun fichier" }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());

  // 1) rapport HTML MT5 ?
  try {
    const report = parser.parseReport(bytes);
    return NextResponse.json({
      kind: "mt5-html",
      account: report.account_id,
      positions: report.positions.length,
      deals: report.deals.length,
    });
  } catch (e) {
    if (!(e instanceof parser.ParseError)) {
      return NextResponse.json({ error: String(e) }, { status: 400 });
    }
  }

  // 2) sinon, CSV (MT4/MT5/cTrader/générique)
  try {
    const cf = csv.parse(bytes);
    return NextResponse.json({
      kind: "csv",
      closed: cf.closed.length,
      still_open: cf.still_open.length,
      has_balance: cf.has_balance,
      missing: cf.missing,
    });
  } catch (e) {
    return NextResponse.json({ error: `Fichier non reconnu : ${String(e)}` }, { status: 400 });
  }
}
