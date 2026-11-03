import { mkdir, mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/good-plugin",
);

export interface ExportCondition {
  types?: string;
  import?: string;
}

export interface FixtureManifest {
  name: string;
  version?: string;
  license?: string;
  type?: string;
  gwen?: { type: string };
  repository?: string;
  exports?: Record<string, string | ExportCondition>;
}

export interface Fixture {
  readonly root: string;
  readonly cleanup: () => Promise<void>;
}

const hooksFixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/hooks",
);

/** Name of the snapshot file at a package root. */
export const SNAPSHOT_FILE = "public-api.snap.json";

export function goodPluginRoot(): string {
  return fixtureDir;
}

/** Read-only root of a `tests/fixtures/hooks/<name>` package. */
export function hooksFixtureRoot(name: string): string {
  return path.join(hooksFixturesDir, name);
}

async function copyFixture(source: string): Promise<Fixture> {
  const parent = await mkdtemp(path.join(tmpdir(), "gwen-conformance-"));
  const root = path.join(parent, "pkg");
  await cp(source, root, { recursive: true });
  let removed = false;
  return {
    root,
    async cleanup() {
      if (removed) return;
      removed = true;
      await rm(parent, { recursive: true, force: true });
    },
  };
}

export async function createFixture(): Promise<Fixture> {
  return copyFixture(fixtureDir);
}

/** Temp copy of `tests/fixtures/hooks/<name>`, so a test can edit it. */
export async function createHooksFixture(name: string): Promise<Fixture> {
  return copyFixture(hooksFixtureRoot(name));
}

export async function readPackageText(root: string): Promise<string> {
  return readFile(path.join(root, "package.json"), "utf8");
}

/** Replace `package.json` with `text` exactly, so a test can assert a literal line. */
export async function writeManifestText(root: string, text: string): Promise<void> {
  await writeFile(path.join(root, "package.json"), text);
}

export async function editManifest(
  root: string,
  edit: (manifest: FixtureManifest) => void,
): Promise<void> {
  const text = await readPackageText(root);
  const manifest = JSON.parse(text) as FixtureManifest;
  edit(manifest);
  await writeFile(path.join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

interface HooksManifest {
  gwen: { type: string; hookNamespace?: unknown };
}

/** Set `gwen.hookNamespace` to `value` as is (any JSON value), or remove it for `undefined`. */
export async function setHookNamespace(root: string, value: unknown): Promise<void> {
  const manifest = JSON.parse(await readPackageText(root)) as HooksManifest;
  if (value === undefined) delete manifest.gwen.hookNamespace;
  else manifest.gwen.hookNamespace = value;
  await writeFile(path.join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Write `text` to `relative` under `root`, replacing the file. */
export async function writeSource(root: string, relative: string, text: string): Promise<void> {
  await writeFile(path.join(root, relative), text);
}

/** Like {@link writeSource}, and creates the missing directories of `relative`. */
export async function writeDeep(root: string, relative: string, text: string): Promise<void> {
  const full = path.join(root, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, text);
}

export function manifestExports(
  manifest: FixtureManifest,
): Record<string, string | ExportCondition> {
  if (manifest.exports === undefined) {
    throw new Error("fixture is missing exports");
  }
  return manifest.exports;
}

export async function stripPluginManifest(root: string): Promise<void> {
  await editManifest(root, (manifest) => {
    delete manifest.license;
    delete manifest.gwen;
  });
  await rm(path.join(root, "LICENSE"), { force: true });
}

/**
 * Register an `afterEach` that removes every temp copy of the clean fixture the returned opener
 * made, and return that opener.
 */
export function fixtureOpener(): () => Promise<Fixture> {
  const opened: Fixture[] = [];
  afterEach(async () => {
    for (const fixture of opened.splice(0)) await fixture.cleanup();
  });
  return async () => {
    const fixture = await createFixture();
    opened.push(fixture);
    return fixture;
  };
}

/** Time budget for a test that packs the fixture and runs publint and attw. */
export const SLOW_TEST_MS = 60_000;

/**
 * Run `body` with `TMPDIR` pointing to a fresh directory, then restore it and remove the
 * directory: whatever a check leaves in the temp dir is found there, and cleaned up.
 */
export async function withPrivateTmpdir<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "gwen-conformance-tmp-"));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  try {
    return await body(dir);
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

export const BARE_MANIFEST_MESSAGES = [
  "LICENSE file is missing",
  'gwen.type must be "plugin"',
  "license must be a non-empty string",
] as const;
