import { FRAMEWORK_RANGES } from "@gwenjs/schema";
import { ConformanceErrorCodes } from "./error-codes.js";
import { usedPackages } from "./imported-packages.js";
import { indexJson, isRecord } from "./json.js";
import type { JsonIndex } from "./json.js";
import type { PackageContext } from "./package-context.js";
import type { ConformanceFinding } from "./types.js";

/** Exact version: `major.minor.patch`, optional prerelease and build. A range does not match. */
const EXACT_VERSION =
  /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

const MATH_PACKAGE = "@gwenjs/math";

const DEPENDENCY_SECTIONS = ["dependencies", "optionalDependencies"] as const;

/** Own range of a framework package, or `undefined` for any other name, including inherited ones. */
function frameworkRange(name: string): string | undefined {
  return Object.hasOwn(FRAMEWORK_RANGES, name) ? FRAMEWORK_RANGES[name] : undefined;
}

function shownSpec(spec: unknown): string {
  return JSON.stringify(spec);
}

/** A missing section or a section that is not an object is skipped. Never throws. */
function sectionRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return value;
}

function keyLine(index: JsonIndex, section: string, name: string): number {
  return index.keyLine([section, name]) ?? 1;
}

function finding(
  code: ConformanceFinding["code"],
  message: string,
  hint: string,
  line: number,
): ConformanceFinding {
  return { code, message, hint, file: "package.json", line };
}

function dependencyFindings(
  manifest: Record<string, unknown>,
  index: JsonIndex,
): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const block = sectionRecord(manifest[section]);
    if (block === undefined) continue;
    for (const name of Object.keys(block)) {
      const expected = frameworkRange(name);
      if (expected === undefined) continue;
      if (name === MATH_PACKAGE) continue;
      findings.push(
        finding(
          ConformanceErrorCodes.PEER_RANGE,
          `${name} is declared in ${section}, not in peerDependencies`,
          `Move ${JSON.stringify(name)} to peerDependencies on ${JSON.stringify(expected)} and pin it exactly in devDependencies.`,
          keyLine(index, section, name),
        ),
      );
    }
  }
  return findings;
}

function peerFindings(manifest: Record<string, unknown>, index: JsonIndex): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const block = sectionRecord(manifest.peerDependencies);
  if (block === undefined) return findings;
  for (const name of Object.keys(block)) {
    const expected = frameworkRange(name);
    if (expected === undefined) continue;
    const spec = block[name];
    if (typeof spec === "string" && spec === expected) continue;
    findings.push(
      finding(
        ConformanceErrorCodes.PEER_RANGE,
        `peer ${JSON.stringify(name)} has range ${shownSpec(spec)}, expected ${JSON.stringify(expected)}`,
        `Set the peerDependencies range of ${name} to ${JSON.stringify(expected)}.`,
        keyLine(index, "peerDependencies", name),
      ),
    );
  }
  return findings;
}

function devFindings(manifest: Record<string, unknown>, index: JsonIndex): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const block = sectionRecord(manifest.devDependencies);
  if (block === undefined) return findings;
  for (const name of Object.keys(block)) {
    if (frameworkRange(name) === undefined) continue;
    const spec = block[name];
    if (typeof spec === "string" && EXACT_VERSION.test(spec)) continue;
    findings.push(
      finding(
        ConformanceErrorCodes.DEV_PIN,
        `devDependency ${JSON.stringify(name)} is ${shownSpec(spec)}, not an exact version`,
        `Pin ${name} in devDependencies to the exact version the tests run against.`,
        keyLine(index, "devDependencies", name),
      ),
    );
  }
  return findings;
}

/**
 * Framework peers (own keys of `FRAMEWORK_RANGES` in `peerDependencies`) that `src` never uses.
 * `src` is read only when such a peer exists.
 */
async function unusedFindings(
  root: string,
  manifest: Record<string, unknown>,
  index: JsonIndex,
): Promise<ConformanceFinding[]> {
  const block = sectionRecord(manifest.peerDependencies);
  if (block === undefined) return [];
  const names = Object.keys(block).filter((name) => frameworkRange(name) !== undefined);
  if (names.length === 0) return [];
  const used = await usedPackages(root);
  const findings: ConformanceFinding[] = [];
  for (const name of names) {
    if (used.has(name)) continue;
    findings.push(
      finding(
        ConformanceErrorCodes.PEER_UNUSED,
        `peer ${JSON.stringify(name)} is declared but src never uses it`,
        `Remove ${JSON.stringify(name)} from peerDependencies, or import it from src.`,
        keyLine(index, "peerDependencies", name),
      ),
    );
  }
  return findings;
}

/**
 * Peer policy for every own key of `FRAMEWORK_RANGES`.
 * A framework package in `dependencies` or `optionalDependencies` is `PEER_RANGE`, except
 * `@gwenjs/math` (any spec). A `peerDependencies` spec that is not that package's range is
 * `PEER_RANGE` (strict string equality). A `devDependencies` spec that is not an exact version is
 * `DEV_PIN`. A framework peer that no non-test script or declaration file under `src` uses is `PEER_UNUSED`. A section
 * that is not an object is skipped. Runs for both profiles.
 */
export async function checkPeers(context: PackageContext): Promise<readonly ConformanceFinding[]> {
  const manifest = context.manifest;
  if (!isRecord(manifest)) return [];
  const index = indexJson(context.text);
  return [
    ...dependencyFindings(manifest, index),
    ...peerFindings(manifest, index),
    ...devFindings(manifest, index),
    ...(await unusedFindings(context.root, manifest, index)),
  ];
}
