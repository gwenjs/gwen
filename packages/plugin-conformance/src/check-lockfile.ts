import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConformanceErrorCodes } from "./error-codes.js";
import { lockfileEntries, lockfileVersion } from "./lockfile-entries.js";
import type { LockfilePackage } from "./lockfile-entries.js";
import { readBaseLockfile } from "./read-base-lockfile.js";
import type { ConformanceFinding } from "./types.js";

const DRIFT_HINT =
  "Commit the updated pnpm-lock.yaml and review the third-party change, or pin the package. A stack install must move only @gwenjs packages.";
const SPEC_HINT = "Pass a git ref that holds pnpm-lock.yaml at the package root, for example HEAD.";
const VERSION_HINT =
  "Run the check with pnpm 10 (lockfileVersion 9.0), or regenerate the lockfile.";

/** Compare `<root>/pnpm-lock.yaml` with the copy of that file at `ref`. */
export async function checkLockfile(
  root: string,
  ref: string,
): Promise<readonly ConformanceFinding[]> {
  if (ref.length === 0) return [spec("lockfileBase must not be empty")];
  if (ref.startsWith("-")) {
    return [spec(`lockfileBase ${JSON.stringify(ref)} must not start with "-"`)];
  }
  // A bad ref is reported even when the working lockfile is absent.
  const base = await readBaseLockfile(root, ref);
  if (!base.ok) {
    if (base.kind === "missing") return [spec(`${ref}:pnpm-lock.yaml does not exist`)];
    if (base.kind === "unavailable") return [spec(`git could not run: ${base.code}`)];
    return [spec(`lockfileBase ${JSON.stringify(ref)} does not resolve: ${base.detail}`)];
  }
  let working: string;
  try {
    working = await readFile(path.join(root, "pnpm-lock.yaml"), "utf8");
  } catch (error) {
    if (readErrorCode(error) === "ENOENT") {
      return [spec("pnpm-lock.yaml does not exist in the package root")];
    }
    throw error;
  }
  const versionFinding = badVersion(ref, working, base.text);
  if (versionFinding !== undefined) return [versionFinding];
  return diff(ref, lockfileEntries(working), lockfileEntries(base.text));
}

function badVersion(ref: string, working: string, base: string): ConformanceFinding | undefined {
  const current = lockfileVersion(working);
  if (current !== "9.0") return versionSpec("pnpm-lock.yaml", current);
  const previous = lockfileVersion(base);
  if (previous !== "9.0") return versionSpec(`${ref}:pnpm-lock.yaml`, previous);
  return undefined;
}

function versionSpec(file: string, version: string): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.INVALID_SPEC,
    message: `${file} has lockfileVersion ${JSON.stringify(version)}, expected "9.0"`,
    hint: VERSION_HINT,
    file,
  };
}

function spec(message: string): ConformanceFinding {
  return { code: ConformanceErrorCodes.INVALID_SPEC, message, hint: SPEC_HINT };
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function versionsOf(entry: LockfilePackage): string {
  return [...new Set(entry.versions)].sort(compareText).join(", ");
}

function diff(
  ref: string,
  next: ReadonlyMap<string, LockfilePackage>,
  previous: ReadonlyMap<string, LockfilePackage>,
): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const names = [...new Set([...next.keys(), ...previous.keys()])].sort(compareText);
  for (const name of names) {
    const current = next.get(name);
    const base = previous.get(name);
    const label = JSON.stringify(name);
    if (current === undefined) {
      if (base === undefined) continue;
      const baseFile = `${ref}:pnpm-lock.yaml`;
      findings.push(drift(gone(label, ref, versionsOf(base)), baseFile, base.line));
      continue;
    }
    if (base === undefined) {
      findings.push(
        drift(addedMessage(label, ref, versionsOf(current)), "pnpm-lock.yaml", current.line),
      );
      continue;
    }
    const nextVersions = versionsOf(current);
    const baseVersions = versionsOf(base);
    if (nextVersions === baseVersions) continue;
    findings.push(
      drift(changed(label, ref, nextVersions, baseVersions), "pnpm-lock.yaml", current.line),
    );
  }
  return findings;
}

function gone(label: string, ref: string, versions: string): string {
  return `third-party package ${label} is gone: base ref ${ref} has ${versions}`;
}

function addedMessage(label: string, ref: string, versions: string): string {
  return `third-party package ${label} is new: ${versions}, base ref ${ref} does not have it`;
}

function changed(label: string, ref: string, next: string, base: string): string {
  return `third-party package ${label} resolves to ${next}, base ref ${ref} has ${base}`;
}

function drift(message: string, file: string, line: number): ConformanceFinding {
  return { code: ConformanceErrorCodes.LOCKFILE_DRIFT, message, hint: DRIFT_HINT, file, line };
}
