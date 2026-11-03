import { GWEN_FRAMEWORK_HOOK_NAMESPACES, GWEN_RESERVED_HOOK_NAMESPACES } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "./error-codes.js";
import { scanHookSources } from "./hook-sources.js";
import { isRecord } from "./json.js";
import type { PackageContext } from "./package-context.js";
import type { ConformanceFinding } from "./types.js";

const NAMESPACE_FORMAT = /^[a-z][a-z0-9-]*$/;

type HookNamespace =
  | { readonly kind: "valid"; readonly value: string }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly message: string; readonly hint: string };

function packageName(manifest: unknown): string {
  if (isRecord(manifest) && typeof manifest.name === "string" && manifest.name.length > 0) {
    return manifest.name;
  }
  return "(unnamed package)";
}

function isCoreReserved(namespace: string): boolean {
  return GWEN_RESERVED_HOOK_NAMESPACES.some((reserved) => reserved === namespace);
}

/** Package that owns a framework namespace, or `undefined`. */
function frameworkOwner(namespace: string): string | undefined {
  for (const [key, owner] of Object.entries(GWEN_FRAMEWORK_HOOK_NAMESPACES)) {
    if (key === namespace) return owner;
  }
  return undefined;
}

function readHookNamespace(manifest: unknown, pkg: string): HookNamespace {
  const gwen = isRecord(manifest) ? manifest.gwen : undefined;
  const value = isRecord(gwen) ? gwen.hookNamespace : undefined;
  if (value === undefined) return { kind: "missing" };
  const shown = JSON.stringify(value);
  const hint = 'Set gwen.hookNamespace to a lowercase name such as "myplug".';
  if (typeof value !== "string") {
    return {
      kind: "invalid",
      message: `gwen.hookNamespace of ${pkg} must be a string, got ${shown}`,
      hint,
    };
  }
  if (!NAMESPACE_FORMAT.test(value)) {
    return {
      kind: "invalid",
      message: `gwen.hookNamespace ${shown} of ${pkg} must match ${NAMESPACE_FORMAT.source}`,
      hint,
    };
  }
  if (isCoreReserved(value)) {
    return {
      kind: "invalid",
      message: `gwen.hookNamespace ${shown} of ${pkg} is reserved by the core`,
      hint: `Pick a namespace of your own: "${value}" belongs to the engine.`,
    };
  }
  const owner = frameworkOwner(value);
  if (owner !== undefined) {
    return {
      kind: "invalid",
      message: `gwen.hookNamespace ${shown} of ${pkg} is owned by ${owner}`,
      hint: `Pick a namespace of your own: "${value}" belongs to ${owner}.`,
    };
  }
  return { kind: "valid", value };
}

function hookFinding(
  code: ConformanceFinding["code"],
  message: string,
  hint: string,
  file: string,
  line: number,
): ConformanceFinding {
  return { code, message, hint, file, line };
}

function namespaceFinding(message: string, hint: string): ConformanceFinding {
  return hookFinding(
    ConformanceErrorCodes.HOOK_NAMESPACE_INVALID,
    message,
    hint,
    "package.json",
    1,
  );
}

/**
 * Hook rules: the `gwen.hookNamespace` value, every declared name inside that namespace,
 * and every emit site (`emit`, `callHook`, `callHookParallel`, `callHookWith`) on a declared,
 * owned name. An alias of an emit method is not an emit site.
 */
export async function checkHooks(context: PackageContext): Promise<readonly ConformanceFinding[]> {
  const pkg = packageName(context.manifest);
  const sources = await scanHookSources(context.root);
  const namespace = readHookNamespace(context.manifest, pkg);
  const findings: ConformanceFinding[] = [];
  const hasHooks = sources.declarations.length + sources.emits.length > 0;

  if (namespace.kind === "invalid") {
    findings.push(namespaceFinding(namespace.message, namespace.hint));
  } else if (namespace.kind === "missing" && hasHooks) {
    findings.push(
      namespaceFinding(
        `gwen.hookNamespace of ${pkg} is missing but the package declares or emits a hook`,
        'Set gwen.hookNamespace in package.json, for example "myplug".',
      ),
    );
  }
  const prefix = namespace.kind === "valid" ? `${namespace.value}:` : undefined;
  const declared = new Set(sources.declarations.map((declaration) => declaration.name));

  if (prefix !== undefined) {
    for (const declaration of sources.declarations) {
      if (declaration.name.startsWith(prefix)) continue;
      findings.push(
        hookFinding(
          ConformanceErrorCodes.HOOK_FOREIGN_NAMESPACE,
          `${pkg} declares "${declaration.name}", outside its hook namespace "${prefix.slice(0, -1)}"`,
          `Rename the hook to "${prefix}<action>".`,
          declaration.file,
          declaration.line,
        ),
      );
    }
  }

  for (const emit of sources.emits) {
    if (emit.name === undefined) {
      findings.push(
        hookFinding(
          ConformanceErrorCodes.HOOK_DYNAMIC_NAME,
          `${pkg} emits a hook whose name cannot be read from the source: ${emit.source}`,
          "Emit a string literal, or a const initialised with one, so the name can be checked.",
          emit.file,
          emit.line,
        ),
      );
      continue;
    }
    const name = emit.name;
    const colon = name.indexOf(":");
    const emitNamespace = colon === -1 ? undefined : name.slice(0, colon);
    const owner = emitNamespace === undefined ? undefined : frameworkOwner(emitNamespace);
    if (emitNamespace !== undefined && (isCoreReserved(emitNamespace) || owner !== undefined)) {
      findings.push(
        hookFinding(
          ConformanceErrorCodes.HOOK_RESERVED,
          owner === undefined
            ? `${pkg} emits "${name}" in the namespace "${emitNamespace}", which is reserved by the core`
            : `${pkg} emits "${name}" in the namespace "${emitNamespace}", which is owned by ${owner}`,
          owner === undefined
            ? "Listen to it with useHook, and emit a hook from your own namespace."
            : `Listen to it with useHook, or emit a hook from your own namespace. ${owner} emits it.`,
          emit.file,
          emit.line,
        ),
      );
    } else if (prefix !== undefined && !name.startsWith(prefix)) {
      findings.push(
        hookFinding(
          ConformanceErrorCodes.HOOK_FOREIGN_NAMESPACE,
          `${pkg} emits "${name}", outside its hook namespace "${prefix.slice(0, -1)}"`,
          `Emit a hook named "${prefix}<action>".`,
          emit.file,
          emit.line,
        ),
      );
    } else if (prefix !== undefined && !declared.has(name)) {
      findings.push(
        hookFinding(
          ConformanceErrorCodes.HOOK_UNDECLARED,
          `${pkg} emits "${name}" but does not declare it`,
          `Declare "${name}" with defineHooks, or in a GwenRuntimeHooks augmentation of @gwenjs/schema.`,
          emit.file,
          emit.line,
        ),
      );
    }
  }
  return findings;
}
