import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createFixture, editManifest, manifestExports } from "./helpers/fixture.js";

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

function runBuiltCli(cwd: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [builtCli, "check"],
      { cwd, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" },
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

    expect(run.stdout).toBe("CONFORMANCE: 0 findings (6 checks)\n");
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
        "CONFORMANCE: 2 findings (6 checks)",
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
    const match = /^CONFORMANCE: (\d+) findings \(3 checks\)$/.exec(summary);
    expect(match, `summary line: ${summary.slice(0, 80)}`).not.toBeNull();
    const findings = Number(match?.[1]);
    expect(findings).toBeGreaterThanOrEqual(LONG_REPORT_SUBPATHS);
    expect(lines.length).toBe(findings + 1);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(1);
  });
});
