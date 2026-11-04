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

const cleanups: Array<() => Promise<void>> = [];

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
    expect(captured.stderr()).toBe(
      "Usage: gwen-conformance check [--profile plugin|package] [--write]\n",
    );
  });

  it("returns 2 for an unknown command", async () => {
    const captured = capture(goodPluginRoot());

    const code = await runCli(["build"], captured.io);
    expect(code).toBe(2);
    expect(captured.stdout()).toBe("");
  });
});
