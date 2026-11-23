import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, devNull } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

export interface LockfileEntry {
  readonly name: string;
  readonly version: string;
  /** Inside of the `snapshots:` peer suffix. The `packages:` key stays `name@version`. */
  readonly peers?: string;
}

export interface LockfileFixture {
  readonly root: string;
  readonly cleanup: () => Promise<void>;
}

const PACKAGE_JSON = `${JSON.stringify(
  { name: "lockfile-fixture", license: "MPL-2.0", gwen: { type: "plugin" } },
  null,
  2,
)}\n`;

/**
 * Copy of `process.env` with every `GIT_*` key removed, then a closed config and an author.
 * A hook exports `GIT_DIR`; without the scrub, `git init` in a temp dir writes into that repo.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = devNull;
  env.GIT_AUTHOR_NAME = "Gwen Test";
  env.GIT_AUTHOR_EMAIL = "gwen-test@example.com";
  env.GIT_COMMITTER_NAME = "Gwen Test";
  env.GIT_COMMITTER_EMAIL = "gwen-test@example.com";
  return env;
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", args, { cwd, env: gitEnv() });
}

function quoteKey(key: string): string {
  return key.startsWith("@") ? `'${key}'` : key;
}

function packageKey(entry: LockfileEntry): string {
  return `${entry.name}@${entry.version}`;
}

function snapshotKey(entry: LockfileEntry): string {
  const base = packageKey(entry);
  return entry.peers === undefined ? base : `${base}(${entry.peers})`;
}

/**
 * pnpm lockfile v9. Zero entries omit `packages:` and `snapshots:`.
 * Entry `i` of `packages:` is line `13 + 3 * i`.
 */
export function lockfileText(entries: readonly LockfileEntry[]): string {
  const lines = [
    "lockfileVersion: '9.0'",
    "",
    "settings:",
    "  autoInstallPeers: true",
    "  excludeLinksFromLockfile: false",
    "",
    "importers:",
    "",
    "  .: {}",
  ];
  if (entries.length === 0) return `${lines.join("\n")}\n`;
  lines.push("", "packages:", "");
  for (const entry of entries) {
    lines.push(`  ${quoteKey(packageKey(entry))}:`, "    resolution: {integrity: sha512-AAAA}", "");
  }
  lines.push("snapshots:", "");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    lines.push(`  ${quoteKey(snapshotKey(entry))}: {}`);
    if (index < entries.length - 1) lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/** Rewrite `pnpm-lock.yaml` without committing it. */
export async function writeLockfile(root: string, text: string): Promise<void> {
  await writeFile(path.join(root, "pnpm-lock.yaml"), text);
}

/** Package directory `sub` inside `repo`, still in that git repository. */
export async function packageSubdir(repo: string): Promise<string> {
  const root = path.join(repo, "sub");
  await mkdir(root);
  await writeFile(path.join(root, "package.json"), PACKAGE_JSON);
  await writeFile(path.join(root, "LICENSE"), "MPL-2.0\n");
  return root;
}

/** `git init -q -b main` in `root`, through {@link gitEnv}. */
export function initGitRepo(root: string): void {
  git(root, ["init", "-q", "-b", "main"]);
}

/** Write `pnpm-lock.yaml` and commit it on `main`. */
export async function commitLockfile(root: string, text: string): Promise<void> {
  await writeLockfile(root, text);
  git(root, ["add", "pnpm-lock.yaml"]);
  git(root, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "x"]);
}

/**
 * Register an `afterEach` that removes every temp lockfile repo the returned opener made, and
 * return that opener. Same shape as `fixtureOpener` in `tests/helpers/fixture.ts`.
 */
export function openLockfileFixture(): () => Promise<LockfileFixture> {
  const opened: LockfileFixture[] = [];
  afterEach(async () => {
    for (const fixture of opened.splice(0)) await fixture.cleanup();
  });
  return async () => {
    const root = await mkdtemp(path.join(tmpdir(), "gwen-lockfile-"));
    await writeFile(path.join(root, "package.json"), PACKAGE_JSON);
    await writeFile(path.join(root, "LICENSE"), "MPL-2.0\n");
    git(root, ["init", "-q", "-b", "main"]);
    let removed = false;
    const fixture: LockfileFixture = {
      root,
      async cleanup() {
        if (removed) return;
        removed = true;
        await rm(root, { recursive: true, force: true });
      },
    };
    opened.push(fixture);
    return fixture;
  };
}
