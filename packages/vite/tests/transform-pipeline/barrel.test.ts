/**
 * Barrel re-exports are not followed yet.
 * A renamed re-export stays on the barrel specifier, so the recorded callee is empty.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Node } from "oxc-parser";
import { walk } from "oxc-walker";
import { expect, it } from "vitest";
import type { GwenImportBinding, GwenSourceTransform } from "../../src/pipeline/types.js";
import {
  applyTransform,
  calleeFixture,
  openPipeline,
  probeCallees,
  readCalleeRecords,
  resolveRelativeId,
  runPipeline,
  watchPipeline,
  type CalleeRecord,
} from "./helpers.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixturesRoot = fileURLToPath(new URL("../fixtures/resolve-callee/", import.meta.url));

const barrelCases = [
  "barrel-reexport",
  "barrel-star",
  "barrel-cycle",
  "barrel-depth-8",
  "barrel-depth-9",
  "barrel-local-reexport",
] as const;

const shownOld = 'export { defineSystem as shown } from "@gwenjs/core/system";\n';
const shownNew = 'export { defineScene as shown } from "@gwenjs/core/scene";\n';
const shownImporter = 'import { shown } from "./barrel";\n\nexport const run = shown(1);\n';

function originProbe(target: { binding: GwenImportBinding | null }): GwenSourceTransform {
  return {
    name: "gwen:probe-barrel-origin",
    run(program, ctx) {
      let binding: GwenImportBinding | null = null;
      let seen = false;
      walk(program, {
        enter(node: Node) {
          if (seen || node.type !== "CallExpression") return;
          seen = true;
          if (typeof ctx.resolveImport !== "function") return;
          binding = ctx.resolveImport(node);
        },
      });
      target.binding = binding;
      return [];
    },
  };
}

async function recordsFor(name: string): Promise<readonly CalleeRecord[]> {
  const dir = join(fixturesRoot, name);
  const fixture = calleeFixture(dir);
  await runPipeline(fixture.input, {
    id: join(dir, "input.ts"),
    root: packageRoot,
    resolveId: resolveRelativeId,
    units: [probeCallees],
  });
  return readCalleeRecords();
}

it.each(barrelCases)("%s resolves exactly the expected callees", async (name) => {
  const dir = join(fixturesRoot, name);
  const fixture = calleeFixture(dir);
  const records = await recordsFor(name);
  expect(records).toEqual(fixture.expected);
});

it("a barrel is parsed once for two importers", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "gwen-barrel-once-"));
  try {
    const barrelId = join(root, "barrel.ts");
    writeFileSync(barrelId, shownOld);
    const plugin = await openPipeline({
      units: [probeCallees],
      root,
      resolveId: resolveRelativeId,
    });
    await applyTransform(plugin, shownImporter, join(root, "one.ts"), resolveRelativeId);
    const first = readCalleeRecords();
    writeFileSync(barrelId, shownNew);
    await applyTransform(plugin, shownImporter, join(root, "two.ts"), resolveRelativeId);
    expect([first, readCalleeRecords()]).toEqual([
      [{ callee: "defineSystem", call: "shown(1)" }],
      [{ callee: "defineSystem", call: "shown(1)" }],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("watchChange on a barrel drops it from the cache", async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "gwen-barrel-watch-"));
  try {
    const barrelId = join(root, "barrel.ts");
    writeFileSync(barrelId, shownOld);
    const plugin = await openPipeline({
      units: [probeCallees],
      root,
      resolveId: resolveRelativeId,
    });
    await applyTransform(plugin, shownImporter, join(root, "one.ts"), resolveRelativeId);
    writeFileSync(barrelId, shownNew);
    watchPipeline(plugin, barrelId);
    await applyTransform(plugin, shownImporter, join(root, "three.ts"), resolveRelativeId);
    expect(readCalleeRecords()).toEqual([{ callee: "defineScene", call: "shown(1)" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("the depth bound is 8", async () => {
  const matchedDir = join(fixturesRoot, "barrel-depth-8");
  const blockedDir = join(fixturesRoot, "barrel-depth-9");
  const matched = calleeFixture(matchedDir);
  const blocked = calleeFixture(blockedDir);
  const atBound = await recordsFor("barrel-depth-8");
  const pastBound = await recordsFor("barrel-depth-9");
  expect([atBound, pastBound]).toEqual([matched.expected, blocked.expected]);
});

it("resolveImport follows a barrel to its origin", async () => {
  const dir = join(fixturesRoot, "barrel-reexport");
  const fixture = calleeFixture(dir);
  const found: { binding: GwenImportBinding | null } = { binding: null };
  await runPipeline(fixture.input, {
    id: join(dir, "input.ts"),
    root: packageRoot,
    resolveId: resolveRelativeId,
    units: [originProbe(found)],
  });
  expect(found.binding).toEqual({
    source: "@gwenjs/core/scene",
    imported: "defineSceneRouter",
  });
});

it("a barrel outside the project root is left untouched", async () => {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), "gwen-barrel-out-"));
  const root = join(parent, "project");
  const sibling = join(parent, "sibling");
  try {
    mkdirSync(root);
    mkdirSync(sibling);
    writeFileSync(
      join(root, "inside.ts"),
      'export { defineSystem as kept } from "@gwenjs/core/system";\n',
    );
    writeFileSync(
      join(sibling, "barrel.ts"),
      'export { defineSceneRouter as foreign } from "@gwenjs/core/scene";\n',
    );
    const code = [
      'import { kept } from "./inside";',
      'import { foreign } from "../sibling/barrel";',
      "export const inner = kept(1);",
      "export const outer = foreign(1);",
      "",
    ].join("\n");
    await runPipeline(code, {
      id: join(root, "app.ts"),
      root,
      resolveId: resolveRelativeId,
      units: [probeCallees],
    });
    expect(readCalleeRecords()).toEqual([{ callee: "defineSystem", call: "kept(1)" }]);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
