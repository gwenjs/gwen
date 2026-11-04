import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oxlint = join(root, "node_modules", ".bin", "oxlint");

// The `agent-hygiene` job runs the scanner tests without `pnpm install`, so the oxlint binary is
// absent there. Only that case skips; a missing install anywhere else fails loudly. The `lint` job
// runs the gate itself, and `verify-red` runs these tests on an installed tree.
const live = {
  skip:
    !existsSync(oxlint) && process.env.GITHUB_ACTIONS === "true"
      ? "oxlint is not installed in this CI job"
      : false,
};

const RULE_ANY = "typescript-eslint(no-explicit-any)";
const RULE_CAST = "typescript-eslint(consistent-type-assertions)";
const RULE_NON_NULL = "typescript-eslint(no-non-null-assertion)";
const RULE_TS_COMMENT = "typescript-eslint(ban-ts-comment)";

const scrubbedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

let counter = 0;
const unique = () => `__gate_${process.pid}_${counter++}__`;

/** Runs oxlint from the repo root. Returns the exit status and stdout, also on a lint failure. */
function runOxlint(args) {
  try {
    const stdout = execFileSync(oxlint, args, {
      cwd: root,
      env: scrubbedEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status, stdout: String(error.stdout) };
  }
}

/** Lints `relPath` (a repo file that already exists) with the repo `oxlint.json`. */
function lintFile(relPath) {
  return runOxlint(["--config", "oxlint.json", relPath]);
}

/**
 * Writes `content` to `relPath` (under the repo root), lints that file with the repo
 * `oxlint.json`, removes the file (and the directory when `ownDir` is set), and
 * returns the exit status and stdout of oxlint.
 */
function lintTemp(relPath, content, ownDir) {
  const file = join(root, relPath);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    return lintFile(relPath);
  } finally {
    rmSync(ownDir ?? file, { recursive: true, force: true });
  }
}

// The sources are assembled from parts so that the diff hygiene scanner does not read this file's
// own fixtures as casts, `any` or directives.
const CAST = `export const a = 1 as ${"unknown"} as string;\n`;
const NON_NULL = "declare const x: { y: number } | null;\nexport const b = x!.y;\n";
const ANY = `export const c: ${"any"} = 1;\n`;
const DIRECTIVE = (name) => `// @${name}`;

test("oxlint rejects a cast, a non-null assertion and any in packages src", live, () => {
  const dir = `packages/core/src/${unique()}`;
  const mixed = lintTemp(`${dir}/x.ts`, `${CAST}${NON_NULL}${ANY}`, join(root, dir));
  assert.notEqual(mixed.status, 0, mixed.stdout);
  assert.ok(mixed.stdout.includes(RULE_NON_NULL), `non-null rule id in:\n${mixed.stdout}`);
  assert.ok(mixed.stdout.includes(RULE_ANY), `any rule id in:\n${mixed.stdout}`);
  assert.ok(mixed.stdout.includes(RULE_CAST), `cast rule id in:\n${mixed.stdout}`);

  const ignoreDir = `packages/core/src/${unique()}`;
  const ignored = lintTemp(
    `${ignoreDir}/x.ts`,
    `${DIRECTIVE("ts-ignore")}\nexport const d: number = "s";\n`,
    join(root, ignoreDir),
  );
  assert.notEqual(ignored.status, 0, ignored.stdout);
  assert.ok(ignored.stdout.includes(RULE_TS_COMMENT), `ban-ts-comment id in:\n${ignored.stdout}`);
});

test("oxlint accepts as const and a described ts-expect-error", live, () => {
  const dir = `packages/core/src/${unique()}`;
  const accepted = lintTemp(
    `${dir}/x.ts`,
    [
      'export const k = ["a"] as const;',
      `${DIRECTIVE("ts-expect-error")} -- the string is not a number on purpose`,
      'export const e: number = "s";',
      "",
    ].join("\n"),
    join(root, dir),
  );
  assert.equal(accepted.status, 0, accepted.stdout);
  assert.ok(!accepted.stdout.includes("typescript-eslint("), accepted.stdout);

  const bareDir = `packages/core/src/${unique()}`;
  const bare = lintTemp(
    `${bareDir}/x.ts`,
    `${DIRECTIVE("ts-expect-error")}\nexport const e: number = "s";\n`,
    join(root, bareDir),
  );
  assert.notEqual(bare.status, 0, bare.stdout);
  assert.ok(bare.stdout.includes(RULE_TS_COMMENT), `ban-ts-comment id in:\n${bare.stdout}`);
});

/** The `wasm-bridge-boundary` override: the one that turns off only the cast rule. */
function boundaryOverride(config) {
  const boundary = config.overrides.find(
    (entry) =>
      Object.keys(entry.rules).length === 1 &&
      entry.rules["typescript/consistent-type-assertions"] === "off",
  );
  assert.ok(boundary, "override that turns off only consistent-type-assertions");
  return boundary;
}

test("the wasm-bridge-boundary override allows a cast only in its files", live, () => {
  const config = JSON.parse(readFileSync(join(root, "oxlint.json"), "utf8"));
  const boundary = boundaryOverride(config);

  // A file that the override lists keeps the cast allowed and the other three rules on.
  const tempPath = `packages/vite/src/${unique()}.ts`;
  const withTemp = {
    ...config,
    overrides: config.overrides.map((entry) =>
      entry === boundary ? { ...entry, files: [...entry.files, tempPath] } : entry,
    ),
  };
  const configName = `.oxlint-${unique()}.json`;
  const file = join(root, tempPath);
  let listed;
  try {
    writeFileSync(join(root, configName), JSON.stringify(withTemp));
    writeFileSync(file, `${CAST}${NON_NULL}${ANY}`);
    listed = runOxlint(["--config", configName, tempPath]);
  } finally {
    rmSync(file, { force: true });
    rmSync(join(root, configName), { force: true });
  }
  assert.ok(!listed.stdout.includes(RULE_CAST), `no cast rule id in:\n${listed.stdout}`);
  assert.ok(listed.stdout.includes(RULE_NON_NULL), `non-null rule id in:\n${listed.stdout}`);
  assert.ok(listed.stdout.includes(RULE_ANY), `any rule id in:\n${listed.stdout}`);

  // A file that the override does not list gets the cast rule.
  const dir = `packages/core/src/${unique()}`;
  const other = lintTemp(`${dir}/x.ts`, CAST, join(root, dir));
  assert.notEqual(other.status, 0, other.stdout);
  assert.ok(other.stdout.includes(RULE_CAST), `cast rule id in:\n${other.stdout}`);
});

test("oxlint leaves tests, benches and vitest configs out of the gate", live, () => {
  const source = `${CAST}${NON_NULL}${ANY}${DIRECTIVE("ts-ignore")}\nexport const f: number = "s";\n`;
  const testsDir = `packages/core/tests/${unique()}`;
  const inTests = lintTemp(`${testsDir}/x.ts`, source, join(root, testsDir));
  assert.equal(inTests.status, 0, inTests.stdout);
  assert.ok(!inTests.stdout.includes("typescript-eslint("), inTests.stdout);

  const benchDir = `packages/core/bench/${unique()}`;
  const inBench = lintTemp(`${benchDir}/x.ts`, source, join(root, benchDir));
  assert.equal(inBench.status, 0, inBench.stdout);
  assert.ok(!inBench.stdout.includes("typescript-eslint("), inBench.stdout);

  const inTestFile = lintTemp(`packages/core/src/${unique()}.test.ts`, source);
  assert.equal(inTestFile.status, 0, inTestFile.stdout);
  assert.ok(!inTestFile.stdout.includes("typescript-eslint("), inTestFile.stdout);

  const inConfig = lintTemp(`packages/core/vitest.${unique()}.config.ts`, source);
  assert.equal(inConfig.status, 0, inConfig.stdout);
  assert.ok(!inConfig.stdout.includes("typescript-eslint("), inConfig.stdout);

  // The same source under packages/*/src is inside the gate: the four rules report it. Without
  // this half, the test above would also pass in a repo that configures no rule at all.
  const srcDir = `packages/core/src/${unique()}`;
  const inSrc = lintTemp(`${srcDir}/x.ts`, source, join(root, srcDir));
  assert.notEqual(inSrc.status, 0, inSrc.stdout);
  for (const rule of [RULE_CAST, RULE_NON_NULL, RULE_ANY, RULE_TS_COMMENT]) {
    assert.ok(inSrc.stdout.includes(rule), `${rule} in:\n${inSrc.stdout}`);
  }
});

test("the hooks index keeps its two any under an override limited to that file", live, () => {
  const index = lintFile("packages/core/src/hooks/index.ts");
  assert.equal(index.status, 0, index.stdout);
  assert.ok(!index.stdout.includes(RULE_ANY), index.stdout);

  const sibling = lintTemp(`packages/core/src/hooks/${unique()}.ts`, ANY);
  assert.notEqual(sibling.status, 0, sibling.stdout);
  assert.ok(sibling.stdout.includes(RULE_ANY), `any rule id in:\n${sibling.stdout}`);
});

/**
 * Runs `fn(configName)` with a temp config that is the repo `oxlint.json` minus the boundary
 * override, and removes that config afterwards.
 */
function withoutBoundaryConfig(fn) {
  const config = JSON.parse(readFileSync(join(root, "oxlint.json"), "utf8"));
  const boundary = boundaryOverride(config);
  const configName = `.oxlint-${unique()}.json`;
  try {
    writeFileSync(
      join(root, configName),
      JSON.stringify({
        ...config,
        overrides: config.overrides.filter((entry) => entry !== boundary),
      }),
    );
    return fn(configName);
  } finally {
    rmSync(join(root, configName), { force: true });
  }
}

test("the unchecked helpers are wasm-bridge-boundary files", live, () => {
  for (const helper of [
    "packages/core/src/internal/unchecked.ts",
    "packages/camera-core/src/internal/unchecked.ts",
    "packages/physics2d/src/internal/unchecked.ts",
    "packages/physics3d/src/internal/unchecked.ts",
  ]) {
    // oxlint exits 0 on a path that does not exist, so the file itself is asserted first.
    assert.ok(existsSync(join(root, helper)), `${helper} exists`);

    // The helper holds a cast: without the boundary override the cast rule reports it.
    const unguarded = withoutBoundaryConfig((configName) =>
      runOxlint(["--config", configName, helper]),
    );
    assert.ok(unguarded.stdout.includes(RULE_CAST), `${helper} holds a cast:\n${unguarded.stdout}`);

    // The repo config lists it, so the same file lints clean.
    const result = lintFile(helper);
    assert.equal(result.status, 0, `${helper}:\n${result.stdout}`);
    assert.ok(!result.stdout.includes(RULE_CAST), `${helper}:\n${result.stdout}`);
  }
});

/** Packages whose boundary casts are marked. */
const CONVERTED_PACKAGES = [
  "core",
  "schema",
  "kit",
  "app",
  "renderer-core",
  "camera-core",
  "vite",
  "physics2d",
  "physics3d",
];

test("every cast in a wasm-bridge-boundary file carries a boundary comment", live, () => {
  const config = JSON.parse(readFileSync(join(root, "oxlint.json"), "utf8"));
  const boundary = boundaryOverride(config);
  const listed = boundary.files.filter((file) =>
    CONVERTED_PACKAGES.some((name) => file.startsWith(`packages/${name}/src/`)),
  );
  assert.ok(listed.length > 0, "boundary files of the converted packages");

  const casts = withoutBoundaryConfig((configName) => {
    const result = runOxlint([
      "--config",
      configName,
      "-f",
      "json",
      ...CONVERTED_PACKAGES.map((name) => `packages/${name}/src`),
    ]);
    return JSON.parse(result.stdout).diagnostics.filter(
      (diagnostic) => diagnostic.code === RULE_CAST && listed.includes(diagnostic.filename),
    );
  });

  const unmarked = casts
    .map((cast) => ({
      file: cast.filename,
      line: cast.labels[0].span.line,
    }))
    .filter(({ file, line }) => {
      const text = readFileSync(join(root, file), "utf8").split("\n")[line - 1] ?? "";
      return !/\/\/ boundary: \S/.test(text);
    })
    .map(({ file, line }) => `${file}:${line}`);
  assert.deepEqual(unmarked, [], "casts without a boundary reason on their line");

  const holding = new Set(casts.map((cast) => cast.filename));
  const stale = listed.filter((file) => !holding.has(file));
  assert.deepEqual(stale, [], "boundary files that hold no cast");
});
