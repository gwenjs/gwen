import { stat } from "node:fs/promises";
import path from "node:path";
import { ConformanceErrorCodes } from "./error-codes.js";
import type { ExtensionBase, ExtensionListing, ExtensionProblem } from "./extension-manifest.js";
import { readExtensionManifest } from "./extension-manifest.js";
import { FRAMEWORK_PACKAGES } from "./framework-packages.js";
import { installedHookNamespace, resolveInstalledPackage } from "./installed-package.js";
import { isRecord } from "./json.js";
import { manifestFinding } from "./manifest-finding.js";
import type { PackageContext } from "./package-context.js";
import type { ConformanceFinding } from "./types.js";

const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt"] as const;

function gwenType(manifest: unknown): unknown {
  if (!isRecord(manifest)) return undefined;
  const gwen = manifest.gwen;
  if (!isRecord(gwen)) return undefined;
  return gwen.type;
}

function hasLicense(manifest: unknown): boolean {
  if (!isRecord(manifest)) return false;
  const license = manifest.license;
  return typeof license === "string" && license.length > 0;
}

async function hasLicenseFile(root: string): Promise<boolean> {
  for (const name of LICENSE_FILES) {
    try {
      const info = await stat(path.join(root, name));
      if (info.isFile()) return true;
    } catch {
      // A missing name is expected; try the next accepted file name.
    }
  }
  return false;
}

/** Manifest rules for `plugin` (includes `gwen.type`) and `package`. */
export async function checkManifest(
  context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  if (context.profile === "plugin" && gwenType(context.manifest) !== "plugin") {
    findings.push(
      manifestFinding('gwen.type must be "plugin"', 'Set gwen.type to "plugin" in package.json.'),
    );
  }
  if (!hasLicense(context.manifest)) {
    findings.push(
      manifestFinding(
        "license must be a non-empty string",
        "Set license to a non-empty SPDX string.",
      ),
    );
  }
  if (!(await hasLicenseFile(context.root))) {
    findings.push(
      manifestFinding(
        "LICENSE file is missing",
        "Add LICENSE, LICENSE.md, or LICENSE.txt at the package root.",
      ),
    );
  }
  const read = readExtensionManifest(context);
  for (const problem of read.problems) {
    findings.push(extendsProblemFinding(problem));
  }
  if (isOfficial(read.name) && read.bases.length > 0) {
    findings.push(extensionOfficialFinding(read));
  }
  for (const base of read.bases) {
    for (const item of await baseExtensibleFindings(context.root, base)) {
      findings.push(item);
    }
  }
  return findings;
}

/**
 * One `BASE_NOT_EXTENSIBLE` per problem of a validated base.
 * A base that is absent or whose `package.json` cannot be parsed stops there.
 * A framework package name is checked the same way as every other base.
 */
async function baseExtensibleFindings(
  root: string,
  base: ExtensionBase,
): Promise<readonly ConformanceFinding[]> {
  const installed = await resolveInstalledPackage(root, base.name);
  if (installed.kind === "absent") {
    return [baseNotExtensible(base, unresolvedMessage(base.name), unresolvedHint(base.name))];
  }
  if (installed.kind === "unparsed") {
    return [baseNotExtensible(base, unparsedMessage(base.name), unparsedHint(base.name))];
  }
  const findings: ConformanceFinding[] = [];
  if (!hasExtensionExport(installed.manifest)) {
    findings.push(
      baseNotExtensible(base, noExtensionMessage(base.name), noExtensionHint(base.name)),
    );
  }
  if (installedHookNamespace(installed.manifest) === undefined) {
    findings.push(
      baseNotExtensible(base, noNamespaceMessage(base.name), noNamespaceHint(base.name)),
    );
  }
  return findings;
}

function unresolvedMessage(name: string): string {
  return `base "${name}" cannot be resolved from node_modules`;
}

function unparsedMessage(name: string): string {
  return `base "${name}" has a package.json that cannot be parsed`;
}

function noExtensionMessage(name: string): string {
  return `base "${name}" has no "./extension" export`;
}

function noNamespaceMessage(name: string): string {
  return `base "${name}" has no gwen.hookNamespace`;
}

function unresolvedHint(name: string): string {
  return `Install "${name}" in node_modules of this package or of an ancestor.`;
}

function unparsedHint(name: string): string {
  return `Fix the JSON syntax of the installed package.json of "${name}".`;
}

function noExtensionHint(name: string): string {
  return `Add an "./extension" entry to the exports of "${name}": a string or a condition object.`;
}

function noNamespaceHint(name: string): string {
  return `Set gwen.hookNamespace on "${name}".`;
}

/** `exports["./extension"]` is present when it is a string or a condition object. */
function hasExtensionExport(manifest: unknown): boolean {
  if (!isRecord(manifest)) return false;
  const exportsField = manifest.exports;
  if (!isRecord(exportsField)) return false;
  const entry = exportsField["./extension"];
  return typeof entry === "string" || isRecord(entry);
}

function baseNotExtensible(base: ExtensionBase, message: string, hint: string): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.BASE_NOT_EXTENSIBLE,
    message,
    hint,
    file: "package.json",
    line: base.line,
  };
}

function extendsProblemFinding(problem: ExtensionProblem): ConformanceFinding {
  const pinned = manifestFinding(problem.message, problem.hint);
  return {
    code: pinned.code,
    message: pinned.message,
    hint: pinned.hint,
    file: pinned.file ?? "package.json",
    line: problem.line,
  };
}

function isOfficial(name: string): boolean {
  return name.startsWith("@gwenjs/") && !FRAMEWORK_PACKAGES.has(name);
}

function extensionOfficialFinding(read: ExtensionListing): ConformanceFinding {
  const listed = read.bases.map((base) => `"${base.name}"`).join(", ");
  const pinned = manifestFinding(
    `"${read.name}" is an official package and lists ${listed} in gwen.extends`,
    "Remove gwen.extends. An official package names only plugins of its own package and framework plugins: use requires.services or requires.optional on schema contracts.",
  );
  return {
    code: ConformanceErrorCodes.EXTENSION_OFFICIAL,
    message: pinned.message,
    hint: pinned.hint,
    file: pinned.file ?? "package.json",
    line: read.extendsLine,
  };
}
