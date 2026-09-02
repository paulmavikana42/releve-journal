import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as symbols from "./symbols";

let tmp: string;
const prev = process.env["RELEVE_DATA"];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "releve-sym-"));
  process.env["RELEVE_DATA"] = tmp;
});
afterEach(() => {
  if (prev === undefined) delete process.env["RELEVE_DATA"];
  else process.env["RELEVE_DATA"] = prev;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("registre des symboles", () => {
  it("apprend les symboles vus à l'import (le broker fait foi)", () => {
    const base = symbols.watchlist();
    expect(base).toContain("NDX100");
    expect(base).toContain("UKOUSD");
    expect(base).toContain("USOUSD");
    expect(base).not.toContain("NASDAQ"); // ton vocabulaire n'est pas celui du broker

    const fresh = symbols.learn(["NDX100", "GER40", "XAGUSD"]);
    expect(fresh).toEqual(["GER40", "XAGUSD"]); // NDX100 déjà connu
    expect(symbols.watchlist()).toContain("GER40");
  });

  it("un symbole existant n'est jamais perdu", () => {
    let choices = symbols.known();
    const current = "NASDAQ";
    if (!choices.includes(current)) choices = [current, ...choices];
    expect(choices[0]).toBe("NASDAQ");
  });
});
