/**
 * The rewritten handler restores the engine that was current at the await,
 * including an await that is the body of an unbraced else branch,
 * and a statement await inside a block.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import { engineContext, runScenePreload, SceneEnginePlugin } from "@gwenjs/core/internal";
import { BUILT_IN_UNITS } from "../../src/pipeline/registry.js";
import { runPipeline } from "./helpers.js";

const UNBRACED_SOURCE = [
  'import { useEngine, withAsyncContext } from "@gwenjs/core";',
  "",
  "export function run(switchToB: () => Promise<void>): () => Promise<{ engine: unknown; taken: number }> {",
  "  return withAsyncContext(async () => {",
  "    let taken = 0;",
  "    if (false) {",
  "      taken += 1;",
  "      await Promise.resolve();",
  "    } else await switchToB();",
  "    return { engine: useEngine(), taken };",
  "  });",
  "}",
  "",
].join("\n");

const STATEMENT_SOURCE = [
  'import { useEngine, withAsyncContext } from "@gwenjs/core";',
  "",
  "export function run(switchToB: () => Promise<void>): () => Promise<unknown> {",
  "  return withAsyncContext(async () => {",
  "    await switchToB();",
  "    return useEngine();",
  "  });",
  "}",
  "",
].join("\n");

const PRELOAD_SOURCE = [
  'import { useEngine } from "@gwenjs/core";',
  'import { defineScene, onPreload } from "@gwenjs/core/scene";',
  "",
  "export const probe: { switchToB: () => Promise<void>; seen: unknown[] } = {",
  "  switchToB: async () => {},",
  "  seen: [],",
  "};",
  "",
  'export const Level = defineScene("Level", () => {',
  "  onPreload(async () => {",
  "    await probe.switchToB();",
  "    probe.seen.push(useEngine());",
  "  });",
  "});",
  "",
].join("\n");

const testsRoot = fileURLToPath(new URL("../", import.meta.url));
const engines: { stop: () => Promise<void> }[] = [];
const dirs: string[] = [];

afterEach(async () => {
  engineContext.unset();
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isRun(
  value: unknown,
): value is (switchToB: () => Promise<void>) => () => Promise<unknown> {
  return typeof value === "function";
}

function readRun(moduleValue: unknown): (switchToB: () => Promise<void>) => () => Promise<unknown> {
  if (typeof moduleValue !== "object" || moduleValue === null || !("run" in moduleValue)) {
    throw new Error("runtime module has no run");
  }
  const run: unknown = moduleValue.run;
  if (!isRun(run)) throw new Error("runtime module has no run");
  return run;
}

interface PreloadProbe {
  switchToB: () => Promise<void>;
  seen: unknown[];
}

function isPreloadProbe(value: unknown): value is PreloadProbe {
  if (typeof value !== "object" || value === null) return false;
  if (!("switchToB" in value) || !("seen" in value)) return false;
  return typeof value.switchToB === "function" && Array.isArray(value.seen);
}

function isSceneFactory(value: unknown): value is (registry: { register: () => void }) => void {
  return typeof value === "function";
}

function readPreloadModule(moduleValue: unknown): {
  probe: PreloadProbe;
  Level: (registry: { register: () => void }) => void;
} {
  if (
    typeof moduleValue !== "object" ||
    moduleValue === null ||
    !("probe" in moduleValue) ||
    !("Level" in moduleValue)
  ) {
    throw new Error("runtime module has no probe");
  }
  const probe: unknown = moduleValue.probe;
  const level: unknown = moduleValue.Level;
  if (!isPreloadProbe(probe) || !isSceneFactory(level)) {
    throw new Error("runtime module has no probe");
  }
  return { probe, Level: level };
}

function isTakenResult(
  value: unknown,
): value is { readonly engine: unknown; readonly taken: number } {
  if (typeof value !== "object" || value === null) return false;
  if (!("engine" in value) || !("taken" in value)) return false;
  return typeof value.taken === "number";
}

async function importRun(
  source: string,
): Promise<(switchToB: () => Promise<void>) => () => Promise<unknown>> {
  const transformed = await runPipeline(source, {
    id: "/src/async-context-runtime.ts",
    units: BUILT_IN_UNITS,
  });
  expect(transformed).not.toBeNull();
  if (transformed === null) {
    throw new Error("pipeline returned null");
  }
  const dir = mkdtempSync(join(testsRoot, "async-context-runtime-"));
  dirs.push(dir);
  const file = join(dir, "handler.ts");
  writeFileSync(file, transformed.code);
  const loaded: unknown = await import(pathToFileURL(file).href);
  return readRun(loaded);
}

async function enginePair(): Promise<{
  readonly engineA: Awaited<ReturnType<typeof createEngine>>;
  readonly engineB: Awaited<ReturnType<typeof createEngine>>;
}> {
  const engineA = await createEngine({ maxEntities: 32 });
  engines.push(engineA);
  const engineB = await createEngine({ maxEntities: 32 });
  engines.push(engineB);
  engineA.activate();
  return { engineA, engineB };
}

it("a rewritten handler keeps the engine after an await, also in an unbraced else branch", async () => {
  const { engineA, engineB } = await enginePair();
  const wrapped = (await importRun(UNBRACED_SOURCE))(async () => {
    engineB.activate();
  });
  const current = await wrapped();
  if (!isTakenResult(current)) throw new Error("handler result has no taken count");
  expect(current.taken).toBe(0);
  expect(current.engine).toBe(engineA);
});

it("a rewritten handler keeps the engine after a statement await in a block", async () => {
  const { engineA, engineB } = await enginePair();
  const wrapped = (await importRun(STATEMENT_SOURCE))(async () => {
    engineB.activate();
  });
  const current = await wrapped();
  expect(current).toBe(engineA);
});

it("a rewritten onPreload handler keeps the engine after an await when runScenePreload runs it", async () => {
  const { engineA, engineB } = await enginePair();
  await engineA.use(SceneEnginePlugin());
  const transformed = await runPipeline(PRELOAD_SOURCE, {
    id: "/src/async-context-runtime.ts",
    units: BUILT_IN_UNITS,
  });
  expect(transformed).not.toBeNull();
  if (transformed === null) throw new Error("pipeline returned null");
  const dir = mkdtempSync(join(testsRoot, "async-context-runtime-"));
  dirs.push(dir);
  const file = join(dir, "handler.ts");
  writeFileSync(file, transformed.code);
  const loaded: unknown = await import(pathToFileURL(file).href);
  const { probe, Level } = readPreloadModule(loaded);
  engineA.run(() => {
    Level({ register: () => {} });
  });
  probe.switchToB = async () => {
    engineB.activate();
  };
  await runScenePreload(engineA, null, "Level");
  expect(probe.seen).toHaveLength(1);
  expect(probe.seen[0]).toBe(engineA);
});
