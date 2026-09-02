import { describe, it, expect } from "vitest";
import {
  businessDaysBetween,
  businessDaysLeft,
  reviewDue,
  REVIEW_WINDOW_BUSINESS_DAYS,
} from "./clock";

// Dates du domaine construites en UTC (convention : les champs UTC portent
// l'heure-mur serveur), comme le fera le parser.
function d(y: number, mo: number, day: number, h = 10, mi = 0): Date {
  return new Date(Date.UTC(y, mo - 1, day, h, mi));
}

// Port de test_fenetre_de_cinq_jours_ouvres_saute_le_weekend (test_integration.py).
describe("fenêtre de 5 jours ouvrés (saute le week-end)", () => {
  const mercredi = d(2026, 7, 15); // 2026-07-15 est un mercredi

  it("compte les jours ouvrés, pas les calendaires", () => {
    expect(businessDaysBetween(mercredi, d(2026, 7, 17))).toBe(2);
    expect(businessDaysBetween(mercredi, d(2026, 7, 19))).toBe(2); // week-end ignoré
    expect(businessDaysBetween(mercredi, d(2026, 7, 20))).toBe(3);
  });

  it("review_due bascule à 5 jours ouvrés", () => {
    expect(reviewDue(mercredi, d(2026, 7, 21))).toBe(false);
    expect(reviewDue(mercredi, d(2026, 7, 22))).toBe(true); // 5 ouvrés
    expect(businessDaysLeft(mercredi, d(2026, 7, 20))).toBe(2);
  });
});

// Port de test_business_days_between_ne_renvoie_jamais_de_negatif.
describe("business_days_between ne renvoie jamais de négatif", () => {
  const mercredi = d(2026, 7, 15);
  const lendemain = d(2026, 7, 16);

  it("même instant -> 0, et end AVANT start -> 0 (pas -1)", () => {
    expect(businessDaysBetween(mercredi, mercredi)).toBe(0);
    expect(businessDaysBetween(lendemain, mercredi)).toBe(0);
  });

  it("un 'now' dans le passé ne déclenche ni ne consomme la fenêtre", () => {
    expect(reviewDue(mercredi, d(2026, 7, 10))).toBe(false);
    expect(businessDaysLeft(mercredi, d(2026, 7, 10))).toBe(REVIEW_WINDOW_BUSINESS_DAYS);
  });
});
