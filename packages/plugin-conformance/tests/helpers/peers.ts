import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import type { ConformanceFinding, ConformanceReport } from "@gwenjs/plugin-conformance";

/** Manifest fields the peers fixtures write, in this order. Absent keys are omitted. */
export interface PeersManifest {
  readonly name?: string;
  readonly license?: string;
  readonly gwen?: unknown;
  readonly dependencies?: unknown;
  readonly peerDependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly optionalDependencies?: unknown;
}

const KEY_ORDER = [
  "name",
  "license",
  "gwen",
  "dependencies",
  "peerDependencies",
  "devDependencies",
  "optionalDependencies",
] as const;

const PEER_CODES: readonly string[] = [
  "CONFORMANCE:PEER_RANGE",
  "CONFORMANCE:DEV_PIN",
  "CONFORMANCE:PEER_UNUSED",
];

export interface PeersFixture {
  readonly root: string;
}

function orderedManifest(manifest: PeersManifest): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    if (!Object.hasOwn(manifest, key)) continue;
    ordered[key] = manifest[key];
  }
  return ordered;
}

/**
 * Register an `afterEach` that removes every temp package the returned opener made, and return
 * that opener. `package.json` is 2-space JSON plus a final newline, keys in {@link KEY_ORDER}.
 * Each `sources` path is written under the temp root (`src/…` or `tests/…`).
 */
export function openPeersFixture(): (
  manifest: PeersManifest,
  sources?: Readonly<Record<string, string>>,
) => Promise<PeersFixture> {
  const roots: string[] = [];
  afterEach(async () => {
    const pending = roots.splice(0);
    for (const root of pending) {
      await rm(root, { recursive: true, force: true });
    }
  });
  return async (manifest, sources) => {
    const root = await mkdtemp(path.join(tmpdir(), "gwen-peers-"));
    roots.push(root);
    const text = `${JSON.stringify(orderedManifest(manifest), null, 2)}\n`;
    await writeFile(path.join(root, "package.json"), text);
    if (sources !== undefined) {
      for (const [relative, body] of Object.entries(sources)) {
        const full = path.join(root, relative);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, body);
      }
    }
    return { root };
  };
}

/** Findings of the peers check: `PEER_RANGE`, `DEV_PIN`, and `PEER_UNUSED`. */
export function peersOf(report: ConformanceReport): ConformanceFinding[] {
  return report.findings.filter((finding) => PEER_CODES.some((code) => code === finding.code));
}
