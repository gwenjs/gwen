import { FRAMEWORK_RANGES } from "@gwenjs/schema";
import { satisfies, valid, validRange } from "semver";
import { ConformanceErrorCodes } from "./error-codes.js";
import { readExtensionManifest } from "./extension-manifest.js";
import type { ExtensionBase } from "./extension-manifest.js";
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

/** Specs semver will not treat as a range for a base peer. */
const RANGE_PROTOCOLS = ["workspace:", "file:", "link:", "npm:"] as const;

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

function hasRangeProtocol(spec: string): boolean {
  for (const protocol of RANGE_PROTOCOLS) {
    if (spec.startsWith(protocol)) return true;
  }
  return false;
}

/**
 * Normalised semver range, or `undefined` when the spec is unusable.
 * An any-range (`*`, `x`, `X`, `x.x.x`, `>=0.0.0`, empty) normalises to `*`.
 * `latest` and a `workspace:`, `file:`, `link:` or `npm:` spec are unusable.
 */
function usablePeerRange(spec: string): string | undefined {
  if (spec === "latest" || hasRangeProtocol(spec)) return undefined;
  const normalised = validRange(spec);
  if (normalised === null) return undefined;
  if (normalised === "*") return undefined;
  return normalised;
}

/** Exact version shape, a semver `valid` version, and `satisfies` inside `range`. */
function pinFits(pin: string, range: string): boolean {
  if (!EXACT_VERSION.test(pin)) return false;
  if (valid(pin) === null) return false;
  return satisfies(pin, range, { includePrerelease: true });
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
 * One `EXTENSION_PEER` per base per problem.
 * Order: absent peer, `dependencies` / `optionalDependencies`, range, then pin.
 * The pin is checked only when the peer range is usable.
 */
function extensionPeerFindings(
  manifest: Record<string, unknown>,
  index: JsonIndex,
  bases: readonly ExtensionBase[],
): ConformanceFinding[] {
  if (bases.length === 0) return [];
  const peers = sectionRecord(manifest.peerDependencies);
  const devs = sectionRecord(manifest.devDependencies);
  const findings: ConformanceFinding[] = [];
  for (const base of bases) {
    const peerPresent = peers !== undefined && Object.hasOwn(peers, base.name);
    if (!peerPresent) {
      findings.push(
        finding(
          ConformanceErrorCodes.EXTENSION_PEER,
          `base ${JSON.stringify(base.name)} is listed in gwen.extends but not in peerDependencies`,
          `Declare ${JSON.stringify(base.name)} in peerDependencies on a usable semver range, and pin an exact version in devDependencies.`,
          base.line,
        ),
      );
    }
    for (const section of DEPENDENCY_SECTIONS) {
      const block = sectionRecord(manifest[section]);
      if (block === undefined || !Object.hasOwn(block, base.name)) continue;
      findings.push(
        finding(
          ConformanceErrorCodes.EXTENSION_PEER,
          `base ${JSON.stringify(base.name)} is declared in ${section}, not in peerDependencies`,
          `Move ${JSON.stringify(base.name)} from ${section} to peerDependencies.`,
          keyLine(index, section, base.name),
        ),
      );
    }
    if (!peerPresent || peers === undefined) continue;
    const peerSpec: unknown = peers[base.name];
    const range = typeof peerSpec === "string" ? usablePeerRange(peerSpec) : undefined;
    if (range === undefined) {
      findings.push(
        finding(
          ConformanceErrorCodes.EXTENSION_PEER,
          `peer ${JSON.stringify(base.name)} has range ${shownSpec(peerSpec)}, which is not a usable semver range`,
          `Replace the peerDependencies range of ${base.name} with a usable semver range, for example "^1.0.0".`,
          keyLine(index, "peerDependencies", base.name),
        ),
      );
      continue;
    }
    if (devs === undefined || !Object.hasOwn(devs, base.name)) {
      findings.push(
        finding(
          ConformanceErrorCodes.EXTENSION_PEER,
          `base ${JSON.stringify(base.name)} has no exact devDependency pin`,
          `Pin ${base.name} in devDependencies to an exact version inside the peer range.`,
          base.line,
        ),
      );
      continue;
    }
    const pin = devs[base.name];
    if (typeof peerSpec !== "string" || typeof pin !== "string" || !pinFits(pin, peerSpec)) {
      const rangeText = typeof peerSpec === "string" ? peerSpec : shownSpec(peerSpec);
      findings.push(
        finding(
          ConformanceErrorCodes.EXTENSION_PEER,
          `devDependency ${JSON.stringify(base.name)} is ${shownSpec(pin)}, not an exact version inside the peer range ${JSON.stringify(rangeText)}`,
          `Pin ${base.name} in devDependencies to an exact version inside ${JSON.stringify(rangeText)}.`,
          keyLine(index, "devDependencies", base.name),
        ),
      );
    }
  }
  return findings;
}

/**
 * Framework peers (own keys of `FRAMEWORK_RANGES` in `peerDependencies`) and base peers
 * (names kept from `gwen.extends`) that `src` never uses.
 * `src` is read only when such a peer exists.
 */
async function unusedFindings(
  root: string,
  manifest: Record<string, unknown>,
  index: JsonIndex,
  bases: readonly ExtensionBase[],
): Promise<ConformanceFinding[]> {
  const block = sectionRecord(manifest.peerDependencies);
  if (block === undefined) return [];
  const baseNames = new Set(bases.map((base) => base.name));
  const names = Object.keys(block).filter(
    (name) => frameworkRange(name) !== undefined || baseNames.has(name),
  );
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
 * Peer policy for every own key of `FRAMEWORK_RANGES`, and for each base kept from `gwen.extends`.
 * A framework package in `dependencies` or `optionalDependencies` is `PEER_RANGE`, except
 * `@gwenjs/math` (any spec). A `peerDependencies` spec that is not that package's range is
 * `PEER_RANGE` (strict string equality). A `devDependencies` spec that is not an exact version is
 * `DEV_PIN`. A framework peer or a base peer that no non-test script or declaration file under
 * `src` uses is `PEER_UNUSED`. A base absent from `peerDependencies`, listed in `dependencies` or
 * `optionalDependencies`, given an unusable peer range, or given no exact devDependency pin inside
 * that range, is `EXTENSION_PEER`. A section that is not an object is skipped. Runs for both profiles.
 */
export async function checkPeers(context: PackageContext): Promise<readonly ConformanceFinding[]> {
  const manifest = context.manifest;
  if (!isRecord(manifest)) return [];
  const index = indexJson(context.text);
  const bases = readExtensionManifest(context).bases;
  return [
    ...dependencyFindings(manifest, index),
    ...peerFindings(manifest, index),
    ...devFindings(manifest, index),
    ...extensionPeerFindings(manifest, index, bases),
    ...(await unusedFindings(context.root, manifest, index, bases)),
  ];
}
