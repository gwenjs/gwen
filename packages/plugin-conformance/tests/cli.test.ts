import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/run-cli.js";
import type { CliIo } from "../src/run-cli.js";
import {
  BARE_MANIFEST_MESSAGES,
  createFixture,
  editManifest,
  goodPluginRoot,
  manifestExports,
  SLOW_TEST_MS,
  SNAPSHOT_FILE,
  stripPluginManifest,
  writeSource,
} from "./helpers/fixture.js";
import { commitLockfile, initGitRepo, lockfileText, writeLockfile } from "./helpers/lockfile.js";

const cleanups: Array<() => Promise<void>> = [];

const CHECK_USAGE =
  "Usage: gwen-conformance check [--profile plugin|package] [--write] [--lockfile-base <ref>]\n";

const TWELVE_CLEAN = "CONFORMANCE: 0 findings (12 checks)\n";

const BASE_LOCKFILE = lockfileText([
  { name: "left-pad", version: "1.2.0" },
  { name: "kleur", version: "4.1.5" },
]);

/** Clean package fixture with `text` committed as `pnpm-lock.yaml` on `main`. */
async function lockfileRepo(text: string): Promise<string> {
  const fixture = await createFixture();
  cleanups.push(fixture.cleanup);
  initGitRepo(fixture.root);
  await commitLockfile(fixture.root, text);
  return fixture.root;
}

afterEach(async () => {
  const pending = cleanups.splice(0);
  for (const cleanup of pending) {
    await cleanup();
  }
});

function capture(cwd: string): { io: CliIo; stdout: () => string; stderr: () => string } {
  let out = "";
  let err = "";
  return {
    io: {
      cwd,
      stdout: {
        write(chunk: string) {
          out += chunk;
        },
      },
      stderr: {
        write(chunk: string) {
          err += chunk;
        },
      },
    },
    stdout: () => out,
    stderr: () => err,
  };
}

describe("gwen-conformance", () => {
  it(
    "prints one line per finding and the summary and returns 1",
    { timeout: SLOW_TEST_MS },
    async () => {
      const fixture = await createFixture();
      cleanups.push(fixture.cleanup);
      await stripPluginManifest(fixture.root);
      const captured = capture(fixture.root);

      const code = await runCli(["check"], captured.io);
      const lines = BARE_MANIFEST_MESSAGES.map(
        (message) => `CONFORMANCE:MANIFEST package.json:1 ${message}`,
      );
      expect(captured.stdout()).toBe(`${lines.join("\n")}\nCONFORMANCE: 3 findings (11 checks)\n`);
      expect(code).toBe(1);
      expect(captured.stderr()).toBe("");
    },
  );

  it(
    "returns 0 on the clean fixture and prints the summary",
    { timeout: SLOW_TEST_MS },
    async () => {
      const captured = capture(goodPluginRoot());

      const code = await runCli(["check"], captured.io);
      expect(captured.stdout()).toBe("CONFORMANCE: 0 findings (11 checks)\n");
      expect(code).toBe(0);
      expect(captured.stderr()).toBe("");
    },
  );

  it("returns 2 and prints usage on an unknown option", async () => {
    const captured = capture(goodPluginRoot());

    const code = await runCli(["check", "--nope"], captured.io);
    expect(code).toBe(2);
    expect(captured.stderr().length).toBeGreaterThan(0);
    expect(captured.stdout()).toBe("");
  });

  it(
    "returns 0 for profile package when ./module and gwen.type are absent",
    { timeout: SLOW_TEST_MS },
    async () => {
      const fixture = await createFixture();
      cleanups.push(fixture.cleanup);
      await editManifest(fixture.root, (manifest) => {
        delete manifest.gwen;
        delete manifestExports(manifest)["./module"];
      });
      await writeSource(fixture.root, SNAPSHOT_FILE, '{".":{"values":["ready"],"types":[]}}\n');
      const captured = capture(fixture.root);

      const code = await runCli(["check", "--profile", "package"], captured.io);
      expect(captured.stdout()).toBe("CONFORMANCE: 0 findings (11 checks)\n");
      expect(code).toBe(0);
      expect(captured.stderr()).toBe("");
    },
  );

  it("returns 2 when --profile has no value", async () => {
    const captured = capture(goodPluginRoot());

    const code = await runCli(["check", "--profile"], captured.io);
    expect(code).toBe(2);
    expect(captured.stdout()).toBe("");
  });

  it("returns 2 when --profile is not plugin or package", async () => {
    const captured = capture(goodPluginRoot());

    const code = await runCli(["check", "--profile", "x"], captured.io);
    expect(code).toBe(2);
    expect(captured.stdout()).toBe("");
  });

  it("returns 2 when --profile is given twice", async () => {
    const captured = capture(goodPluginRoot());

    const code = await runCli(
      ["check", "--profile", "plugin", "--profile", "package"],
      captured.io,
    );
    expect(code).toBe(2);
    expect(captured.stdout()).toBe("");
  });

  it("writes the snapshot with --write and returns 0", { timeout: SLOW_TEST_MS }, async () => {
    const fixture = await createFixture();
    cleanups.push(fixture.cleanup);
    await rm(path.join(fixture.root, SNAPSHOT_FILE));
    const plain = capture(fixture.root);

    expect(await runCli(["check"], plain.io)).toBe(1);
    expect(plain.stdout()).toBe(
      "CONFORMANCE:SNAPSHOT_MISMATCH public-api.snap.json public-api.snap.json is missing\nCONFORMANCE: 1 findings (11 checks)\n",
    );
    const written = capture(fixture.root);
    expect(await runCli(["check", "--write", "--profile", "plugin"], written.io)).toBe(0);
    expect(written.stdout()).toBe("CONFORMANCE: 0 findings (11 checks)\n");
    const text = await readFile(path.join(fixture.root, SNAPSHOT_FILE), "utf8");
    expect(JSON.parse(text)).toEqual({
      ".": { values: ["ready"], types: [] },
      "./module": { values: ["default"], types: [] },
    });
  });

  it("returns 2 when --write is given twice", async () => {
    const captured = capture(goodPluginRoot());

    const code = await runCli(["check", "--write", "--write"], captured.io);
    expect(code).toBe(2);
    expect(captured.stdout()).toBe("");
    expect(captured.stderr()).toBe(CHECK_USAGE);
  });

  it("returns 2 for an unknown command", async () => {
    const captured = capture(goodPluginRoot());

    const code = await runCli(["build"], captured.io);
    expect(code).toBe(2);
    expect(captured.stdout()).toBe("");
  });

  it(
    "--lockfile-base prints the drift line with its file and line, the 12-check summary, and returns 1",
    { timeout: SLOW_TEST_MS },
    async () => {
      const root = await lockfileRepo(BASE_LOCKFILE);
      await writeLockfile(
        root,
        lockfileText([
          { name: "left-pad", version: "1.2.0" },
          { name: "kleur", version: "4.1.6" },
        ]),
      );
      const captured = capture(root);

      const code = await runCli(["check", "--lockfile-base", "HEAD"], captured.io);
      expect(code).toBe(1);
      expect(captured.stderr()).toBe("");
      expect(captured.stdout()).toBe(
        'CONFORMANCE:LOCKFILE_DRIFT pnpm-lock.yaml:16 third-party package "kleur" resolves to 4.1.6, base ref HEAD has 4.1.5\nCONFORMANCE: 1 findings (12 checks)\n',
      );
    },
  );

  it(
    "--lockfile-base returns 0 on an unchanged lockfile and prints 12 checks, then returns 2 when the value is missing",
    { timeout: SLOW_TEST_MS },
    async () => {
      const root = await lockfileRepo(BASE_LOCKFILE);
      await rm(path.join(root, SNAPSHOT_FILE));
      const ok = capture(root);

      const code = await runCli(["check", "--lockfile-base", "HEAD", "--write"], ok.io);
      expect(code).toBe(0);
      expect(ok.stdout()).toBe(TWELVE_CLEAN);
      expect(ok.stderr()).toBe("");
      const text = await readFile(path.join(root, SNAPSHOT_FILE), "utf8");
      expect(JSON.parse(text)).toEqual({
        ".": { values: ["ready"], types: [] },
        "./module": { values: ["default"], types: [] },
      });

      const missing = capture(root);
      const rejected = await runCli(["check", "--lockfile-base"], missing.io);
      expect(rejected).toBe(2);
      expect(missing.stderr()).toBe(CHECK_USAGE);
      expect(missing.stdout()).toBe("");

      const empty = capture(root);
      const emptyCode = await runCli(["check", "--lockfile-base", ""], empty.io);
      expect(emptyCode).toBe(2);
      expect(empty.stderr()).toBe(CHECK_USAGE);
      expect(empty.stdout()).toBe("");
    },
  );

  it(
    "--lockfile-base returns 2 when given twice, after a valid single use",
    { timeout: SLOW_TEST_MS },
    async () => {
      const root = await lockfileRepo(BASE_LOCKFILE);
      const ok = capture(root);

      const code = await runCli(
        ["check", "--profile", "package", "--lockfile-base", "HEAD"],
        ok.io,
      );
      expect(code).toBe(0);
      expect(ok.stdout()).toBe(TWELVE_CLEAN);
      expect(ok.stderr()).toBe("");

      const twice = capture(root);
      const rejected = await runCli(
        ["check", "--lockfile-base", "HEAD", "--lockfile-base", "HEAD"],
        twice.io,
      );
      expect(rejected).toBe(2);
      expect(twice.stderr()).toBe(CHECK_USAGE);
      expect(twice.stdout()).toBe("");
    },
  );

  it(
    "--lockfile-base returns 2 for a value that starts with a dash, after a valid single use",
    { timeout: SLOW_TEST_MS },
    async () => {
      const root = await lockfileRepo(BASE_LOCKFILE);
      const ok = capture(root);

      const code = await runCli(["check", "--lockfile-base", "HEAD"], ok.io);
      expect(code).toBe(0);
      expect(ok.stdout()).toBe(TWELVE_CLEAN);

      const snap = path.join(root, SNAPSHOT_FILE);
      const before = await readFile(snap, "utf8");
      const dashed = capture(root);
      const rejected = await runCli(["check", "--lockfile-base", "--write"], dashed.io);
      expect(rejected).toBe(2);
      expect(dashed.stderr()).toBe(CHECK_USAGE);
      expect(dashed.stdout()).toBe("");
      expect(await readFile(snap, "utf8")).toBe(before);
    },
  );
});
