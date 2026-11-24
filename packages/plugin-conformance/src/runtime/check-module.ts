import type { GwenBuildHooks, GwenKit, PluginDeclaration } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import { isRecord } from "../json.js";
import type { ConformanceFinding } from "../types.js";
import { importFreshEntry } from "./load-package.js";
import type { PluginConformanceSpec, RuntimeCheckContext } from "./types.js";

const MODULE_HINT =
  "Set meta.name to the package name, and pass addPlugin a declaration { src, export } for a factory of this package.";

function moduleFinding(message: string): ConformanceFinding {
  return { code: ConformanceErrorCodes.RUNTIME_MODULE, message, hint: MODULE_HINT };
}

/**
 * `meta.name` the way `validateGwenModule` reads it
 * (`packages/kit/src/define-module.ts:62`).
 */
function metaName(mod: Record<string, unknown>): unknown {
  const meta: unknown = mod.meta;
  if (!isRecord(meta)) return undefined;
  return meta.name;
}

/** Module `defaults`, or `{}` when `defaults` is absent (`packages/schema/src/module.ts:287`). */
function moduleOptions(mod: Record<string, unknown>): Record<string, unknown> {
  const defaults: unknown = mod.defaults;
  if (!isRecord(defaults)) return {};
  return defaults;
}

function isSetup(
  value: unknown,
): value is (options: unknown, kit: GwenKit) => void | Promise<void> {
  return typeof value === "function";
}

function hasFunctionValue(value: Record<string, unknown>): boolean {
  return Object.values(value).some((item) => typeof item === "function");
}

/**
 * Recording kit (`packages/schema/src/module.ts:193`).
 * `addPlugin` records. The other members do nothing. `options` is `{}`.
 */
function recordingKit(recorded: unknown[]): GwenKit {
  return {
    addPlugin(plugin: PluginDeclaration): void {
      recorded.push(plugin);
    },
    addAutoImports(): void {},
    addVitePlugin(): void {},
    extendViteConfig(): void {},
    hook<H extends keyof GwenBuildHooks>(_event: H, _fn: GwenBuildHooks[H]): void {},
    options: {},
  };
}

/**
 * One problem for one recorded value.
 * A function value is the instance case (`packages/app/src/app.ts:357`).
 * `src` and `export` are checked only after that (`packages/app/src/app.ts:433`).
 */
function declarationProblem(value: unknown, spec: PluginConformanceSpec): string | undefined {
  if (!isRecord(value)) return undefined;
  if (hasFunctionValue(value)) {
    return `module ${JSON.stringify(spec.packageName)} called addPlugin with ${Object.keys(value).join(", ")}`;
  }
  if (value.src !== spec.packageName) {
    return `module ${JSON.stringify(spec.packageName)} declaration src ${JSON.stringify(value.src)} is not the package name`;
  }
  if (!spec.factories.some((factory) => factory.export === value.export)) {
    return `module declaration export ${JSON.stringify(value.export)} is not a spec factory`;
  }
  return undefined;
}

/** R10. Built `./module`: `meta.name`, then each value `addPlugin` recorded. */
export async function checkModule(
  context: RuntimeCheckContext,
  moduleFile: string,
): Promise<ConformanceFinding[]> {
  const loaded = await importFreshEntry(moduleFile, "module");
  if (loaded === undefined) return [];
  const mod: unknown = loaded.default;
  if (!isRecord(mod)) return [];
  const findings: ConformanceFinding[] = [];
  const name = metaName(mod);
  if (name !== context.spec.packageName) {
    findings.push(
      moduleFinding(
        `module meta.name ${JSON.stringify(name)} differs from ${JSON.stringify(context.spec.packageName)}`,
      ),
    );
  }
  const recorded: unknown[] = [];
  const setup: unknown = mod.setup;
  if (isSetup(setup)) {
    await setup(moduleOptions(mod), recordingKit(recorded));
  }
  for (const value of recorded) {
    const problem = declarationProblem(value, context.spec);
    if (problem !== undefined) findings.push(moduleFinding(problem));
  }
  return findings;
}
