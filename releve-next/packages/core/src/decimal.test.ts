import { describe, it, expect } from "vitest";
import { Decimal } from "./decimal";

// Test-témoin de la phase 0 : il ne teste pas de logique métier (il n'y en a pas
// encore), il PROUVE que la fondation décimale est en place et configurée comme
// Python — la garantie sur laquelle reposera tout le port du moteur.
describe("fondation décimale (phase 0)", () => {
  it("additionne exactement, sans erreur de flottant", () => {
    expect(new Decimal("0.1").plus("0.2").equals(new Decimal("0.3"))).toBe(true);
  });

  it("rappelle pourquoi le float natif est proscrit ici", () => {
    // 0.1 + 0.2 !== 0.3 en number natif : la raison d'être de decimal.js.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("arrondit en mode PAIR/banquier comme Python (ROUND_HALF_EVEN)", () => {
    // 2.5 -> 2 et 3.5 -> 4 : signature de l'arrondi pair (et non 3 et 4).
    expect(new Decimal("2.5").toDecimalPlaces(0).toString()).toBe("2");
    expect(new Decimal("3.5").toDecimalPlaces(0).toString()).toBe("4");
  });

  it("garde une précision suffisante sur une division (>= 28 significatifs)", () => {
    // 1/3 : on veut au moins 28 chiffres significatifs, comme le contexte Python.
    const tiers = new Decimal(1).div(3).toString().replace("0.", "");
    expect(tiers.length).toBeGreaterThanOrEqual(28);
  });
});
