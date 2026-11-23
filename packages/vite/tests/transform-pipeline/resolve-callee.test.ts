/**
 * Red tests for callee resolution through bindings.
 * The pipeline still matches a direct named import, so each name fails
 * on the recorded calls, the import binding, or the scope answer.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Node } from "oxc-parser";
import { walk } from "oxc-walker";
import { describe, expect, it } from "vitest";
import type { AutoImport } from "@gwenjs/kit";
import type {
  GwenAstArgument,
  GwenCallSite,
  GwenImportBinding,
  GwenSourceTransform,
} from "../../src/pipeline/types.js";
import {
  calleeFixture,
  probeCallees,
  probeCalls,
  readCalleeRecords,
  readCallProbe,
  runPipeline,
} from "./helpers.js";

const fixturesRoot = fileURLToPath(new URL("../fixtures/resolve-callee/", import.meta.url));

const MODULE_BINDINGS = ["kept", "moduleFunction", "ModuleClass", "moduleConst", "Y"] as const;

function fixtureCaseNames(): string[] {
  return readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function identifierName(node: Node): string | undefined {
  if (node.type !== "Identifier") return undefined;
  return node.name;
}

function isModuleBinding(parent: Node, node: Node): boolean {
  if (
    parent.type === "ImportSpecifier" ||
    parent.type === "ImportDefaultSpecifier" ||
    parent.type === "ImportNamespaceSpecifier"
  ) {
    return parent.local === node;
  }
  if (parent.type === "FunctionDeclaration" || parent.type === "ClassDeclaration") {
    return parent.id === node;
  }
  if (parent.type === "VariableDeclarator") return parent.id === node;
  return false;
}

function isYUse(parent: Node | null, node: Node): boolean {
  if (parent === null) return false;
  if (parent.type === "VariableDeclarator") return parent.init === node;
  if (parent.type === "ReturnStatement") return parent.argument === node;
  return false;
}

interface ScopeReport {
  readonly yUseCount: number;
  readonly firstUse: boolean;
  readonly secondUse: boolean;
  readonly moduleLevel: readonly boolean[];
  readonly unknown: boolean;
  readonly pastEnd: boolean;
}

function scopeProbe(target: { report: ScopeReport | undefined }): GwenSourceTransform {
  return {
    name: "gwen:probe-scope",
    run(program, ctx) {
      const bindingAt = new Map<string, number>();
      const yUses: number[] = [];
      walk(program, {
        enter(node, parent) {
          const name = identifierName(node);
          if (name === undefined) return;
          if (parent !== null && isModuleBinding(parent, node) && !bindingAt.has(name)) {
            bindingAt.set(name, node.start);
          }
          if (name === "Y" && isYUse(parent, node)) yUses.push(node.start);
        },
      });
      const first = yUses[0];
      const second = yUses[1];
      target.report = {
        yUseCount: yUses.length,
        firstUse: first === undefined ? false : ctx.isModuleScopeBinding("Y", first),
        secondUse: second === undefined ? true : ctx.isModuleScopeBinding("Y", second),
        moduleLevel: MODULE_BINDINGS.map((name) => {
          const at = bindingAt.get(name);
          return at === undefined ? false : ctx.isModuleScopeBinding(name, at);
        }),
        unknown: ctx.isModuleScopeBinding("notDeclared", 0),
        pastEnd: ctx.isModuleScopeBinding("Y", ctx.code.length + 1),
      };
      return [];
    },
  };
}

function importProbe(target: { bindings: (GwenImportBinding | null)[] }): GwenSourceTransform {
  return {
    name: "gwen:probe-import",
    run(program, ctx) {
      const bindings: (GwenImportBinding | null)[] = [];
      walk(program, {
        enter(node) {
          if (node.type !== "CallExpression") return;
          bindings.push(ctx.resolveImport(node));
        },
      });
      target.bindings = bindings;
      return [];
    },
  };
}

function argumentSummary(argument: GwenAstArgument): { kind: string; value?: string | number } {
  if (argument.kind === "string") return { kind: "string", value: argument.value };
  if (argument.kind === "number") return { kind: "number", value: argument.value };
  return { kind: "other" };
}

function callSummary(call: GwenCallSite): {
  binding: GwenImportBinding | null;
  arguments: { kind: string; value?: string | number }[];
} {
  return {
    binding: call.binding,
    arguments: call.arguments.map((argument) => argumentSummary(argument)),
  };
}

describe("resolveCallee", () => {
  it.each(fixtureCaseNames())("%s resolves exactly the expected callees", async (name) => {
    const dir = join(fixturesRoot, name);
    const fixture = calleeFixture(dir);
    await runPipeline(fixture.input, {
      id: join(dir, "input.ts"),
      units: [probeCallees],
      autoImports: fixture.autoImports,
    });
    expect(readCalleeRecords()).toEqual(fixture.expected);
  });
});

it("resolveImport follows an alias, a namespace and an auto-import of a non-GWEN package", async () => {
  const source = [
    'import { helper as h } from "my-lib";',
    'import * as NS from "my-lib";',
    "export const aliased = h(1);",
    "export const namespaced = NS.helper(2);",
    "export const free = freeHelper(3);",
    "",
  ].join("\n");
  const autoImports: readonly AutoImport[] = [{ name: "freeHelper", from: "my-lib" }];
  const found: { bindings: (GwenImportBinding | null)[] } = { bindings: [] };
  await runPipeline(source, { units: [importProbe(found)], autoImports });
  expect(found.bindings).toEqual([
    { source: "my-lib", imported: "helper" },
    { source: "my-lib", imported: "helper" },
    { source: "my-lib", imported: "freeHelper" },
  ]);
});

it("resolveImport returns null for a shadowed local and a type-only import", async () => {
  const source = [
    'import { defineSystem } from "@gwenjs/core/system";',
    'import { type defineActor } from "@gwenjs/core/actor";',
    "export const top = defineSystem(1);",
    "export function f() {",
    "  const defineSystem = () => 1;",
    "  return defineSystem();",
    "}",
    "export const actor = defineActor(1);",
    "",
  ].join("\n");
  const found: { bindings: (GwenImportBinding | null)[] } = { bindings: [] };
  await runPipeline(source, { units: [importProbe(found)] });
  expect(found.bindings).toEqual([
    { source: "@gwenjs/core/system", imported: "defineSystem" },
    null,
    null,
  ]);
});

it("calls() lists every call with its binding and typed arguments", async () => {
  const source = [
    'import { defineSystem } from "@gwenjs/core/system";',
    "const r = [1];",
    'export const system = defineSystem("a", 2, -1, ...r, `t`);',
    "export const other = notGwen(1);",
    "",
  ].join("\n");
  await runPipeline(source, { units: [probeCalls] });
  expect(readCallProbe().calls.map((call) => callSummary(call))).toEqual([
    {
      binding: { source: "@gwenjs/core/system", imported: "defineSystem" },
      arguments: [
        { kind: "string", value: "a" },
        { kind: "number", value: 2 },
        { kind: "other" },
        { kind: "other" },
        { kind: "other" },
      ],
    },
    { binding: null, arguments: [{ kind: "number", value: 1 }] },
  ]);
});

it("calls() is computed once per module", async () => {
  const source = [
    'import { defineSystem } from "@gwenjs/core/system";',
    "export const system = defineSystem(1);",
    "",
  ].join("\n");
  await runPipeline(source, { units: [probeCalls] });
  const probe = readCallProbe();
  expect(probe.calls).toHaveLength(1);
  expect(probe.calls).toBe(probe.again);
});

it("isModuleScopeBinding is true only for a binding declared at module scope", async () => {
  const source = [
    'import { kept } from "my-lib";',
    "export const keptUse = kept;",
    "export function moduleFunction() {",
    "  return 1;",
    "}",
    "export class ModuleClass {}",
    "export const moduleConst = 1;",
    "export const Y = 1;",
    "export const first = Y;",
    "export function takesY(Y: number) {",
    "  return Y;",
    "}",
    "",
  ].join("\n");
  const found: { report: ScopeReport | undefined } = { report: undefined };
  await runPipeline(source, { units: [scopeProbe(found)] });
  const report = found.report;
  expect(report).toBeDefined();
  if (report === undefined) return;
  expect(report.yUseCount).toBe(2);
  expect(report.moduleLevel).toEqual([true, true, true, true, true]);
  expect(report.unknown).toBe(false);
  expect(report.pastEnd).toBe(false);
  expect(report.firstUse).toBe(true);
  expect(report.secondUse).toBe(false);
});
