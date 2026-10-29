import type { EntryResolvedConfig } from "../src/entry-gen.js";

/** Minimal resolved config for entry snapshots that do not care about engine values. */
export const entryResolvedFixture: EntryResolvedConfig = {
  engine: {
    variant: "light",
    loop: "internal",
  },
};
