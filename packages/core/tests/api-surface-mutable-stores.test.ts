/**
 * No package entry exports a mutable module-level store (#59, D-59-b).
 */
import { describe, expect, it } from "vitest";
import * as core from "@gwenjs/core";
import * as coreSystem from "@gwenjs/core/system";
import * as coreActor from "@gwenjs/core/actor";
import * as coreScene from "@gwenjs/core/scene";
import * as coreInternal from "@gwenjs/core/internal";
import * as kit from "@gwenjs/kit";
import * as physics2d from "@gwenjs/physics2d";
import * as physics3d from "@gwenjs/physics3d";
import * as rendererCore from "@gwenjs/renderer-core";
import * as cameraCore from "@gwenjs/camera-core";
import * as schema from "@gwenjs/schema";
import * as math from "@gwenjs/math";

const packageEntries: ReadonlyArray<readonly [string, object]> = [
  ["@gwenjs/core", core],
  ["@gwenjs/core/system", coreSystem],
  ["@gwenjs/core/actor", coreActor],
  ["@gwenjs/core/scene", coreScene],
  ["@gwenjs/core/internal", coreInternal],
  ["@gwenjs/kit", kit],
  ["@gwenjs/physics2d", physics2d],
  ["@gwenjs/physics3d", physics3d],
  ["@gwenjs/renderer-core", rendererCore],
  ["@gwenjs/camera-core", cameraCore],
  ["@gwenjs/schema", schema],
  ["@gwenjs/math", math],
];

function exportNames(entryModule: object): string[] {
  return Object.keys(entryModule).filter((name) => name !== "__esModule");
}

/** Module-namespace exports are getters. A copied value property is read as-is. */
function readExport(entryModule: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(entryModule, name);
  if (descriptor === undefined) {
    return undefined;
  }
  if (typeof descriptor.get === "function") {
    return descriptor.get.call(entryModule);
  }
  return descriptor.value;
}

function storeKind(value: unknown): string | undefined {
  if (value instanceof Map) return "Map";
  if (value instanceof Set) return "Set";
  if (value instanceof WeakMap) return "WeakMap";
  if (value instanceof WeakSet) return "WeakSet";
  if (value instanceof Array) return "Array";
  return undefined;
}

describe("package entries", () => {
  it("no package entry exports a mutable store", () => {
    const hits: string[] = [];
    for (const [entry, entryModule] of packageEntries) {
      const names = exportNames(entryModule);
      expect(names.length, `${entry} has no exports`).toBeGreaterThan(0);
      for (const name of names) {
        const kind = storeKind(readExport(entryModule, name));
        if (kind !== undefined) {
          hits.push(`${entry} exports ${name} (${kind})`);
        }
      }
    }
    expect(hits, hits.join("; ")).toEqual([]);
  });
});
