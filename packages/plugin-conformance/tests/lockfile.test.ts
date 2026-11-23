import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkPluginPackage, ConformanceErrorCodes } from "@gwenjs/plugin-conformance";
import type { ConformanceFinding, ConformanceReport } from "@gwenjs/plugin-conformance";
import {
  commitLockfile,
  gitEnv,
  lockfileText,
  openLockfileFixture,
  packageSubdir,
  writeLockfile,
} from "./helpers/lockfile.js";
import type { LockfileEntry } from "./helpers/lockfile.js";

const openFixture = openLockfileFixture();

/** Literal code. `ConformanceErrorCodes` has no lockfile member on this base. */
const LOCKFILE_DRIFT = "CONFORMANCE:LOCKFILE_DRIFT";

const DRIFT_HINT =
  "Commit the updated pnpm-lock.yaml and review the third-party change, or pin the package. A stack install must move only @gwenjs packages.";

const SPEC_HINT = "Pass a git ref that holds pnpm-lock.yaml at the package root, for example HEAD.";

const LEFT_PAD: LockfileEntry = { name: "left-pad", version: "1.2.0" };
const KLEUR: LockfileEntry = { name: "kleur", version: "4.1.5" };

function withCode(report: ConformanceReport, code: string): ConformanceFinding[] {
  return report.findings.filter((finding) => finding.code === code);
}

function only(findings: readonly ConformanceFinding[]): ConformanceFinding {
  const finding = findings[0];
  if (finding === undefined) throw new Error("expected one finding");
  return finding;
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", args, { cwd, env: gitEnv() });
}

async function check(
  root: string,
  profile: "plugin" | "package",
  lockfileBase?: string,
): Promise<ConformanceReport> {
  if (lockfileBase === undefined) return checkPluginPackage({ root, profile });
  return checkPluginPackage({ root, profile, lockfileBase });
}

describe("lockfile check", () => {
  it("skips the check without lockfileBase and reports the same drift once it is given", async () => {
    const fixture = await openFixture();
    await commitLockfile(fixture.root, lockfileText([LEFT_PAD]));
    await writeLockfile(fixture.root, lockfileText([{ name: "left-pad", version: "1.3.0" }]));

    const skipped = await check(fixture.root, "plugin");
    expect(skipped.checks).not.toContain("lockfile");
    expect(withCode(skipped, LOCKFILE_DRIFT)).toEqual([]);

    const report = await check(fixture.root, "plugin", "HEAD");
    const drifts = withCode(report, LOCKFILE_DRIFT);
    expect(drifts).toHaveLength(1);
    const finding = only(drifts);
    expect({
      code: String(finding.code),
      file: finding.file,
      line: finding.line,
      message: finding.message,
      hint: finding.hint,
    }).toEqual({
      code: LOCKFILE_DRIFT,
      file: "pnpm-lock.yaml",
      line: 13,
      message: 'third-party package "left-pad" resolves to 1.3.0, base ref HEAD has 1.2.0',
      hint: DRIFT_HINT,
    });
  });

  it("reports no finding when the lockfile is unchanged since the base ref", async () => {
    const fixture = await openFixture();
    await commitLockfile(fixture.root, lockfileText([LEFT_PAD]));

    const report = await check(fixture.root, "package", "HEAD");
    expect(report.checks).toContain("lockfile");
    expect(withCode(report, LOCKFILE_DRIFT)).toEqual([]);
  });

  it("reports one finding with the line of the entry when a third-party version is bumped", async () => {
    const fixture = await openFixture();
    await commitLockfile(fixture.root, lockfileText([LEFT_PAD, KLEUR]));
    await writeLockfile(
      fixture.root,
      lockfileText([LEFT_PAD, { name: "kleur", version: "4.1.6" }]),
    );

    const report = await check(fixture.root, "package", "HEAD");
    const drifts = withCode(report, LOCKFILE_DRIFT);
    expect(drifts).toHaveLength(1);
    const finding = only(drifts);
    expect({
      code: String(finding.code),
      file: finding.file,
      line: finding.line,
      message: finding.message,
      hint: finding.hint,
    }).toEqual({
      code: LOCKFILE_DRIFT,
      file: "pnpm-lock.yaml",
      line: 16,
      message: 'third-party package "kleur" resolves to 4.1.6, base ref HEAD has 4.1.5',
      hint: DRIFT_HINT,
    });
  });

  it("reports one finding when a third-party package is added", async () => {
    const fixture = await openFixture();
    await commitLockfile(fixture.root, lockfileText([]));
    await writeLockfile(fixture.root, lockfileText([LEFT_PAD]));

    const report = await check(fixture.root, "package", "HEAD");
    const drifts = withCode(report, LOCKFILE_DRIFT);
    expect(drifts).toHaveLength(1);
    const finding = only(drifts);
    expect({
      code: String(finding.code),
      file: finding.file,
      line: finding.line,
      message: finding.message,
      hint: finding.hint,
    }).toEqual({
      code: LOCKFILE_DRIFT,
      file: "pnpm-lock.yaml",
      line: 13,
      message: 'third-party package "left-pad" is new: 1.2.0, base ref HEAD does not have it',
      hint: DRIFT_HINT,
    });
  });

  it("reports one finding on the base lockfile when a third-party package is removed", async () => {
    const fixture = await openFixture();
    await commitLockfile(fixture.root, lockfileText([LEFT_PAD, KLEUR]));
    await writeLockfile(fixture.root, lockfileText([LEFT_PAD]));

    const report = await check(fixture.root, "plugin", "HEAD");
    const drifts = withCode(report, LOCKFILE_DRIFT);
    expect(drifts).toHaveLength(1);
    const finding = only(drifts);
    expect({
      code: String(finding.code),
      file: finding.file,
      line: finding.line,
      message: finding.message,
      hint: finding.hint,
    }).toEqual({
      code: LOCKFILE_DRIFT,
      file: "HEAD:pnpm-lock.yaml",
      line: 16,
      message: 'third-party package "kleur" is gone: base ref HEAD has 4.1.5',
      hint: DRIFT_HINT,
    });
  });

  it("ignores an @gwenjs package that moves to another version", async () => {
    const fixture = await openFixture();
    const base: LockfileEntry = { name: "@gwenjs/core", version: "1.0.0-integration.1" };
    await commitLockfile(fixture.root, lockfileText([LEFT_PAD, base]));
    await writeLockfile(
      fixture.root,
      lockfileText([LEFT_PAD, { name: "@gwenjs/core", version: "1.0.0-integration.2" }]),
    );

    const report = await check(fixture.root, "package", "HEAD");
    expect(report.checks).toContain("lockfile");
    expect(withCode(report, LOCKFILE_DRIFT)).toEqual([]);
  });

  it("ignores a peer suffix that changes when the package version does not", async () => {
    const fixture = await openFixture();
    await commitLockfile(
      fixture.root,
      lockfileText([
        { name: "vite-plugin-x", version: "1.0.0", peers: "@gwenjs/core@1.0.0-integration.1" },
      ]),
    );
    await writeLockfile(
      fixture.root,
      lockfileText([
        { name: "vite-plugin-x", version: "1.0.0", peers: "@gwenjs/core@1.0.0-integration.2" },
      ]),
    );

    const report = await check(fixture.root, "package", "HEAD");
    expect(report.checks).toContain("lockfile");
    expect(withCode(report, LOCKFILE_DRIFT)).toEqual([]);
  });

  it("reports one finding per package whose set of versions changed", async () => {
    const fixture = await openFixture();
    await commitLockfile(
      fixture.root,
      lockfileText([
        { name: "ms", version: "2.0.0" },
        { name: "ms", version: "2.1.3" },
      ]),
    );
    await writeLockfile(
      fixture.root,
      lockfileText([
        { name: "ms", version: "2.0.0" },
        { name: "ms", version: "3.0.0" },
      ]),
    );

    const report = await check(fixture.root, "package", "HEAD");
    const drifts = withCode(report, LOCKFILE_DRIFT);
    expect(drifts).toHaveLength(1);
    const finding = only(drifts);
    expect({
      code: String(finding.code),
      file: finding.file,
      line: finding.line,
      message: finding.message,
      hint: finding.hint,
    }).toEqual({
      code: LOCKFILE_DRIFT,
      file: "pnpm-lock.yaml",
      line: 13,
      message: 'third-party package "ms" resolves to 2.0.0, 3.0.0, base ref HEAD has 2.0.0, 2.1.3',
      hint: DRIFT_HINT,
    });
  });

  it("reports INVALID_SPEC when the base ref does not resolve", async () => {
    const fixture = await openFixture();
    const report = await check(fixture.root, "package", "no-such-ref");
    const specs = withCode(report, ConformanceErrorCodes.INVALID_SPEC);
    expect(specs).toHaveLength(1);
    const finding = only(specs);
    expect(finding.file).toBeUndefined();
    expect(finding.message.startsWith('lockfileBase "no-such-ref" does not resolve:')).toBe(true);
    expect(finding.hint).toBe(SPEC_HINT);
  });

  it("reports INVALID_SPEC and runs no git for a lockfileBase that starts with a dash", async () => {
    const fixture = await openFixture();
    const dir = await mkdtemp(path.join(tmpdir(), "gwen-lockfile-pwn-"));
    const pwned = path.join(dir, "pwned");
    const ref = `--output=${pwned}`;
    try {
      const report = await check(fixture.root, "package", ref);
      const specs = withCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(specs).toHaveLength(1);
      const finding = only(specs);
      expect(finding.file).toBeUndefined();
      expect(finding.message).toBe(`lockfileBase ${JSON.stringify(ref)} must not start with "-"`);
      expect(finding.hint).toBe(SPEC_HINT);
      expect(existsSync(pwned)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports INVALID_SPEC when the base ref holds no pnpm-lock.yaml", async () => {
    const fixture = await openFixture();
    git(fixture.root, ["add", "package.json", "LICENSE"]);
    git(fixture.root, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "x"]);

    const report = await check(fixture.root, "package", "HEAD");
    const specs = withCode(report, ConformanceErrorCodes.INVALID_SPEC);
    expect(specs).toHaveLength(1);
    const finding = only(specs);
    expect(finding.message).toBe("HEAD:pnpm-lock.yaml does not exist");
    expect(finding.hint).toBe(SPEC_HINT);
  });

  it("reports INVALID_SPEC when the package has no pnpm-lock.yaml", async () => {
    const fixture = await openFixture();
    await commitLockfile(fixture.root, lockfileText([LEFT_PAD]));
    await rm(path.join(fixture.root, "pnpm-lock.yaml"));

    const report = await check(fixture.root, "package", "HEAD");
    const specs = withCode(report, ConformanceErrorCodes.INVALID_SPEC);
    expect(specs).toHaveLength(1);
    const finding = only(specs);
    expect(finding.message).toBe("pnpm-lock.yaml does not exist in the package root");
    expect(finding.hint).toBe(SPEC_HINT);
  });

  it("ignores a GIT_DIR exported by a hook", async () => {
    const fixture = await openFixture();
    await commitLockfile(fixture.root, lockfileText([LEFT_PAD, KLEUR]));
    await writeLockfile(
      fixture.root,
      lockfileText([LEFT_PAD, { name: "kleur", version: "4.1.6" }]),
    );
    const decoyParent = await mkdtemp(path.join(tmpdir(), "gwen-lockfile-decoy-"));
    const decoy = path.join(decoyParent, "decoy.git");
    execFileSync("git", ["init", "--bare", "-q", decoy], { cwd: decoyParent, env: gitEnv() });
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = decoy;
    try {
      const report = await check(fixture.root, "package", "HEAD");
      const drifts = withCode(report, LOCKFILE_DRIFT);
      expect(drifts).toHaveLength(1);
      const finding = only(drifts);
      expect({
        code: String(finding.code),
        file: finding.file,
        line: finding.line,
        message: finding.message,
        hint: finding.hint,
      }).toEqual({
        code: LOCKFILE_DRIFT,
        file: "pnpm-lock.yaml",
        line: 16,
        message: 'third-party package "kleur" resolves to 4.1.6, base ref HEAD has 4.1.5',
        hint: DRIFT_HINT,
      });
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
      await rm(decoyParent, { recursive: true, force: true });
    }
  });

  it("reports INVALID_SPEC when the lockfileVersion is not 9.0", async () => {
    const fixture = await openFixture();
    const text = lockfileText([LEFT_PAD]);
    await commitLockfile(fixture.root, text);
    await writeLockfile(fixture.root, text.replace("'9.0'", "'6.0'"));

    const report = await check(fixture.root, "package", "HEAD");
    const specs = withCode(report, ConformanceErrorCodes.INVALID_SPEC);
    expect(specs).toHaveLength(1);
    const finding = only(specs);
    expect(finding.message).toBe('pnpm-lock.yaml has lockfileVersion "6.0", expected "9.0"');
    expect(finding.file).toBe("pnpm-lock.yaml");
    expect(finding.hint).toBe(
      "Run the check with pnpm 10 (lockfileVersion 9.0), or regenerate the lockfile.",
    );
    expect(withCode(report, LOCKFILE_DRIFT)).toEqual([]);
  });

  it("reports INVALID_SPEC when the package root is a subdirectory of the repo and the ref holds no pnpm-lock.yaml", async () => {
    const fixture = await openFixture();
    git(fixture.root, ["add", "package.json", "LICENSE"]);
    git(fixture.root, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "x"]);
    const sub = await packageSubdir(fixture.root);

    const report = await check(sub, "package", "HEAD");
    const specs = withCode(report, ConformanceErrorCodes.INVALID_SPEC);
    expect(specs).toHaveLength(1);
    const finding = only(specs);
    expect(finding.message).toBe("HEAD:pnpm-lock.yaml does not exist");
    expect(finding.hint).toBe(SPEC_HINT);
  });

  it("reports INVALID_SPEC when pnpm-lock.yaml exists on disk but not in the base ref", async () => {
    const fixture = await openFixture();
    git(fixture.root, ["add", "package.json", "LICENSE"]);
    git(fixture.root, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "x"]);
    await writeLockfile(fixture.root, lockfileText([LEFT_PAD]));

    const report = await check(fixture.root, "package", "HEAD");
    const specs = withCode(report, ConformanceErrorCodes.INVALID_SPEC);
    expect(specs).toHaveLength(1);
    const finding = only(specs);
    expect(finding.message).toBe("HEAD:pnpm-lock.yaml does not exist");
    expect(finding.hint).toBe(SPEC_HINT);
  });

  it("reports INVALID_SPEC for an empty lockfileBase", async () => {
    const fixture = await openFixture();
    const report = await check(fixture.root, "package", "");
    const specs = withCode(report, ConformanceErrorCodes.INVALID_SPEC);
    expect(specs).toHaveLength(1);
    const finding = only(specs);
    expect(finding.message).toBe("lockfileBase must not be empty");
    expect(finding.hint).toBe(SPEC_HINT);
  });

  it("reports INVALID_SPEC when git cannot start", async () => {
    const fixture = await openFixture();
    await commitLockfile(fixture.root, lockfileText([LEFT_PAD]));
    const empty = await mkdtemp(path.join(tmpdir(), "gwen-lockfile-nopath-"));
    const previous = process.env.PATH;
    process.env.PATH = empty;
    try {
      const report = await check(fixture.root, "package", "HEAD");
      const specs = withCode(report, ConformanceErrorCodes.INVALID_SPEC);
      expect(specs).toHaveLength(1);
      const finding = only(specs);
      expect(finding.message).toBe("git could not run: ENOENT");
      expect(finding.hint).toBe(SPEC_HINT);
    } finally {
      if (previous === undefined) delete process.env.PATH;
      else process.env.PATH = previous;
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("reports INVALID_SPEC when the base lockfileVersion is not 9.0", async () => {
    const fixture = await openFixture();
    const text = lockfileText([LEFT_PAD]);
    await commitLockfile(fixture.root, text.replace("'9.0'", "'6.0'"));
    await writeLockfile(fixture.root, text);

    const report = await check(fixture.root, "package", "HEAD");
    const specs = withCode(report, ConformanceErrorCodes.INVALID_SPEC);
    expect(specs).toHaveLength(1);
    const finding = only(specs);
    expect(finding.message).toBe('HEAD:pnpm-lock.yaml has lockfileVersion "6.0", expected "9.0"');
    expect(finding.file).toBe("HEAD:pnpm-lock.yaml");
    expect(finding.hint).toBe(
      "Run the check with pnpm 10 (lockfileVersion 9.0), or regenerate the lockfile.",
    );
    expect(withCode(report, LOCKFILE_DRIFT)).toEqual([]);
  });
});
