import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Both tests need the package-local vitest bin that `pnpm install` links, and the physics3d one also
// needs its build-tools typings. Two CI jobs run these scanner tests without them, and only those
// cases skip; a missing install anywhere else fails loudly, and nothing skips locally:
// - `agent-hygiene` (.github/workflows/ci.yml) runs `node --test scripts/*.test.mjs` with no
//   `pnpm install`, so the vitest bin is absent for both packages.
// - `rust-lint` installs but downloads no build-tools artifact, so the physics3d typings are absent.
// `verify-red` runs this file with `node --test` and installs the base worktree only when a vitest
// group is also in the diff (while `query-accessor.test.ts` changes); without it both cases skip,
// and the judge counts a skip as not red.
const physics3dTypings = join(root, "packages", "physics3d", "build-tools", "gwen_core.d.ts");

/** Test options for one package: skip on CI when the vitest bin or a required file is missing. */
function liveOptions(pkg, requiredFiles) {
  const vitestBin = join(root, "packages", pkg, "node_modules", ".bin", "vitest");
  const missing = [vitestBin, ...requiredFiles].find((file) => !existsSync(file));
  return {
    skip:
      process.env.GITHUB_ACTIONS === "true" && missing !== undefined
        ? `${relative(root, missing)} is not present in this CI job`
        : false,
    timeout: 300000,
  };
}

const live2d = liveOptions("physics2d", []);
const live3d = liveOptions("physics3d", [physics3dTypings]);

const scrubbedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

const SUITE = "tests/types/composables.test-d.ts";

/**
 * Runs the package `dev` project the way `pnpm test` does (no `--typecheck` flag, so the config
 * decides whether the type suite is listed) and returns the JSON report, or `null` when none was
 * written. A non-zero exit is tolerated: the caller judges the report.
 */
function runDevProject(pkg) {
  const dir = mkdtempSync(join(tmpdir(), "gwen-type-suites-"));
  const outputFile = join(dir, "r.json");
  try {
    try {
      execFileSync(
        "pnpm",
        [
          "exec",
          "vitest",
          "run",
          "--project",
          "dev",
          "--reporter=json",
          `--outputFile=${outputFile}`,
          SUITE,
        ],
        {
          cwd: join(root, "packages", pkg),
          env: scrubbedEnv,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch {
      // A failing run still writes the report; `null` below carries a missing one.
    }
    return existsSync(outputFile) ? JSON.parse(readFileSync(outputFile, "utf8")) : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Asserts the report lists the suite file with at least one assertion and every one passed. */
function assertSuiteListed(report, pkg) {
  assert.notEqual(report, null, `vitest wrote no report for packages/${pkg}`);
  const entry = report.testResults.find((result) => result.name.endsWith(`${pkg}/${SUITE}`));
  assert.ok(
    entry !== undefined,
    `packages/${pkg}/${SUITE} is not listed by vitest; listed: ${report.testResults
      .map((result) => result.name)
      .join(", ")}`,
  );
  assert.ok(entry.assertionResults.length >= 1, `${SUITE} reports no test in packages/${pkg}`);
  const failed = entry.assertionResults.filter((result) => result.status !== "passed");
  assert.deepEqual(
    failed.map((result) => `${result.fullName}: ${result.status}`),
    [],
    `${SUITE} has a test that did not pass in packages/${pkg}`,
  );
}

test("vitest typecheck lists tests/types in physics2d", live2d, () => {
  assertSuiteListed(runDevProject("physics2d"), "physics2d");
});

test("vitest typecheck lists tests/types in physics3d", live3d, () => {
  assertSuiteListed(runDevProject("physics3d"), "physics3d");
});
