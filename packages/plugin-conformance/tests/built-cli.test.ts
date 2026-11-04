import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createFixture, editManifest, manifestExports, SLOW_TEST_MS } from "./helpers/fixture.js";

const builtCli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");

const LONG_REPORT_SUBPATHS = 600;
const LONG_SEGMENT = "x".repeat(400);
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const cleanups: Array<() => Promise<void>> = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
  }
  const pending = cleanups.splice(0);
  for (const cleanup of pending) {
    await cleanup();
  }
});

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runBuiltCli(cwd: string, env?: NodeJS.ProcessEnv): Promise<Run> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [builtCli, "check"],
      { cwd, env, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : null;
        resolve({ code, stdout, stderr });
      },
    );
    children.push(child);
  });
}

describe("the built gwen-conformance binary", () => {
  it("exits 0 on the clean fixture", async () => {
    expect(existsSync(builtCli), "run pnpm build:ts").toBe(true);
    const fixture = await createFixture();
    cleanups.push(fixture.cleanup);

    const run = await runBuiltCli(fixture.root);

    expect(run.stdout).toBe("CONFORMANCE: 0 findings (11 checks)\n");
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
  });

  it("prints the findings and exits 1", async () => {
    expect(existsSync(builtCli), "run pnpm build:ts").toBe(true);
    const fixture = await createFixture();
    cleanups.push(fixture.cleanup);
    await rm(path.join(fixture.root, "LICENSE"), { force: true });
    await editManifest(fixture.root, (manifest) => {
      delete manifest.gwen;
    });

    const run = await runBuiltCli(fixture.root);

    expect(run.stdout).toBe(
      [
        "CONFORMANCE:MANIFEST package.json:1 LICENSE file is missing",
        'CONFORMANCE:MANIFEST package.json:1 gwen.type must be "plugin"',
        "CONFORMANCE: 2 findings (11 checks)",
        "",
      ].join("\n"),
    );
    expect(run.stderr).toBe("");
    expect(run.code).toBe(1);
  });

  it("prints a long report completely", async () => {
    expect(existsSync(builtCli), "run pnpm build:ts").toBe(true);
    const fixture = await createFixture();
    cleanups.push(fixture.cleanup);
    await editManifest(fixture.root, (manifest) => {
      const exportsField = manifestExports(manifest);
      for (let index = 0; index < LONG_REPORT_SUBPATHS; index += 1) {
        exportsField[`./missing-${index}-${LONG_SEGMENT}`] = {
          types: `./dist/missing-${index}-${LONG_SEGMENT}.d.ts`,
          import: `./dist/missing-${index}-${LONG_SEGMENT}.js`,
        };
      }
    });

    const run = await runBuiltCli(fixture.root);

    const lines = run.stdout.split("\n");
    expect(lines.pop()).toBe("");
    const summary = lines.at(-1) ?? "";
    const match = /^CONFORMANCE: (\d+) findings \(5 checks\)$/.exec(summary);
    expect(match, `summary line: ${summary.slice(0, 80)}`).not.toBeNull();
    const findings = Number(match?.[1]);
    expect(findings).toBeGreaterThanOrEqual(LONG_REPORT_SUBPATHS);
    expect(lines.length).toBe(findings + 1);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(1);
  });

  describe("when npm does not pack the package", () => {
    /** A directory that is the whole `PATH` of the child, holding `npm` only when `npmScript` is set. */
    async function pathWith(npmScript?: string): Promise<string> {
      const dir = await mkdtemp(path.join(tmpdir(), "gwen-conformance-path-"));
      cleanups.push(() => rm(dir, { recursive: true, force: true }));
      if (npmScript !== undefined) {
        await writeFile(path.join(dir, "npm"), npmScript);
        await chmod(path.join(dir, "npm"), 0o755);
      }
      return dir;
    }

    // An `npm` that prints a pack report and leaves a tarball that is not one.
    const JUNK_NPM = [
      "#!/bin/sh",
      'while [ $# -gt 0 ]; do [ "$1" = "--pack-destination" ] && dest="$2"; shift; done',
      'printf junk > "$dest/junk.tgz"',
      `printf '[{"filename":"junk.tgz"}]\\n'`,
      "",
    ].join("\n");

    it.each([
      [
        "is not on the PATH",
        undefined,
        "CONFORMANCE:ATTW package.json:6 npm pack failed: the command could not start (ENOENT)",
      ],
      [
        "makes a tarball that attw cannot read",
        JUNK_NPM,
        "CONFORMANCE:ATTW package.json:6 attw failed: error while checking file: Cannot read properties of undefined (reading 'filename')",
      ],
    ])("reports it when npm %s", { timeout: SLOW_TEST_MS }, async (_name, npmScript, attwLine) => {
      expect(existsSync(builtCli), "run pnpm build:ts").toBe(true);
      const fixture = await createFixture();
      cleanups.push(fixture.cleanup);
      // The child needs `node` itself: it is run by its absolute path, with no PATH to find another.
      const env = { PATH: await pathWith(npmScript) };

      const run = await runBuiltCli(fixture.root, env);

      // The publint finding is not asserted: whether publint finds a working npm depends on how
      // the runner resolves it. At most one is allowed, and it must be a publint failure.
      const lines = run.stdout.split("\n");
      expect(lines.pop()).toBe("");
      const summary = lines.pop();
      const findings = lines;
      const publint = findings.filter((line) => line.startsWith("CONFORMANCE:PUBLINT "));
      expect(findings.filter((line) => !line.startsWith("CONFORMANCE:PUBLINT "))).toEqual([
        attwLine,
      ]);
      expect(publint.length).toBeLessThanOrEqual(1);
      for (const line of publint) {
        expect(line.startsWith("CONFORMANCE:PUBLINT package.json:1 publint failed: "), line).toBe(
          true,
        );
      }
      expect(summary).toBe(`CONFORMANCE: ${findings.length} findings (11 checks)`);
      expect(run.stderr).toBe("");
      expect(run.code).toBe(1);
    });
  });
});
