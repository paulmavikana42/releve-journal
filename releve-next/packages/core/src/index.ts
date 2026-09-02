// Point d'entrée public du moteur. Se remplit au fil de la phase 1.
export { Decimal } from "./decimal";
export * from "./models";
export * from "./clock";
export * from "./specs";
export * from "./metrics";
export * from "./prop";
export * from "./challenge";
export * from "./store";
export { JsonlStore } from "./jsonl-store";
export * from "./matcher";

// parser et csvimport exposent chacun un `num` (dialectes différents) : on les
// expose en namespaces pour éviter la collision et garder les deux accessibles.
export * as parser from "./parser";
export * as csv from "./csvimport";

// Modules adossés au système de fichiers (local/serveur). Namespaces : leurs noms
// courts (read/get/set, known, inspect…) entreraient sinon en collision.
export * as paths from "./paths";
export * as settings from "./settings";
export * as symbols from "./symbols";
export * as captures from "./captures";
export * as migration from "./migration";
export * as onboarding from "./onboarding";
