import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { packFramework } from "./stack/pack.mjs";
import {
  assertNoGwenjsUplink,
  buildConfig,
  installSatellite,
  publishTarballs,
  ruleFor,
  withRegistry,
  withRepoCheckout,
} from "./stack/registry.mjs";
import { git, initRepo, writeWorkspace } from "./stack/test-support.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryScript = join(repoRoot, "scripts/stack/registry.mjs");
const bin = process.env.GWEN_STACK_VERDACCIO;
const live = { skip: bin ? false : "set GWEN_STACK_VERDACCIO to a verdaccio binary" };
const stamp = "1.0.0-integration.20260102030405.gabc1234";

/**
 * @param {string} registry
 * @param {string} path
 */
function registryPath(registry, path) {
  return `${registry.replace(/\/$/, "")}/${path}`;
}

/**
 * @param {string} url
 */
async function assertPingRefused(url) {
  await assert.rejects(
    () => fetch(registryPath(url, "-/ping")),
    (error) => {
      const cause = error instanceof Error ? error.cause : undefined;
      const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
      assert.equal(code, "ECONNREFUSED");
      return true;
    },
  );
}

/**
 * @param {string} file
 */
function killPidFile(file) {
  try {
    const pid = Number(readFileSync(file, "utf8"));
    if (pid > 0) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // The group is already gone.
      }
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // The process is already gone.
      }
    }
  } catch {
    // The pid file was never written.
  }
}

/**
 * @param {string} url
 */
function killListeners(url) {
  let port = "";
  try {
    port = new URL(url).port;
  } catch {
    return;
  }
  if (!port) return;
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
  });
  for (const line of (result.stdout || "").split("\n")) {
    const pid = Number(line);
    if (pid > 0) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // The listener is already gone.
      }
    }
  }
}

/**
 * @param {string} messagePrefix
 */
/**
 * @param {string} dir
 * @param {string[]} args
 * @returns {string}
 */
function gitClean(dir, args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  env.GIT_TERMINAL_PROMPT = "0";
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "git failed").trim());
  }
  return (result.stdout || "").trim();
}

/**
 * @param {Record<string, string | undefined>} saved
 */
function restoreEnv(saved) {
  for (const key of Object.keys(saved)) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function startsWith(messagePrefix) {
  return (error) => {
    assert.equal(error instanceof Error, true);
    assert.equal(error.message.startsWith(messagePrefix), true);
    return true;
  };
}

/**
 * @returns {{ root: string, out: string, tarball: string }}
 */
function packCoreFixture() {
  const root = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const out = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  writeWorkspace(root, [
    {
      dir: "core",
      name: "@gwenjs/stack-fixture-core",
      body: 'module.exports = "stack-fixture-ok";\n',
    },
  ]);
  packFramework({ root, out, version: stamp });
  const manifest = JSON.parse(readFileSync(join(out, "stack-manifest.json"), "utf8"));
  const file = manifest.packages[0].file;
  return { root, out, tarball: join(out, "tarballs", file) };
}

test("registry refuses an uplink for @gwenjs/*", () => {
  const config = buildConfig({ storage: join(tmpdir(), "gwen-stack-storage"), port: 4999 });
  const coreRule = ruleFor(config, "@gwenjs/core");
  assert.equal(Object.hasOwn(coreRule ?? {}, "proxy"), false);
  assert.equal(ruleFor(config, "lodash")?.proxy, "npmjs");
  const scopedProxy = {
    packages: {
      "@gwenjs/*": { access: "$all", publish: "$authenticated", proxy: "npmjs" },
      "**": { access: "$all", publish: "$authenticated", proxy: "npmjs" },
    },
  };
  assert.throws(() => assertNoGwenjsUplink(scopedProxy), startsWith("STACK:UPLINK_FOR_GWENJS"));
  const starFirst = {
    packages: {
      "**": { access: "$all", publish: "$authenticated", proxy: "npmjs" },
      "@gwenjs/*": { access: "$all", publish: "$authenticated" },
    },
  };
  assert.throws(() => assertNoGwenjsUplink(starFirst), startsWith("STACK:UPLINK_FOR_GWENJS"));
  const kitBefore = {
    packages: {
      "@gwenjs/kit": { access: "$all", publish: "$all", proxy: "npmjs" },
      "@gwenjs/*": { access: "$all", publish: "$authenticated" },
    },
  };
  assert.throws(
    () => assertNoGwenjsUplink(kitBefore),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.message.startsWith("STACK:UPLINK_FOR_GWENJS"), true);
      assert.equal(error.message.includes("@gwenjs/kit"), true);
      return true;
    },
  );
});

test("the registry binds 127.0.0.1 only", () => {
  const config = buildConfig({ storage: join(tmpdir(), "gwen-stack-storage"), port: 4999 });
  assert.equal(config.listen, "127.0.0.1:4999");
  assert.throws(
    () =>
      buildConfig({ storage: join(tmpdir(), "gwen-stack-storage"), port: 4999, host: "0.0.0.0" }),
    startsWith("STACK:NON_LOOPBACK"),
  );
});

test(
  "a published tarball installs from the ephemeral registry and the registry is gone afterwards",
  live,
  async () => {
    const fixture = packCoreFixture();
    /** @type {string | undefined} */
    let storage;
    /** @type {string | undefined} */
    let url;
    try {
      assert.equal(existsSync(join(fixture.out, "stack-manifest.json")), true);
      await withRegistry({ bin }, async (ctx) => {
        assert.equal(typeof ctx?.url, "string");
        assert.equal(typeof ctx?.storage, "string");
        url = ctx.url;
        storage = ctx.storage;
        publishTarballs({ url: ctx.url, npmrc: ctx.npmrc, tarballs: [fixture.tarball] });
        const response = await fetch(registryPath(ctx.url, "@gwenjs%2fstack-fixture-core"), {
          headers: { accept: "application/json" },
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.versions?.[stamp]?.version, stamp);
      });
      assert.equal(typeof storage, "string");
      assert.equal(existsSync(storage), false);
      assert.equal(typeof url, "string");
      await assertPingRefused(url);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(fixture.out, { recursive: true, force: true });
    }
  },
);

test(
  "withRegistry tears down and rethrows the original error when the callback throws",
  live,
  async () => {
    /** @type {string | undefined} */
    let storage;
    /** @type {string | undefined} */
    let url;
    const boom = new Error("boom");
    await assert.rejects(
      () =>
        withRegistry({ bin }, async (ctx) => {
          assert.equal(typeof ctx?.url, "string");
          assert.equal(typeof ctx?.storage, "string");
          storage = ctx.storage;
          url = ctx.url;
          throw boom;
        }),
      (error) => {
        assert.equal(error, boom);
        return true;
      },
    );
    assert.equal(typeof storage, "string");
    assert.equal(existsSync(storage), false);
    assert.equal(typeof url, "string");
    await assertPingRefused(url);
  },
);

test("an @gwenjs package that was never published is a 404 and is not proxied", live, async () => {
  await withRegistry({ bin }, async (ctx) => {
    assert.equal(typeof ctx?.url, "string");
    const response = await fetch(registryPath(ctx.url, "@gwenjs%2fcore"), {
      headers: { accept: "application/json" },
    });
    assert.equal(response.status, 404);
  });
});

test("publishing the same tarball twice fails with STACK:PUBLISH_FAILED", live, async () => {
  const fixture = packCoreFixture();
  try {
    assert.equal(existsSync(fixture.tarball), true);
    await withRegistry({ bin }, async (ctx) => {
      assert.equal(typeof ctx?.url, "string");
      publishTarballs({ url: ctx.url, npmrc: ctx.npmrc, tarballs: [fixture.tarball] });
      assert.throws(
        () => publishTarballs({ url: ctx.url, npmrc: ctx.npmrc, tarballs: [fixture.tarball] }),
        startsWith("STACK:PUBLISH_FAILED"),
      );
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(fixture.out, { recursive: true, force: true });
  }
});

test(
  "installSatellite pins @gwenjs ranges to the stack version, installs from the registry and runs the commands",
  live,
  async () => {
    const fixture = packCoreFixture();
    const satellite = mkdtempSync(join(tmpdir(), "gwen-stack-"));
    const marker = join(satellite, "observed.txt");
    try {
      writeFileSync(
        join(satellite, "package.json"),
        `${JSON.stringify(
          {
            name: "stack-satellite",
            version: "0.0.0",
            private: true,
            devDependencies: { "@gwenjs/stack-fixture-core": "^0.1.0" },
          },
          null,
          2,
        )}\n`,
      );
      assert.equal(existsSync(fixture.tarball), true);
      await withRegistry({ bin }, async (ctx) => {
        assert.equal(typeof ctx?.url, "string");
        publishTarballs({ url: ctx.url, npmrc: ctx.npmrc, tarballs: [fixture.tarball] });
        await installSatellite({
          dir: satellite,
          url: ctx.url,
          version: stamp,
          command:
            "node -e \"const fs=require('node:fs'); const v=require('@gwenjs/stack-fixture-core'); fs.writeFileSync('observed.txt', String(v))\"",
        });
      });
      const satellitePackage = JSON.parse(readFileSync(join(satellite, "package.json"), "utf8"));
      assert.equal(satellitePackage.devDependencies["@gwenjs/stack-fixture-core"], stamp);
      const installed = JSON.parse(
        readFileSync(
          join(satellite, "node_modules/@gwenjs/stack-fixture-core/package.json"),
          "utf8",
        ),
      );
      assert.equal(installed.version, stamp);
      assert.equal(readFileSync(marker, "utf8"), "stack-fixture-ok");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(fixture.out, { recursive: true, force: true });
      rmSync(satellite, { recursive: true, force: true });
    }
  },
);

test(
  "a failing satellite command throws STACK:SATELLITE_FAILED and the registry is still torn down",
  live,
  async () => {
    const satellite = mkdtempSync(join(tmpdir(), "gwen-stack-"));
    /** @type {string | undefined} */
    let url;
    try {
      writeFileSync(
        join(satellite, "package.json"),
        `${JSON.stringify({ name: "stack-satellite", version: "0.0.0", private: true }, null, 2)}\n`,
      );
      await assert.rejects(
        () =>
          withRegistry({ bin }, async (ctx) => {
            assert.equal(typeof ctx?.url, "string");
            url = ctx.url;
            await installSatellite({
              dir: satellite,
              url: ctx.url,
              version: stamp,
              command: 'node -e "process.exit(3)"',
            });
          }),
        (error) => {
          assert.equal(error instanceof Error, true);
          assert.equal(error.message.startsWith("STACK:SATELLITE_FAILED"), true);
          assert.equal(error.message.includes("process.exit(3)"), true);
          return true;
        },
      );
      assert.equal(typeof url, "string");
      await assertPingRefused(url);
    } finally {
      rmSync(satellite, { recursive: true, force: true });
    }
  },
);

test(
  "the CLI exits 1 and prints the failing command when a satellite command fails",
  live,
  async () => {
    const fixture = packCoreFixture();
    const satellite = mkdtempSync(join(tmpdir(), "gwen-stack-"));
    try {
      writeFileSync(
        join(satellite, "package.json"),
        `${JSON.stringify({ name: "stack-satellite", version: "0.0.0", private: true }, null, 2)}\n`,
      );
      assert.equal(existsSync(join(fixture.out, "stack-manifest.json")), true);
      const result = spawnSync(
        process.execPath,
        [
          registryScript,
          "run",
          "--out",
          fixture.out,
          "--satellite",
          satellite,
          "--cmd",
          'node -e "process.exit(3)"',
        ],
        { encoding: "utf8", env: process.env },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stderr.includes("STACK:SATELLITE_FAILED"), true);
      assert.equal(result.stderr.includes("process.exit(3)"), true);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(fixture.out, { recursive: true, force: true });
      rmSync(satellite, { recursive: true, force: true });
    }
  },
);

test("withRepoCheckout clones the requested branch and removes the temp dir", async () => {
  const source = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  try {
    initRepo(source);
    writeFileSync(join(source, "marker.txt"), "main\n");
    git(source, ["add", "marker.txt"]);
    git(source, ["commit", "-m", "main"]);
    git(source, ["checkout", "-b", "integration/hooks"]);
    writeFileSync(join(source, "marker.txt"), "hooks\n");
    git(source, ["add", "marker.txt"]);
    git(source, ["commit", "-m", "hooks"]);
    git(source, ["checkout", "main"]);
    /** @type {string | undefined} */
    let checkout;
    /** @type {string | undefined} */
    let branch;
    /** @type {string | undefined} */
    let marker;
    await withRepoCheckout({ repo: source, branch: "integration/hooks" }, (dir) => {
      assert.equal(typeof dir, "string");
      checkout = dir;
      branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
      marker = readFileSync(join(dir, "marker.txt"), "utf8");
    });
    assert.equal(branch, "integration/hooks");
    assert.equal(marker, "hooks\n");
    assert.equal(typeof checkout, "string");
    assert.equal(existsSync(checkout), false);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test("withRepoCheckout rethrows a falsy rejection", async () => {
  const source = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  try {
    initRepo(source);
    writeFileSync(join(source, "marker.txt"), "one\n");
    git(source, ["add", "marker.txt"]);
    git(source, ["commit", "-m", "one"]);
    await assert.rejects(
      () =>
        withRepoCheckout({ repo: source, branch: "main" }, () => {
          throw 0;
        }),
      (error) => {
        assert.equal(error, 0);
        return true;
      },
    );
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test("withRepoCheckout does not treat a dashed repository as a git option", async () => {
  const marker = join(tmpdir(), `gwen-stack-upload-${process.pid}`);
  const repo = `--upload-pack=touch ${marker}`;
  try {
    await assert.rejects(
      () => withRepoCheckout({ repo, branch: "integration/hooks" }, () => {}),
      (error) => {
        assert.equal(error instanceof Error, true);
        assert.equal(error.message.startsWith("STACK:CLONE_FAILED"), true);
        assert.equal(error.message.includes(repo), true);
        return true;
      },
    );
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(marker, { force: true });
  }
});

test("withRepoCheckout ignores a GIT_DIR inherited from a git hook", async () => {
  const source = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const decoy = mkdtempSync(join(tmpdir(), "gwen-stack-decoy-"));
  const saved = {
    GIT_DIR: process.env.GIT_DIR,
    GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
  };
  try {
    gitClean(source, ["init", "-b", "main"]);
    gitClean(source, ["config", "user.email", "stack@example.com"]);
    gitClean(source, ["config", "user.name", "stack"]);
    writeFileSync(join(source, "marker.txt"), "main\n");
    gitClean(source, ["add", "marker.txt"]);
    gitClean(source, ["commit", "-m", "main"]);
    gitClean(source, ["checkout", "-b", "integration/hooks"]);
    writeFileSync(join(source, "marker.txt"), "hooks\n");
    gitClean(source, ["add", "marker.txt"]);
    gitClean(source, ["commit", "-m", "hooks"]);
    gitClean(source, ["checkout", "main"]);
    process.env.GIT_DIR = decoy;
    process.env.GIT_INDEX_FILE = join(decoy, "index");
    let marker = "";
    await withRepoCheckout({ repo: source, branch: "integration/hooks" }, (dir) => {
      marker = readFileSync(join(dir, "marker.txt"), "utf8");
    });
    assert.equal(marker, "hooks\n");
    assert.deepEqual(readdirSync(decoy), []);
  } finally {
    restoreEnv(saved);
    rmSync(source, { recursive: true, force: true });
    rmSync(decoy, { recursive: true, force: true });
  }
});

test("withRegistry fails fast when the registry process dies from a signal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const script = join(dir, "die.mjs");
  writeFileSync(script, 'process.kill(process.pid, "SIGKILL");\n');
  try {
    await assert.rejects(
      () => withRegistry({ command: process.execPath, args: [script] }, () => {}),
      (error) => {
        assert.equal(error instanceof Error, true);
        assert.equal(error.message.startsWith("STACK:REGISTRY_EXIT"), true);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The child ignores SIGTERM and stays in the leader's process group.
test("withRegistry kills the process group when the leader exits and a child ignores SIGTERM", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const serverPid = join(dir, "server.pid");
  const leaderPid = join(dir, "leader.pid");
  const serverScript = join(dir, "server.mjs");
  writeFileSync(
    serverScript,
    `import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
process.on("SIGTERM", () => {});
process.on("SIGHUP", () => {});
process.on("SIGINT", () => {});
writeFileSync(${JSON.stringify(serverPid)}, String(process.pid));
const config = JSON.parse(readFileSync("config.json", "utf8"));
const port = Number(String(config.listen).split(":").pop());
const server = createServer((req, res) => {
  const url = req.url ?? "";
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body);
  };
  if (req.method === "GET" && url.startsWith("/-/ping")) {
    send(200, "{}");
    return;
  }
  if (req.method === "PUT" && url.includes("/-/user/")) {
    req.on("data", () => {});
    req.on("end", () => send(201, JSON.stringify({ token: "stand-in" })));
    return;
  }
  send(404, "{}");
});
server.listen(port, "127.0.0.1");
`,
  );
  writeFileSync(
    join(dir, "leader.mjs"),
    `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(leaderPid)}, String(process.pid));
const child = spawn(process.execPath, [${JSON.stringify(serverScript)}], {
  detached: false,
  stdio: "ignore",
});
child.unref();
process.on("SIGTERM", () => {
  process.exit(0);
});
setInterval(() => {}, 1000);
`,
  );
  /** @type {string | undefined} */
  let url;
  try {
    await withRegistry(
      { command: process.execPath, args: [join(dir, "leader.mjs")] },
      async (ctx) => {
        assert.equal(typeof ctx?.url, "string");
        url = ctx.url;
        const response = await fetch(registryPath(ctx.url, "-/ping"));
        assert.equal(response.status, 200);
      },
    );
    assert.equal(typeof url, "string");
    await assertPingRefused(url);
  } finally {
    killPidFile(leaderPid);
    killPidFile(serverPid);
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "a satellite command that prints more than 2 MiB and exits 0 does not fail",
  { ...live, timeout: 60_000 },
  async () => {
    const satellite = mkdtempSync(join(tmpdir(), "gwen-stack-"));
    const runner = join(satellite, "runner.mjs");
    const command = `node -e "process.stdout.write('x'.repeat(3*1024*1024))"`;
    writeFileSync(
      runner,
      `import { installSatellite, withRegistry } from ${JSON.stringify(registryScript)};
const dir = process.argv[2];
const version = process.argv[3];
await withRegistry({ bin: process.env.GWEN_STACK_VERDACCIO }, async (ctx) => {
  await installSatellite({ dir, url: ctx.url, version, command: ${JSON.stringify(command)} });
});
`,
    );
    try {
      writeFileSync(
        join(satellite, "package.json"),
        `${JSON.stringify({ name: "stack-satellite", version: "0.0.0", private: true }, null, 2)}\n`,
      );
      const result = spawnSync(process.execPath, [runner, satellite, stamp], {
        encoding: "utf8",
        env: process.env,
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 30_000,
      });
      assert.equal(result.status, 0, (result.stderr || "").slice(0, 200));
    } finally {
      rmSync(satellite, { recursive: true, force: true });
    }
  },
);

test("the CLI runs a satellite command, writes its marker and shows its stdout", live, async () => {
  const fixture = packCoreFixture();
  const satellite = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  try {
    writeFileSync(
      join(satellite, "package.json"),
      `${JSON.stringify({ name: "stack-satellite", version: "0.0.0", private: true }, null, 2)}\n`,
    );
    writeFileSync(
      join(satellite, "show.mjs"),
      'import { writeFileSync } from "node:fs";\nwriteFileSync("marker.txt", "ran");\nconsole.log("satellite-stdout-marker");\n',
    );
    const result = spawnSync(
      process.execPath,
      [
        registryScript,
        "run",
        "--out",
        fixture.out,
        "--satellite",
        satellite,
        "--cmd",
        "node show.mjs",
      ],
      { encoding: "utf8", env: process.env, maxBuffer: 8 * 1024 * 1024 },
    );
    assert.equal(result.status, 0);
    assert.equal(readFileSync(join(satellite, "marker.txt"), "utf8"), "ran");
    assert.equal(result.stdout.includes("satellite-stdout-marker"), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(fixture.out, { recursive: true, force: true });
    rmSync(satellite, { recursive: true, force: true });
  }
});

test("the CLI runs the command in the cloned branch and removes the clone", live, async () => {
  const fixture = packCoreFixture();
  const source = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  try {
    initRepo(source);
    writeFileSync(
      join(source, "package.json"),
      `${JSON.stringify({ name: "stack-satellite", version: "0.0.0", private: true }, null, 2)}\n`,
    );
    writeFileSync(
      join(source, "print.mjs"),
      'import { readFileSync } from "node:fs";\nprocess.stdout.write(readFileSync("marker.txt", "utf8"));\nprocess.stdout.write(`CWD:${process.cwd()}\\n`);\n',
    );
    writeFileSync(join(source, "marker.txt"), "main-marker\n");
    git(source, ["add", "package.json", "print.mjs", "marker.txt"]);
    git(source, ["commit", "-m", "main"]);
    git(source, ["checkout", "-b", "integration/hooks"]);
    writeFileSync(join(source, "marker.txt"), "hooks-marker\n");
    git(source, ["add", "marker.txt"]);
    git(source, ["commit", "-m", "hooks"]);
    git(source, ["checkout", "main"]);
    const result = spawnSync(
      process.execPath,
      [
        registryScript,
        "run",
        "--out",
        fixture.out,
        "--repo",
        source,
        "--branch",
        "integration/hooks",
        "--cmd",
        "node print.mjs",
      ],
      { encoding: "utf8", env: process.env, maxBuffer: 8 * 1024 * 1024 },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes("hooks-marker"), true);
    const cwdLine = result.stdout.split("\n").find((line) => line.startsWith("CWD:"));
    assert.equal(typeof cwdLine, "string");
    const cwd = (cwdLine ?? "").slice("CWD:".length);
    assert.equal(cwd.length > 0, true);
    assert.equal(existsSync(cwd), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(fixture.out, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
});

test("the CLI tears the registry down on SIGINT and exits 130", live, async () => {
  const fixture = packCoreFixture();
  const satellite = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  /** @type {import("node:child_process").ChildProcess | undefined} */
  let cli;
  /** @type {string | undefined} */
  let url;
  try {
    writeFileSync(
      join(satellite, "package.json"),
      `${JSON.stringify({ name: "stack-satellite", version: "0.0.0", private: true }, null, 2)}\n`,
    );
    cli = spawn(
      process.execPath,
      [
        registryScript,
        "run",
        "--out",
        fixture.out,
        "--satellite",
        satellite,
        "--cmd",
        'node -e "setTimeout(()=>{},60000)"',
      ],
      { env: process.env },
    );
    let stderr = "";
    const waited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(""), 25000);
      const take = () => {
        const found = /STACK:REGISTRY_URL (http:\/\/\S+)/.exec(stderr);
        if (!found?.[1]) return;
        clearTimeout(timer);
        resolve(found[1]);
      };
      cli?.stderr?.on("data", (chunk) => {
        stderr += chunk;
        take();
      });
      cli?.once("exit", () => {
        clearTimeout(timer);
        resolve("");
      });
      cli?.once("error", () => {
        clearTimeout(timer);
        resolve("");
      });
    });
    assert.equal(waited.startsWith("http://127.0.0.1:"), true, stderr.slice(-300));
    url = waited;
    assert.equal(typeof cli.pid, "number");
    process.kill(cli.pid, "SIGINT");
    const exitCode = await new Promise((resolve) => {
      if (cli?.exitCode !== null && cli?.exitCode !== undefined) resolve(cli.exitCode);
      else cli?.once("exit", (code) => resolve(code));
    });
    assert.equal(exitCode, 130);
    await assertPingRefused(url);
  } finally {
    if (cli?.pid) {
      try {
        process.kill(-cli.pid, "SIGKILL");
      } catch {
        // The CLI group is already gone.
      }
      try {
        process.kill(cli.pid, "SIGKILL");
      } catch {
        // The CLI is already gone.
      }
    }
    if (url) killListeners(url);
    spawnSync("pkill", ["-f", "setTimeout(()=>{},60000)"]);
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(fixture.out, { recursive: true, force: true });
    rmSync(satellite, { recursive: true, force: true });
  }
});

/**
 * @param {string[]} args
 */
function spawnRegistry(args) {
  return spawnSync(process.execPath, [registryScript, ...args], {
    encoding: "utf8",
    env: process.env,
  });
}

/**
 * @param {string} url
 * @param {string} name
 */
async function packageDocument(url, name) {
  const response = await fetch(registryPath(url, name.replace("/", "%2f")), {
    headers: { accept: "application/json" },
  });
  assert.equal(response.status, 200, name);
  return response.json();
}

test("publish sends every packed tarball to the registry named by --registry", live, async () => {
  const root = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const out = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  try {
    writeWorkspace(root, [
      { dir: "core", name: "@gwenjs/stack-fixture-core" },
      { dir: "kit", name: "@gwenjs/stack-fixture-kit" },
    ]);
    packFramework({ root, out, version: stamp });
    const manifest = JSON.parse(readFileSync(join(out, "stack-manifest.json"), "utf8"));
    await withRegistry({ bin }, async (ctx) => {
      const result = spawnRegistry(["publish", "--out", out, "--registry", ctx.url]);
      assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
      for (const pkg of manifest.packages) {
        const body = await packageDocument(ctx.url, pkg.name);
        assert.equal(body.versions?.[stamp]?.version, stamp, pkg.name);
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("publish without --out exits 1 with STACK:INVALID_ARG: --out", () => {
  const result = spawnRegistry(["publish"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes("STACK:INVALID_ARG: --out"), true);
});

test("publish twice to the same registry succeeds", live, async () => {
  const root = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const firstOut = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const secondOut = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const second = "1.0.0-integration.20260102030406.gabc1235";
  try {
    writeWorkspace(root, [{ dir: "core", name: "@gwenjs/stack-fixture-core" }]);
    packFramework({ root, out: firstOut, version: stamp });
    packFramework({ root, out: secondOut, version: second });
    await withRegistry({ bin }, async (ctx) => {
      const first = spawnRegistry(["publish", "--out", firstOut, "--registry", ctx.url]);
      assert.equal(first.status, 0, `${first.stderr}${first.stdout}`);
      const again = spawnRegistry(["publish", "--out", secondOut, "--registry", ctx.url]);
      assert.equal(again.status, 0, `${again.stderr}${again.stdout}`);
      const body = await packageDocument(ctx.url, "@gwenjs/stack-fixture-core");
      assert.equal(body.versions?.[stamp]?.version, stamp);
      assert.equal(body.versions?.[second]?.version, second);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(firstOut, { recursive: true, force: true });
    rmSync(secondOut, { recursive: true, force: true });
  }
});
