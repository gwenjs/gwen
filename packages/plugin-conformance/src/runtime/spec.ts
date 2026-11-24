import { ConformanceErrorCodes } from "../error-codes.js";
import { isRecord } from "../json.js";
import type { ConformanceFinding } from "../types.js";
import { FRAMEWORK_PLUGIN_NAMES } from "./framework-plugin-names.js";
import type { PluginConformanceSpec } from "./types.js";

const FRAMEWORK_PLUGIN_NAME_SET: ReadonlySet<string> = new Set(FRAMEWORK_PLUGIN_NAMES);

const VARIANTS = ["light", "physics2d", "physics3d"] as const;

type RuntimeVariant = (typeof VARIANTS)[number];

function isVariant(value: string): value is RuntimeVariant {
  return VARIANTS.some((variant) => variant === value);
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** One `INVALID_SPEC` finding. The hint is always set. */
export function runtimeFinding(message: string, hint: string): ConformanceFinding {
  return { code: ConformanceErrorCodes.INVALID_SPEC, message, hint };
}

/**
 * Every `INVALID_SPEC` rule of a runtime spec.
 * Does not read the package.
 */
export function validateSpec(spec: PluginConformanceSpec): ConformanceFinding[] {
  if (!isRecord(spec)) {
    return [runtimeFinding("spec must be an object", "Pass a PluginConformanceSpec.")];
  }
  const findings: ConformanceFinding[] = [];
  const packageName: unknown = spec.packageName;
  if (typeof packageName !== "string" || packageName.length === 0) {
    findings.push(
      runtimeFinding(
        "packageName must be a non-empty string",
        "Set packageName to the name field of package.json.",
      ),
    );
  }
  const factories: unknown = spec.factories;
  if (!isList(factories) || factories.length === 0) {
    findings.push(
      runtimeFinding(
        "factories must list at least one factory",
        "Name at least one factory export from the built entry.",
      ),
    );
  } else {
    for (const factory of factories) {
      const exportName = isRecord(factory) ? factory.export : undefined;
      if (typeof exportName !== "string" || exportName.length === 0) {
        findings.push(
          runtimeFinding(
            "factory export must be a non-empty string",
            "Set each factory export to a function name of the built entry.",
          ),
        );
      }
    }
  }
  const frames: unknown = spec.frames;
  if (
    frames !== undefined &&
    (typeof frames !== "number" || !Number.isInteger(frames) || frames < 1)
  ) {
    findings.push(
      runtimeFinding(
        "frames must be an integer greater than or equal to 1",
        "Pass frames as an integer of 1 or more. The default is 3.",
      ),
    );
  }
  const variant: unknown = spec.variant;
  if (variant !== undefined && (typeof variant !== "string" || !isVariant(variant))) {
    findings.push(
      runtimeFinding(
        `variant ${JSON.stringify(variant)} is not valid. Allowed values: "light", "physics2d", "physics3d"`,
        'Pass variant "light", "physics2d", or "physics3d".',
      ),
    );
  }
  const providers = spec.frameworkProviders;
  if (providers !== undefined) {
    for (const provider of providers) {
      const name = provider().name;
      if (FRAMEWORK_PLUGIN_NAME_SET.has(name)) continue;
      findings.push(
        runtimeFinding(
          `frameworkProviders entry ${JSON.stringify(name)} is not a framework plugin`,
          "Pass a factory whose plugin name is in FRAMEWORK_PLUGIN_NAMES.",
        ),
      );
    }
  }
  return findings;
}
