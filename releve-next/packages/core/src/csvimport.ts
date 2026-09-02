// Import CSV, rapproché PAR NUMÉRO DE TICKET — port de core/csvimport.py.
//
// Le rapprochement se fait sur l'égalité du ticket, jamais par ressemblance :
// l'import est donc IDEMPOTENT par construction. Tourne CÔTÉ SERVEUR.
import { Decimal } from "./decimal";
import { Deal, Direction, ExitReason, OpenTrade, Position } from "./models";

const NBSP = " ";

export class CsvError extends Error {}

// ---------------------------------------------------------------- les colonnes

const SYNONYMS: Record<string, readonly string[]> = {
  ticket: ["ticket", "position", "positionid", "position id", "deal", "dealid", "deal id", "order", "orderid", "order id", "id", "numero", "n", "no", "tradeid", "trade id"],
  symbol: ["symbol", "symbole", "instrument", "paire", "pair", "market", "produit"],
  direction: ["type", "sens", "side", "direction", "action", "operation", "buysell", "buy sell", "trade type", "typedetransaction"],
  volume: ["volume", "lots", "lot", "size", "quantity", "quantite", "qty", "amount", "units"],
  open_time: ["open time", "opentime", "heure d ouverture", "date d ouverture", "ouverture", "entry time", "entrytime", "time", "heure", "date", "opening time", "open date", "opened"],
  open_price: ["open price", "openprice", "prix d ouverture", "entry price", "entryprice", "entree", "entry", "price", "prix", "opening price"],
  close_time: ["close time", "closetime", "heure de cloture", "date de cloture", "cloture", "exit time", "exittime", "closing time", "close date", "closed"],
  close_price: ["close price", "closeprice", "prix de cloture", "exit price", "exitprice", "sortie", "exit", "closing price"],
  sl: ["sl", "s l", "stop loss", "stoploss", "stop"],
  tp: ["tp", "t p", "take profit", "takeprofit", "objectif"],
  commission: ["commission", "commissions", "frais", "fee", "fees"],
  swap: ["swap", "swaps", "rollover", "interet"],
  profit: ["profit", "pnl", "p l", "net profit", "gross profit", "resultat", "gain", "net", "profit usd"],
  balance: ["balance", "solde", "equity", "account balance"],
  account: ["account", "compte", "login", "account id", "numero de compte"],
  comment: ["comment", "commentaire", "note", "notes"],
};

const REQUIRED = ["ticket", "symbol", "direction", "open_price"] as const;

export function normalize(header: string): string {
  let s = (header ?? "").trim().toLowerCase();
  const accents: [string, string][] = [
    ["é", "e"], ["è", "e"], ["ê", "e"], ["à", "a"], ["â", "a"],
    ["î", "i"], ["ï", "i"], ["ô", "o"], ["û", "u"], ["ù", "u"], ["ç", "c"],
  ];
  for (const [a, b] of accents) s = s.split(a).join(b);
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  return s.replace(/\s+/g, " ");
}

export function guessMapping(headers: readonly string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  const normalized = headers.map((h) => [h, normalize(h)] as const);

  // 1re passe : correspondance EXACTE
  for (const [field, alts] of Object.entries(SYNONYMS)) {
    for (const [original, norm] of normalized) {
      if (used.has(original)) continue;
      if (alts.includes(norm)) {
        mapping[field] = original;
        used.add(original);
        break;
      }
    }
  }
  // 2e passe : intitulé CONTENANT un synonyme (> 3 lettres)
  for (const [field, alts] of Object.entries(SYNONYMS)) {
    if (field in mapping) continue;
    for (const [original, norm] of normalized) {
      if (used.has(original)) continue;
      if (alts.some((a) => a.length > 3 && norm.includes(a))) {
        mapping[field] = original;
        used.add(original);
        break;
      }
    }
  }
  // Cas MT5 : deux colonnes Time / Price consécutives, la 2e est la clôture.
  const plain = normalized.filter(([, n]) => n === "time" || n === "heure").map(([h]) => h);
  if (plain.length >= 2 && !("close_time" in mapping)) mapping["close_time"] = plain[1]!;
  const prices = normalized.filter(([, n]) => n === "price" || n === "prix").map(([h]) => h);
  if (prices.length >= 2 && !("close_price" in mapping)) mapping["close_price"] = prices[1]!;

  return mapping;
}

// ------------------------------------------------------------------ conversion

export function num(s: string | number | Decimal | null | undefined): Decimal | null {
  if (s === null || s === undefined) return null;
  if (typeof s === "number") return new Decimal(String(s));
  if (s instanceof Decimal) return s;
  let t = String(s).split(NBSP).join("").replace(/ /g, "").replace(/%/g, "").trim();
  if (!t || ["-", "n/a", "na", "none", "null", "market"].includes(t.toLowerCase())) return null;

  const neg = t.startsWith("(") && t.endsWith(")");
  if (neg) t = t.slice(1, -1);

  const hasComma = t.includes(",");
  const hasDot = t.includes(".");
  if (hasComma && hasDot) {
    t = t.lastIndexOf(".") > t.lastIndexOf(",") ? t.split(",").join("") : t.split(".").join("").split(",").join(".");
  } else if (hasComma) {
    const li = t.lastIndexOf(",");
    const entier = t.slice(0, li);
    const frac = t.slice(li + 1);
    const milliers = frac.length === 3 && !entier.includes(",") && entier !== "";
    t = milliers ? t.split(",").join("") : t.split(",").join(".");
  }

  let v: Decimal;
  try {
    v = new Decimal(t);
    if (v.isNaN()) return null;
  } catch {
    return null;
  }
  return neg ? v.negated() : v;
}

// Formats d'horodatage : jour-avant-mois pour les slash (convention MT4/MT5 FR).
type DtPat = { re: RegExp; ymd: boolean };
const DT_PATS: DtPat[] = [
  // %Y[.-/]%m[.-/]%d, séparateur T ou espace, secondes optionnelles
  { re: /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/, ymd: true },
  // %d[./]%m[./]%Y
  { re: /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/, ymd: false },
  // %d/%m/%y (2 chiffres) AVEC heure
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{2})[ ](\d{1,2}):(\d{2})(?::(\d{2}))?$/, ymd: false },
];

export function when(s: string | null | undefined): Date | null {
  let t = String(s ?? "").split(NBSP).join(" ").trim();
  if (!t) return null;
  t = t.replace(/\s+/g, " ").replace(/Z/g, "").split("+")[0]!.trim();
  t = t.replace(/\.\d+$/, ""); // millisecondes

  for (const { re, ymd } of DT_PATS) {
    const m = t.match(re);
    if (!m) continue;
    let y: number, mo: number, d: number;
    if (ymd) {
      y = +m[1]!;
      mo = +m[2]!;
      d = +m[3]!;
    } else {
      d = +m[1]!;
      mo = +m[2]!;
      y = +m[3]!;
      if (y < 100) y += y < 70 ? 2000 : 1900;
    }
    const h = m[4] ? +m[4] : 0;
    const mi = m[5] ? +m[5] : 0;
    const se = m[6] ? +m[6] : 0;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
    if (dt.getUTCMonth() + 1 !== mo || dt.getUTCDate() !== d) return null; // overflow
    return dt;
  }
  return null;
}

const BUY = new Set(["buy", "achat", "long", "b", "0", "buy limit", "buy stop", "acheter"]);
const SELL = new Set(["sell", "vente", "short", "s", "1", "sell limit", "sell stop", "vendre"]);

export function side(s: string | null | undefined): Direction | null {
  const t = normalize(String(s ?? ""));
  if (BUY.has(t) || t.startsWith("buy") || t.startsWith("achat") || t.startsWith("long")) return Direction.BUY;
  if (SELL.has(t) || t.startsWith("sell") || t.startsWith("vente") || t.startsWith("short")) return Direction.SELL;
  return null;
}

function decodeBytes(raw: Uint8Array): string {
  if (raw[0] === 0xff && raw[1] === 0xfe) return new TextDecoder("utf-16le").decode(raw);
  if (raw[0] === 0xfe && raw[1] === 0xff) return new TextDecoder("utf-16be").decode(raw);
  const utf8 = new TextDecoder("utf-8").decode(raw);
  return utf8.charCodeAt(0) === 0xfeff ? utf8.slice(1) : utf8;
}

function sniff(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0, "|": 0 };
  for (const ch of head) if (ch in counts) counts[ch]! += 1;
  let best = ",";
  let bestN = 0;
  for (const [d, n] of Object.entries(counts)) if (n > bestN) { best = d; bestN = n; }
  return bestN ? best : ",";
}

function readCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; started = true; continue; }
    if (ch === delim) { row.push(field); field = ""; started = true; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; started = false; continue; }
    if (ch === "\r") continue;
    field += ch;
    started = true;
  }
  if (started || field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ------------------------------------------------------------------- résultat

export interface CsvRowInit {
  ticket: string;
  symbol: string;
  direction: Direction;
  open_price: Decimal;
  volume?: Decimal;
  open_time?: Date | null;
  close_time?: Date | null;
  close_price?: Decimal | null;
  sl?: Decimal | null;
  tp?: Decimal | null;
  commission?: Decimal;
  swap?: Decimal;
  profit?: Decimal | null;
  balance?: Decimal | null;
  account_id?: string;
  comment?: string;
  line?: number;
}

export class CsvRow {
  ticket: string;
  symbol: string;
  direction: Direction;
  open_price: Decimal;
  volume: Decimal;
  open_time: Date | null;
  close_time: Date | null;
  close_price: Decimal | null;
  sl: Decimal | null;
  tp: Decimal | null;
  commission: Decimal;
  swap: Decimal;
  profit: Decimal | null;
  balance: Decimal | null;
  account_id: string;
  comment: string;
  line: number;

  constructor(init: CsvRowInit) {
    this.ticket = init.ticket;
    this.symbol = init.symbol;
    this.direction = init.direction;
    this.open_price = init.open_price;
    this.volume = init.volume ?? new Decimal(0);
    this.open_time = init.open_time ?? null;
    this.close_time = init.close_time ?? null;
    this.close_price = init.close_price ?? null;
    this.sl = init.sl ?? null;
    this.tp = init.tp ?? null;
    this.commission = init.commission ?? new Decimal(0);
    this.swap = init.swap ?? new Decimal(0);
    this.profit = init.profit ?? null;
    this.balance = init.balance ?? null;
    this.account_id = init.account_id ?? "";
    this.comment = init.comment ?? "";
    this.line = init.line ?? 0;
  }

  /** Close si elle porte une heure ET un prix de clôture. */
  get is_closed(): boolean {
    return this.close_time !== null && this.close_price !== null;
  }

  to_position(accountId = ""): Position {
    return new Position({
      position_id: this.ticket,
      account_id: accountId || this.account_id,
      symbol: this.symbol,
      direction: this.direction,
      volume: this.volume,
      open_time: this.open_time as Date,
      open_price: this.open_price,
      close_time: this.close_time as Date,
      close_price: this.close_price ?? new Decimal(0),
      commission: this.commission,
      swap: this.swap,
      profit_gross: this.profit ?? new Decimal(0),
      sl_final: this.sl,
      tp_final: this.tp,
      sl_at_placement: null, // un CSV n'a pas de table Ordres
      exit_reason: exitReason(this.comment),
    });
  }

  to_open_trade(accountId = ""): OpenTrade {
    return new OpenTrade({
      ticket: this.ticket,
      symbol: this.symbol,
      direction: this.direction,
      volume: this.volume,
      open_time: this.open_time as Date,
      open_price: this.open_price,
      account_id: accountId || this.account_id,
      stop: this.sl,
      take_profit: this.tp,
      note: this.comment,
    });
  }
}

function exitReason(comment: string | null | undefined): ExitReason {
  const m = (comment ?? "").trim().match(/\[?(sl|tp)\b/i);
  if (m) return m[1]!.toLowerCase() === "sl" ? ExitReason.STOP_LOSS : ExitReason.TAKE_PROFIT;
  return comment ? ExitReason.MANUAL : ExitReason.UNKNOWN;
}

export class CsvFile {
  rows: CsvRow[] = [];
  headers: string[] = [];
  mapping: Record<string, string> = {};
  delimiter = ",";
  account_id = "";
  skipped: [number, string][] = [];
  has_balance = false;

  get missing(): string[] {
    return REQUIRED.filter((f) => !(f in this.mapping));
  }
  get closed(): CsvRow[] {
    return this.rows.filter((r) => r.is_closed);
  }
  get still_open(): CsvRow[] {
    return this.rows.filter((r) => !r.is_closed);
  }
}

export function parse(source: Uint8Array | string, mapping?: Record<string, string> | null): CsvFile {
  const text = typeof source === "string" ? source : decodeBytes(source);
  if (!text.trim()) throw new CsvError("Fichier vide.");

  const delim = sniff(text);
  const lignes = readCsv(text, delim).filter((r) => r.some((c) => (c ?? "").trim()));
  if (!lignes.length) throw new CsvError("Aucune ligne exploitable.");

  // L'en-tête n'est pas toujours la 1re ligne : on prend la première dont au
  // moins trois cellules ressemblent à des intitulés connus.
  let headIdx = 0;
  let headers = lignes[0]!;
  let guessed: Record<string, string> = {};
  let found = false;
  for (let i = 0; i < Math.min(10, lignes.length); i++) {
    const g = guessMapping(lignes[i]!);
    if (Object.keys(g).length >= 3) {
      headIdx = i;
      headers = lignes[i]!;
      guessed = g;
      found = true;
      break;
    }
  }
  if (!found) guessed = guessMapping(lignes[0]!);

  const map = mapping ? { ...mapping } : guessed;
  const out = new CsvFile();
  out.headers = [...headers];
  out.mapping = map;
  out.delimiter = delim;

  if (out.missing.length) return out; // l'UI proposera le mapping manuel

  const idx: Record<string, number> = {};
  for (const [f, h] of Object.entries(map)) {
    const i = headers.indexOf(h);
    if (i >= 0) idx[f] = i;
  }

  const cell = (row: string[], f: string): string | null => {
    const i = idx[f];
    if (i === undefined || i >= row.length) return null;
    return (row[i] ?? "").trim();
  };

  for (let k = headIdx + 1; k < lignes.length; k++) {
    const row = lignes[k]!;
    const n = k + 1; // numéro de ligne 1-indexé dans les lignes filtrées
    const ticket = (cell(row, "ticket") ?? "").trim();
    if (!ticket || !/^[0-9A-Za-z\-_]{3,}$/.test(ticket)) {
      out.skipped.push([n, "pas de numéro de ticket exploitable"]);
      continue;
    }
    const sym = (cell(row, "symbol") ?? "").toUpperCase();
    const d = side(cell(row, "direction"));
    const op = num(cell(row, "open_price"));
    if (!sym || d === null || op === null) {
      out.skipped.push([n, "symbole, sens ou prix d'entrée illisible"]);
      continue;
    }
    const ot = when(cell(row, "open_time"));
    if (ot === null) {
      out.skipped.push([n, "heure d'ouverture illisible ou absente"]);
      continue;
    }

    const bal = num(cell(row, "balance"));
    if (bal !== null) out.has_balance = true;

    out.rows.push(
      new CsvRow({
        ticket,
        symbol: sym,
        direction: d,
        open_price: op,
        volume: num(cell(row, "volume")) ?? new Decimal(0),
        open_time: ot,
        close_time: when(cell(row, "close_time")),
        close_price: num(cell(row, "close_price")),
        sl: num(cell(row, "sl")),
        tp: num(cell(row, "tp")),
        commission: num(cell(row, "commission")) ?? new Decimal(0),
        swap: num(cell(row, "swap")) ?? new Decimal(0),
        profit: num(cell(row, "profit")),
        balance: bal,
        account_id: (cell(row, "account") ?? "").trim(),
        comment: cell(row, "comment") ?? "",
        line: n,
      }),
    );
  }

  if (!out.rows.length) {
    throw new CsvError(
      "Aucune ligne de trade lisible. Colonnes minimales : ticket, symbole, sens, prix d'entrée.",
    );
  }

  const comptes = new Set(out.rows.map((r) => r.account_id).filter((a) => a));
  out.account_id = comptes.size === 1 ? [...comptes][0]! : "";
  return out;
}

// --------------------------------------------------------- le rapprochement

export enum Outcome {
  CLOSES = "cloture",
  UPDATES = "maj",
  NEW_CLOSED = "nouveau",
  NEW_OPEN = "nouveau_ouvert",
  KNOWN = "connu",
}

export interface Match {
  row: CsvRow;
  outcome: Outcome;
  idea_id: string | null;
  open_trade: OpenTrade | null;
}

export function reconcile(
  csvfile: CsvFile,
  knownPositions: Map<string, Position>,
  pending: Map<string, [string, OpenTrade]>,
): Match[] {
  const knownTickets = new Set([...knownPositions.values()].map((p) => p.position_id));
  const out: Match[] = [];

  for (const r of csvfile.rows) {
    const declared = pending.get(r.ticket);
    if (knownTickets.has(r.ticket)) {
      out.push({ row: r, outcome: Outcome.KNOWN, idea_id: null, open_trade: null });
    } else if (declared && r.is_closed) {
      out.push({ row: r, outcome: Outcome.CLOSES, idea_id: declared[0], open_trade: declared[1] });
    } else if (declared) {
      out.push({ row: r, outcome: Outcome.UPDATES, idea_id: declared[0], open_trade: declared[1] });
    } else if (r.is_closed) {
      out.push({ row: r, outcome: Outcome.NEW_CLOSED, idea_id: null, open_trade: null });
    } else {
      out.push({ row: r, outcome: Outcome.NEW_OPEN, idea_id: null, open_trade: null });
    }
  }
  return out;
}

export function balanceDeals(csvfile: CsvFile, accountId = ""): Deal[] {
  if (!csvfile.has_balance) return [];
  const closed = csvfile.closed
    .filter((r) => r.balance !== null)
    .sort((a, b) => (a.close_time as Date).getTime() - (b.close_time as Date).getTime());
  return closed.map(
    (r) =>
      new Deal({
        deal_id: `csv:${r.ticket}`,
        time: r.close_time as Date,
        symbol: r.symbol,
        deal_type: r.direction,
        entry: "out",
        volume: r.volume,
        price: r.close_price,
        order_id: r.ticket,
        commission: r.commission,
        fee: new Decimal(0),
        swap: r.swap,
        profit: r.profit ?? new Decimal(0),
        balance: r.balance as Decimal,
        comment: r.comment,
        account_id: accountId || r.account_id,
      }),
  );
}
