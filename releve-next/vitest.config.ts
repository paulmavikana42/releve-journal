import { defineConfig } from "vitest/config";

// Les tests SONT la spécification exécutable (cf. ETAT_PROJET.md §4). On les
// place au plus près du code porté, dans packages/*/src.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
  },
});
