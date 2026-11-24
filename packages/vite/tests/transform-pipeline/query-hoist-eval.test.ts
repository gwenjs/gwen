/**
 * The hoisted array is evaluated after the component const and before the system.
 * A placement after the last import would read `Tag` before it is initialised.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import type { ComponentDefinition, ComponentSchema, InferComponent } from "@gwenjs/core";
import { createEngine } from "@gwenjs/core/node";
import type { DiscoverablePlugin } from "@gwenjs/core/system";
import { BUILT_IN_UNITS } from "../../src/pipeline/registry.js";
import { runPipeline } from "./helpers.js";

const SOURCE = [
  'import { defineComponent, Types } from "@gwenjs/core";',
  'import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";',
  "",
  'export const Tag = defineComponent({ name: "Tag", schema: { v: Types.f32 }, defaults: { v: 0 } });',
  "export const seen: number[] = [];",
  'export const Count = defineSystem("Count", () => {',
  "  const q = useQuery([Tag]);",
  "  onUpdate(() => {",
  "    seen.push([...q.each()].length);",
  "  });",
  "});",
  "",
].join("\n");

const testsRoot = fileURLToPath(new URL("../", import.meta.url));
type Running = Awaited<ReturnType<typeof createEngine>>;
const engines: Running[] = [];
const dirs: string[] = [];

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isComponent(value: unknown): value is ComponentDefinition<ComponentSchema> {
  if (typeof value !== "object" || value === null) return false;
  if (!("name" in value) || typeof value.name !== "string") return false;
  if (!("schema" in value) || typeof value.schema !== "object" || value.schema === null) {
    return false;
  }
  return true;
}

function isSeen(value: unknown): value is number[] {
  return Array.isArray(value);
}

function isFactory(value: unknown): value is () => unknown {
  return typeof value === "function";
}

function isPlugin(value: unknown): value is DiscoverablePlugin {
  if (typeof value !== "object" || value === null) return false;
  if (!("name" in value) || typeof value.name !== "string") return false;
  if (!("setup" in value) || typeof value.setup !== "function") return false;
  return true;
}

function readModule(value: unknown): {
  readonly tag: ComponentDefinition<ComponentSchema>;
  readonly seen: number[];
  readonly count: () => DiscoverablePlugin;
} {
  if (typeof value !== "object" || value === null)
    throw new Error("runtime module is not an object");
  if (!("Tag" in value) || !("seen" in value) || !("Count" in value)) {
    throw new Error("runtime module is missing Tag, seen or Count");
  }
  if (!isComponent(value.Tag)) throw new Error("Tag is not a component");
  if (!isSeen(value.seen)) throw new Error("seen is not an array");
  const factory: unknown = value.Count;
  if (!isFactory(factory)) throw new Error("Count is not a function");
  return {
    tag: value.Tag,
    seen: value.seen,
    count: () => {
      const plugin = factory();
      if (!isPlugin(plugin)) throw new Error("Count() is not a plugin");
      return plugin;
    },
  };
}

function addEmpty<D extends ComponentDefinition<ComponentSchema>>(
  engine: Running,
  id: ReturnType<Running["createEntity"]>,
  def: D,
): void {
  const data: Partial<InferComponent<D>> = {};
  engine.addComponent(id, def, data);
}

it("a hoisted array loads after its def, sits between the def and the system, and the query sees the entity", async () => {
  const transformed = await runPipeline(SOURCE, {
    id: "/src/query-hoist-eval.ts",
    units: BUILT_IN_UNITS,
  });
  const code = transformed === null ? SOURCE : transformed.code;
  const hoistAt = code.indexOf("const _gwen_q0");
  const defAt = code.indexOf("Tag = defineComponent");
  const systemAt = code.indexOf("export const Count");
  expect(hoistAt).toBeGreaterThan(defAt);
  expect(hoistAt).toBeLessThan(systemAt);

  const dir = mkdtempSync(join(testsRoot, "query-hoist-eval-"));
  dirs.push(dir);
  const file = join(dir, "count.ts");
  writeFileSync(file, code);
  const loaded: unknown = await import(pathToFileURL(file).href);
  const mod = readModule(loaded);
  const engine = await createEngine({ maxEntities: 32 });
  engines.push(engine);
  const entity = engine.createEntity();
  addEmpty(engine, entity, mod.tag);
  await engine.use(mod.count());
  await engine.startExternal();
  await engine.advance(0.016);
  expect(mod.seen).toEqual([1]);
});
