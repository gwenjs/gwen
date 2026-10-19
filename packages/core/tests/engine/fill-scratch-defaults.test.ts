import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngine, defineComponent, Types } from "../../src/index.js";

const entitiesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/engine/engine-entities.ts",
);

/** Body of `fillScratch`, from the opening brace through its match. */
function fillScratchBody(source: string): string {
  const start = source.indexOf("private fillScratch");
  if (start < 0) {
    throw new Error("private fillScratch not found");
  }
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error("fillScratch body did not close");
}

/**
 * `exactOptionalPropertyTypes` rejects an explicit `undefined` field.
 * The own property is attached at runtime so `addComponent` still receives it.
 */
function withUndefined<T extends object>(base: T, key: string): T {
  Object.defineProperty(base, key, {
    value: undefined,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return base;
}

const Marker = defineComponent({
  name: "FillScratchMarker240",
  schema: { kept: Types.f32, missing: Types.f32, blank: Types.f32 },
  defaults: { kept: 1, missing: 9, blank: 4 },
});

describe("fillScratch", () => {
  it("applies schema defaults for a missing key and an undefined value", async () => {
    const first = await createEngine({ maxEntities: 4 });
    try {
      const second = await createEngine({ maxEntities: 4 });
      try {
        const partial = first.createEntity();
        const empty = first.createEntity();
        first.addComponent(partial, Marker, withUndefined({ kept: 77 }, "blank"));
        first.addComponent(empty, Marker, {});

        expect(first.getComponent(partial, Marker)).toEqual({
          kept: 77,
          missing: 9,
          blank: 4,
        });
        expect(first.getComponent(empty, Marker)).toEqual({
          kept: 1,
          missing: 9,
          blank: 4,
        });

        const zero = second.createEntity();
        second.addComponent(zero, Marker, { kept: 0, missing: 0, blank: 0 });
        expect(second.getComponent(zero, Marker)).toEqual({
          kept: 0,
          missing: 0,
          blank: 0,
        });

        const body = fillScratchBody(readFileSync(entitiesPath, "utf8"));
        expect(body.includes(" as ")).toBe(false);
      } finally {
        await second.stop();
      }
    } finally {
      await first.stop();
    }
  });
});
