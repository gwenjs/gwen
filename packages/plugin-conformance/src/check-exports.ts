import { stat } from "node:fs/promises";
import path from "node:path";
import { ConformanceErrorCodes } from "./error-codes.js";
import { indexJson, isRecord } from "./json.js";
import type { JsonIndex } from "./json.js";
import type { PackageContext } from "./package-context.js";
import type { ConformanceFinding } from "./types.js";

const PLUGIN_SUBPATHS = [".", "./module"] as const;
const EXPORTS_PATH = ["exports"] as const;

function isInternalSubpath(subpath: string): boolean {
  if (subpath.startsWith("./internal*")) return true;
  return subpath === "./internal" || subpath.startsWith("./internal/");
}

function exportsFinding(message: string, hint: string, line: number): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.EXPORTS_INVALID,
    message,
    hint,
    file: "package.json",
    line,
  };
}

function targetEscapesRoot(root: string, target: string): boolean {
  const relative = path.relative(root, path.resolve(root, target));
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

async function targetFileExists(root: string, target: string): Promise<boolean> {
  try {
    const info = await stat(path.resolve(root, target));
    return info.isFile();
  } catch {
    return false;
  }
}

interface TargetCheck {
  readonly subpath: string;
  readonly target: string;
  readonly line: number;
}

/** What one `exports` check shares while it walks the manifest. */
interface ExportsScan {
  readonly context: PackageContext;
  readonly index: JsonIndex;
  readonly findings: ConformanceFinding[];
  readonly pending: TargetCheck[];
}

/** Line where the value at `path` starts; line 1 when the text has no such path. */
function valueLineOf(scan: ExportsScan, path: readonly string[]): number {
  return scan.index.valueLine(path) ?? 1;
}

/** Line of the key at `path`, else where its value starts; line 1 when the text has neither. */
function keyLineOf(scan: ExportsScan, path: readonly string[]): number {
  return scan.index.keyLine(path) ?? scan.index.valueLine(path) ?? 1;
}

function visitTarget(
  scan: ExportsScan,
  subpath: string,
  target: string,
  path: readonly string[],
): void {
  const line = valueLineOf(scan, path);
  if (targetEscapesRoot(scan.context.root, target)) {
    scan.findings.push(
      exportsFinding(
        `export ${JSON.stringify(target)} of subpath ${JSON.stringify(subpath)} resolves outside the package root`,
        `Point ${JSON.stringify(subpath)} at a file inside the package.`,
        line,
      ),
    );
    return;
  }
  if (!target.startsWith("./")) {
    scan.findings.push(
      exportsFinding(
        `export ${JSON.stringify(target)} of subpath ${JSON.stringify(subpath)} must start with "./"`,
        `Prefix ${JSON.stringify(target)} with "./".`,
        line,
      ),
    );
    return;
  }
  if (target.includes("*")) return;
  scan.pending.push({ subpath, target, line });
}

async function reportIfMissing(
  context: PackageContext,
  subpath: string,
  target: string,
  line: number,
  findings: ConformanceFinding[],
): Promise<void> {
  if (!(await targetFileExists(context.root, target))) {
    findings.push(
      exportsFinding(
        `export ${JSON.stringify(target)} of subpath ${JSON.stringify(subpath)} is missing`,
        `Add ${JSON.stringify(target)} inside the package, or change the target.`,
        line,
      ),
    );
  }
}

function visitExportValue(
  scan: ExportsScan,
  subpath: string,
  value: unknown,
  path: readonly string[],
): void {
  if (typeof value === "string") {
    visitTarget(scan, subpath, value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry: unknown, position) => {
      visitExportValue(scan, subpath, entry, [...path, String(position)]);
    });
    return;
  }
  if (value === null) return;
  if (!isRecord(value)) {
    scan.findings.push(
      exportsFinding(
        `export of subpath ${JSON.stringify(subpath)} must be a string, an array, an object or null`,
        `Replace the ${JSON.stringify(subpath)} target with a string, an array, an object, or null.`,
        valueLineOf(scan, path),
      ),
    );
    return;
  }
  const keys = Object.keys(value);
  const first = keys[0];
  if (keys.includes("types") && first !== "types") {
    scan.findings.push(
      exportsFinding(
        `subpath ${JSON.stringify(subpath)} lists condition "types" after another key`,
        `Put "types" first in the ${JSON.stringify(subpath)} export.`,
        keyLineOf(scan, path),
      ),
    );
  }
  for (const key of keys) {
    visitExportValue(scan, subpath, value[key], [...path, key]);
  }
}

/** `exports` rules. Profile `plugin` also requires `.` and `./module`. */
export async function checkExports(
  context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  const scan: ExportsScan = {
    context,
    index: indexJson(context.text),
    findings: [],
    pending: [],
  };
  const { findings } = scan;
  const manifest = context.manifest;
  const exportsValue = isRecord(manifest) ? manifest.exports : undefined;
  const exportsLine = keyLineOf(scan, EXPORTS_PATH);
  if (!isRecord(exportsValue)) {
    findings.push(
      exportsFinding(
        "exports must be an object",
        "Set exports to an object of subpaths.",
        exportsLine,
      ),
    );
    return findings;
  }

  const present = new Set<string>();
  const keys = Object.keys(exportsValue);
  if (keys.length === 0) {
    findings.push(
      exportsFinding(
        "exports must not be empty",
        "Add at least one subpath or condition to exports.",
        exportsLine,
      ),
    );
    return findings;
  }

  const conditionKey = keys.find((key) => !key.startsWith("."));
  const subpathKey = keys.find((key) => key.startsWith("."));
  if (conditionKey !== undefined && subpathKey !== undefined) {
    findings.push(
      exportsFinding(
        `exports mixes subpath keys and condition key ${JSON.stringify(conditionKey)}`,
        "Use only subpath keys, or only condition keys for the root export.",
        exportsLine,
      ),
    );
    return findings;
  }

  if (keys.some((key) => key.startsWith("."))) {
    for (const key of keys) {
      if (!key.startsWith(".")) continue;
      present.add(key);
      const path = [...EXPORTS_PATH, key];
      if (isInternalSubpath(key)) {
        findings.push(
          exportsFinding(
            `subpath ${JSON.stringify(key)} is not a public export`,
            "Remove this subpath. Keep internal modules out of exports.",
            keyLineOf(scan, path),
          ),
        );
      }
      visitExportValue(scan, key, exportsValue[key], path);
    }
  } else {
    present.add(".");
    visitExportValue(scan, ".", exportsValue, EXPORTS_PATH);
  }

  if (context.profile === "plugin") {
    for (const subpath of PLUGIN_SUBPATHS) {
      if (present.has(subpath)) continue;
      findings.push(
        exportsFinding(
          `subpath ${JSON.stringify(subpath)} is required for profile plugin`,
          `Add an exports entry for ${JSON.stringify(subpath)}.`,
          scan.index.keyLine([...EXPORTS_PATH, subpath]) ?? 1,
        ),
      );
    }
  }

  await Promise.all(
    scan.pending.map((job) =>
      reportIfMissing(context, job.subpath, job.target, job.line, findings),
    ),
  );
  return findings;
}
