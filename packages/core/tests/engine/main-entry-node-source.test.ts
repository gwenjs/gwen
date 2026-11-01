/**
 * The main `createEngine` does not read the package binary.
 * Node callers import `@gwenjs/core/node`.
 */

import { expect, it } from "vitest";

import { createEngine, type GwenEngine } from "../../src/index.js";

it("createEngine from the main entry in Node with no source rejects naming @gwenjs/core/node", async () => {
  let engine: GwenEngine | undefined;
  const pending = createEngine().then((created) => {
    engine = created;
    return created;
  });
  try {
    await expect(pending).rejects.toMatchObject({ code: "CORE:WASM_LOAD_ERROR" });
    await expect(pending).rejects.toThrow(/@gwenjs\/core\/node/);
  } finally {
    await engine?.stop();
  }
});
