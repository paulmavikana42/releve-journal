import { describe, it, expect } from "vitest";
import { Decimal } from "./decimal";
import { balanceDeals, CsvError, num, Outcome, parse, reconcile, side, when } from "./csvimport";
import { Direction, OpenTrade, Position } from "./models";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

// ------------------------------------------------------------------- nombres

describe("nombres de tous les dialectes", () => {
  it.each([
    ["1234.56", "1234.56"],
    ["1 234.56", "1234.56"], // espace insécable
    ["1,234.56", "1234.56"], // anglo : virgule = milliers
    ["1 234,56", "1234.56"], // français : virgule = décimale
    ["1234,56", "1234.56"],
    ["-0.4", "-0.4"],
    ["(12.30)", "-12.30"], // comptable : parenthèses = négatif
    ["0", "0"],
  ])("num(%s) = %s", (brut, attendu) => {
    expect((num(brut) as Decimal).eq(attendu)).toBe(true);
  });

  it("la virgule à trois chiffres est un séparateur de milliers", () => {
    expect((num("1,234") as Decimal).eq("1234")).toBe(true);
    expect((num("1,50") as Decimal).eq("1.50")).toBe(true);
    expect((num("1,5") as Decimal).eq("1.5")).toBe(true);
  });

  it.each(["", "   ", "-", "n/a", "market", null])(
    "une case vide ne vaut pas zéro : %s",
    (vide) => {
      expect(num(vide as string | null)).toBeNull();
    },
  );
});

// --------------------------------------------------------------------- dates

describe("dates de tous les terminaux", () => {
  it.each([
    "2026.07.22 14:05:00",
    "2026.07.22 14:05",
    "2026-07-22 14:05:00",
    "22/07/2026 14:05",
    "22.07.2026 14:05:00",
    "2026-07-22T14:05:00",
  ])("when(%s) -> 2026-07-22", (brut) => {
    const d = when(brut)!;
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth() + 1).toBe(7);
    expect(d.getUTCDate()).toBe(22);
  });

  it("le jour précède le mois (03/07 = 3 juillet)", () => {
    expect(when("03/07/2026")!.getUTCMonth() + 1).toBe(7);
  });
});

// ------------------------------------------------------------------- colonnes

const MT5_FR =
  "Ticket;Symbole;Type;Volume;Heure d'ouverture;Prix d'ouverture;" +
  "Heure de clôture;Prix de clôture;S/L;T/P;Commission;Swap;Profit;Balance\n" +
  "88210912;UKOUSD;buy;1.00;2026.07.19 10:30;71.40;2026.07.22 14:05;73.32;" +
  "70.20;;0;-4,00;1 925,20;101 925,20\n";

const CTRADER_EN =
  "Deal ID,Symbol,Side,Quantity,Opening time,Entry price,Closing time," +
  "Exit price,Stop loss,Net profit\n" +
  "88213047,USDJPY,Sell,0.50,2026-07-21 08:15:00,157.80,,,158.60,\n";

describe("export MT5 français", () => {
  it("lit les colonnes FR, virgule décimale, séparateur ;", () => {
    const cf = parse(enc(MT5_FR));
    expect(cf.delimiter).toBe(";");
    expect(cf.missing).toEqual([]);
    const r = cf.rows[0]!;
    expect(r.ticket).toBe("88210912");
    expect(r.symbol).toBe("UKOUSD");
    expect(r.direction).toBe(Direction.BUY);
    expect(r.volume.eq("1.00")).toBe(true);
    expect(r.open_time!.getTime()).toBe(Date.UTC(2026, 6, 19, 10, 30));
    expect(r.close_price!.eq("73.32")).toBe(true);
    expect(r.profit!.eq("1925.20")).toBe(true);
    expect(r.is_closed).toBe(true);
    expect(cf.has_balance).toBe(true);
  });
});

describe("export cTrader anglais encore ouvert", () => {
  it("sans heure NI prix de clôture, le trade est ouvert", () => {
    const cf = parse(enc(CTRADER_EN));
    expect(cf.delimiter).toBe(",");
    const r = cf.rows[0]!;
    expect(r.direction).toBe(Direction.SELL);
    expect(r.sl!.eq("158.60")).toBe(true);
    expect(r.is_closed).toBe(false);
    expect(cf.has_balance).toBe(false);
  });
});

describe("robustesse du parse", () => {
  it("une ligne de total ne fait pas tomber le fichier", () => {
    const cf = parse(enc(MT5_FR + "Total;;;;;;;;;;;;2 355,70;\n"));
    expect(cf.rows.length).toBe(1);
    expect(cf.skipped.length).toBe(1);
    expect(cf.skipped[0]![0]).toBe(3);
  });

  it("un fichier sans colonnes reconnaissables demande un mapping", () => {
    const cf = parse(enc("col1;col2;col3\n88210912;UKOUSD;71.40\n"));
    expect(cf.missing.length).toBeGreaterThan(0);
    expect(cf.rows).toEqual([]);
  });

  it("le mapping manuel débloque le fichier", () => {
    const cf = parse(enc("col1;col2;col3;col4;col5\n88210912;UKOUSD;buy;71.40;2026.07.19 10:30\n"), {
      ticket: "col1",
      symbol: "col2",
      direction: "col3",
      open_price: "col4",
      open_time: "col5",
    });
    expect(cf.missing).toEqual([]);
    expect(cf.rows[0]!.ticket).toBe("88210912");
    expect(cf.rows[0]!.open_price.eq("71.40")).toBe(true);
  });

  it("UTF-16 avec BOM", () => {
    const bom = new Uint8Array([0xff, 0xfe]);
    const body = new Uint8Array(Buffer.from(MT5_FR, "utf16le"));
    const bytes = new Uint8Array(bom.length + body.length);
    bytes.set(bom, 0);
    bytes.set(body, bom.length);
    const cf = parse(bytes);
    expect(cf.rows[0]!.symbol).toBe("UKOUSD");
  });

  it("une ligne sans heure d'ouverture est refusée", () => {
    const texte = "Ticket;Symbol;Type;Volume;Open Time;Open Price\n88210912;UKOUSD;buy;1.00;;71.40\n";
    expect(() => parse(enc(texte))).toThrow(CsvError);
  });
});

// -------------------------------------------------------------- rapprochement

function position(ticket = "88210912", account = "14124899"): Position {
  return new Position({
    position_id: ticket,
    account_id: account,
    symbol: "UKOUSD",
    direction: Direction.BUY,
    volume: new Decimal("1"),
    open_time: new Date(Date.UTC(2026, 6, 19, 10, 30)),
    open_price: new Decimal("71.40"),
    close_time: new Date(Date.UTC(2026, 6, 22, 14, 5)),
    close_price: new Decimal("73.32"),
    commission: new Decimal("0"),
    swap: new Decimal("0"),
    profit_gross: new Decimal("1920"),
  });
}

describe("rapprochement par ticket", () => {
  it("un ticket déjà importé est ignoré sans bruit", () => {
    const cf = parse(enc(MT5_FR));
    const connues = new Map([["14124899:88210912", position()]]);
    expect(reconcile(cf, connues, new Map())[0]!.outcome).toBe(Outcome.KNOWN);
  });

  it("un ticket déclaré ouvert est clôturé par son jumeau", () => {
    const cf = parse(enc(MT5_FR));
    const ouvert = new OpenTrade({
      ticket: "88210912",
      symbol: "UKOUSD",
      direction: Direction.BUY,
      volume: new Decimal("1"),
      open_time: new Date(Date.UTC(2026, 6, 19, 10, 30)),
      open_price: new Decimal("71.40"),
      stop: new Decimal("70.20"),
    });
    const m = reconcile(cf, new Map(), new Map([["88210912", ["idee-1", ouvert] as [string, OpenTrade]]]))[0]!;
    expect(m.outcome).toBe(Outcome.CLOSES);
    expect(m.idea_id).toBe("idee-1");
  });

  it("un ticket inconnu et encore ouvert est signalé NEW_OPEN", () => {
    const cf = parse(enc(CTRADER_EN));
    expect(reconcile(cf, new Map(), new Map())[0]!.outcome).toBe(Outcome.NEW_OPEN);
  });

  it("la colonne solde alimente la courbe du drawdown", () => {
    const cf = parse(enc(MT5_FR));
    const deals = balanceDeals(cf);
    expect(deals.length).toBe(1);
    expect(deals[0]!.balance.eq("101925.20")).toBe(true);
  });

  it("sans colonne solde, aucune courbe fabriquée", () => {
    const cf = parse(enc(CTRADER_EN));
    expect(balanceDeals(cf)).toEqual([]);
  });
});
