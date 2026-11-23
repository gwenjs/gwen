/**
 * Project barrels followed to the module that defines the name.
 * Stars, cycles, the depth bound, and the imports that stay unresolved.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  "barrel-star-canonical",
  "barrel-default-reexport",
  "barrel-type-forms",
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
          binding = ctx.resolveImport(node);
        },
      });
      target.binding = binding;
      return [];
    },
  };
}

type ResolveId = (source: string, importer: string | undefined) => string | null;

async function withTemp(prefix: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function resolveBeside(source: string, importer: string | undefined): string | null {
  if (importer === undefined || !source.startsWith(".")) return null;
  return join(dirname(importer), source);
}

async function callees(
  root: string,
  code: string,
  resolveId: ResolveId,
  aliases?: readonly { readonly find: string; readonly replacement: string }[],
): Promise<readonly CalleeRecord[]> {
  const options = { id: join(root, "app.ts"), root, resolveId, units: [probeCallees] };
  await runPipeline(code, aliases === undefined ? options : { ...options, aliases });
  return readCalleeRecords();
}

function defineFrom(spec: string): string {
  return `import { defineSystem } from "${spec}";\nexport const run = defineSystem(1);\n`;
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

it("a css or json import leaves the importer callees unchanged", async () => {
  await withTemp("gwen-barrel-asset-", async (root) => {
    writeFileSync(join(root, "a.module.css"), ".a{color:red}\n");
    writeFileSync(join(root, "d.json"), "{}\n");
    writeFileSync(join(root, "raw.ts"), 'export { defineSystem } from "@gwenjs/core/system";\n');
    const code = [
      'import styles from "./a.module.css";',
      'import data from "./d.json";',
      'import { defineSystem as fromRaw } from "./raw.ts?raw";',
      'import { defineSystem } from "@gwenjs/core/system";',
      'import * as G from "@gwenjs/core/system";',
      "export const raw = fromRaw(1);",
      "export const run = defineSystem(styles, data);",
      "export const Anchor = G.defineSystem(() => 1);",
      "",
    ].join("\n");
    expect(await callees(root, code, resolveBeside)).toEqual([
      { callee: "defineSystem", call: "defineSystem(styles, data)" },
      { callee: "defineSystem", call: "G.defineSystem(() => 1)" },
    ]);
  });
});

it("a bare star re-export never reaches resolve", async () => {
  await withTemp("gwen-barrel-bare-", async (root) => {
    const seen: string[] = [];
    writeFileSync(join(root, "barrel.ts"), 'export * from "some-lib";\n');
    mkdirSync(join(root, "some-lib"));
    writeFileSync(
      join(root, "some-lib/index.ts"),
      'export { defineSystem } from "@gwenjs/core/system";\n',
    );
    const records = await callees(root, defineFrom("./barrel"), (source, importer) => {
      seen.push(source);
      return source === "some-lib"
        ? join(root, "some-lib/index.ts")
        : resolveRelativeId(source, importer);
    });
    expect([seen.includes("some-lib"), records]).toEqual([false, []]);
  });
});

it("watchChange on a non-barrel id keeps the cached binding", async () => {
  await withTemp("gwen-barrel-keep-", async (root) => {
    const barrelId = join(root, "barrel.ts");
    const importerId = join(root, "one.ts");
    writeFileSync(barrelId, shownOld);
    const plugin = await openPipeline({
      units: [probeCallees],
      root,
      resolveId: resolveRelativeId,
    });
    await applyTransform(plugin, shownImporter, importerId, resolveRelativeId);
    const first = readCalleeRecords();
    writeFileSync(barrelId, shownNew);
    watchPipeline(plugin, importerId);
    await applyTransform(plugin, shownImporter, join(root, "two.ts"), resolveRelativeId);
    expect([first, readCalleeRecords()]).toEqual([
      [{ callee: "defineSystem", call: "shown(1)" }],
      [{ callee: "defineSystem", call: "shown(1)" }],
    ]);
  });
});

it("a string alias matches the key or a slash suffix", async () => {
  await withTemp("gwen-barrel-alias-", async (root) => {
    const seen: string[] = [];
    writeFileSync(
      join(root, "barrel.ts"),
      'export { defineSystem as sys } from "@gwenjs/core/system";\n',
    );
    writeFileSync(join(root, "decoy.ts"), 'export { defineSystem } from "@gwenjs/core/system";\n');
    const code =
      'import { sys } from "@app/barrel";\nimport { defineSystem } from "@application/x";\nexport const followed = sys(1);\nexport const bare = defineSystem(1);\n';
    const records = await callees(
      root,
      code,
      (source, importer) => {
        seen.push(source);
        if (source === "@app/barrel") return join(root, "barrel.ts");
        if (source === "@application/x") return join(root, "decoy.ts");
        return resolveRelativeId(source, importer);
      },
      [{ find: "@app", replacement: "/app" }],
    );
    expect([seen.includes("@application/x"), records]).toEqual([
      false,
      [{ callee: "defineSystem", call: "sys(1)" }],
    ]);
  });
});

it("a barrel syntax error leaves the importer unresolved", async () => {
  await withTemp("gwen-barrel-parse-", async (root) => {
    writeFileSync(join(root, "barrel.ts"), "const =\n");
    expect(await callees(root, defineFrom("./barrel"), resolveRelativeId)).toEqual([]);
  });
});

it("an unreadable barrel file stays unresolved", async () => {
  await withTemp("gwen-barrel-miss-", async (root) => {
    const missing = join(root, "gone.ts");
    const records = await callees(root, defineFrom("./gone"), (source) =>
      source === "./gone" ? missing : null,
    );
    expect(records).toEqual([]);
  });
});

it("a barrel inside node_modules stays unresolved", async () => {
  await withTemp("gwen-barrel-nm-", async (root) => {
    const file = join(root, "node_modules/x/index.ts");
    mkdirSync(join(root, "node_modules/x"), { recursive: true });
    writeFileSync(file, 'export { defineSystem } from "@gwenjs/core/system";\n');
    const records = await callees(root, defineFrom("./x"), (source) =>
      source === "./x" ? file : null,
    );
    expect(records).toEqual([]);
  });
});
