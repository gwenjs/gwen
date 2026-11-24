import type { GwenBuildHooks, GwenKit, GwenPlugin, PluginDeclaration } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "../error-codes.js";
import { isRecord } from "../json.js";
import type { ConformanceFinding } from "../types.js";
import { callExport, isPlugin } from "./call-factory.js";
import { importFreshEntry } from "./load-package.js";
import type { PluginConformanceSpec, RuntimeCheckContext } from "./types.js";

const MODULE_HINT =
  "Set meta.name to the package name, and pass addPlugin a declaration { src, export } for a factory of this package.";

function moduleFinding(message: string): ConformanceFinding {
  return { code: ConformanceErrorCodes.RUNTIME_MODULE, message, hint: MODULE_HINT };
}

function requiresFinding(message: string): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_REQUIRES,
    message,
    hint: "Pass addPlugin a requires value equal to the factory instance.",
  };
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
    addSourceTransform(): void {},
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
/** Deep equality. Object key order does not count. */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!sameValue(left[index], right[index])) return false;
    }
    return true;
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key)) return false;
    if (!sameValue(left[key], right[key])) return false;
  }
  return true;
}

/** The factory named by `export`, when that export is one plugin instance. */
function instancePlugin(
  value: Record<string, unknown>,
  spec: PluginConformanceSpec,
  entry: Record<string, unknown>,
): GwenPlugin | undefined {
  const exportName = value.export;
  if (typeof exportName !== "string") return undefined;
  const factory = spec.factories.find((item) => item.export === exportName);
  if (factory === undefined) return undefined;
  const created = callExport(entry, factory.export, factory.options);
  if (!isPlugin(created)) return undefined;
  return created;
}

/**
 * `name` on a declaration, compared only when the key is present.
 * The value must equal the instance plugin name.
 */
function declarationNameProblem(
  value: Record<string, unknown>,
  spec: PluginConformanceSpec,
  entry: Record<string, unknown>,
): string | undefined {
  if (!Object.hasOwn(value, "name")) return undefined;
  const plugin = instancePlugin(value, spec, entry);
  if (plugin === undefined) return undefined;
  if (value.name === plugin.name) return undefined;
  return `module ${JSON.stringify(spec.packageName)} declaration name ${JSON.stringify(value.name)} differs from the instance name ${JSON.stringify(plugin.name)}`;
}

/**
 * `requires` on a declaration, compared only when the key is present.
 * A function-valued record is an instance, not a declaration.
 */
function declarationRequiresProblem(
  value: unknown,
  spec: PluginConformanceSpec,
  entry: Record<string, unknown>,
): string | undefined {
  if (!isRecord(value)) return undefined;
  if (hasFunctionValue(value)) return undefined;
  if (!Object.hasOwn(value, "requires")) return undefined;
  const plugin = instancePlugin(value, spec, entry);
  if (plugin === undefined) return undefined;
  if (sameValue(value.requires, plugin.requires)) return undefined;
  return `module ${JSON.stringify(spec.packageName)} declaration requires ${JSON.stringify(value.requires)} differs from the instance ${JSON.stringify(plugin.requires)}`;
}

function declarationProblem(
  value: unknown,
  spec: PluginConformanceSpec,
  entry: Record<string, unknown>,
): string | undefined {
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
  return declarationNameProblem(value, spec, entry);
}

/** R10. Built `./module`: `meta.name`, then each value `addPlugin` recorded. */
export async function checkModule(
  context: RuntimeCheckContext,
  moduleFile: string,
): Promise<ConformanceFinding[]> {
  const loaded = await importFreshEntry(moduleFile, "module");
  if (loaded === undefined) {
    return [
      moduleFinding(`module ${JSON.stringify(context.spec.packageName)} could not be imported`),
    ];
  }
  const mod: unknown = loaded.default;
  if (!isRecord(mod)) {
    return [
      moduleFinding(
        `module ${JSON.stringify(context.spec.packageName)} default export is not an object`,
      ),
    ];
  }
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
    const problem = declarationProblem(value, context.spec, context.entry);
    if (problem !== undefined) findings.push(moduleFinding(problem));
    const requiresProblem = declarationRequiresProblem(value, context.spec, context.entry);
    if (requiresProblem !== undefined) findings.push(requiresFinding(requiresProblem));
  }
  return findings;
}
