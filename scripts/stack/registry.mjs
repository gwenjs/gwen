#!/usr/bin/env node
/**
 * Ephemeral Verdaccio: publish a stack, install a satellite, tear it down.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} pattern
 * @param {string} packageName
 * @returns {boolean}
 */
function patternMatches(pattern, packageName) {
  if (pattern === "**") return true;
  if (pattern === packageName) return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    const rest = packageName.slice(prefix.length);
    return packageName.startsWith(prefix) && rest.length > 0 && !rest.includes("/");
  }
  return false;
}

/**
 * @param {{ packages?: Record<string, { proxy?: string }> }} config
 * @param {string} packageName
 */
export function ruleFor(config, packageName) {
  const packages = config?.packages;
  if (!packages) return undefined;
  for (const [pattern, rule] of Object.entries(packages)) {
    if (patternMatches(pattern, packageName)) return rule;
  }
  return undefined;
}

/**
 * Verdaccio applies only the first matching packages rule. A later "**" proxy is not an uplink for @gwenjs/core,
 * but a specific "@gwenjs/" rule with a proxy is, even when it does not match @gwenjs/core.
 * @param {{ packages?: Record<string, { proxy?: string }> }} config
 */
export function assertNoGwenjsUplink(config) {
  const packages = config?.packages ?? {};
  for (const [pattern, rule] of Object.entries(packages)) {
    if (!patternMatches(pattern, "@gwenjs/core")) continue;
    if (rule && rule.proxy !== undefined) throw new Error(`STACK:UPLINK_FOR_GWENJS: ${pattern}`);
    break;
  }
  for (const pattern of Object.keys(packages)) {
    if (!pattern.startsWith("@gwenjs/")) continue;
    const probe = pattern.endsWith("*") ? `${pattern.slice(0, -1)}x` : pattern;
    const rule = ruleFor(config, probe);
    if (rule && rule.proxy !== undefined) throw new Error(`STACK:UPLINK_FOR_GWENJS: ${pattern}`);
  }
}

/**
 * @param {{ storage: string, port: number, host?: string }} options
 */
export function buildConfig({ storage, port, host = "127.0.0.1" }) {
  if (host !== "127.0.0.1") {
    throw new Error(`STACK:NON_LOOPBACK: ${host}`);
  }
  const config = {
    storage,
    listen: `${host}:${port}`,
    uplinks: { npmjs: { url: "https://registry.npmjs.org/" } },
    packages: {
      "@gwenjs/*": {
        access: "$all",
        publish: "$authenticated",
      },
      "**": {
        access: "$all",
        publish: "$authenticated",
        proxy: "npmjs",
      },
    },
    log: { level: "warn" },
  };
  assertNoGwenjsUplink(config);
  return config;
}

/**
 * @returns {Promise<number>}
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("STACK:NO_PORT"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/**
 * $GWEN_STACK_VERDACCIO and `pnpm dlx verdaccio@6.10.6` both go through spawnDetached, so SIGTERM then SIGKILL hit the process group (negative pid).
 * @param {string} configPath
 * @param {number} port
 * @param {{ bin?: string, command?: string, args?: string[] }} options
 */
function verdaccioLaunch(configPath, port, options) {
  if (options.command) return { command: options.command, args: options.args ?? [] };
  const listen = `127.0.0.1:${port}`;
  const configArgs = ["--config", configPath, "--listen", listen];
  const binary = options.bin || process.env.GWEN_STACK_VERDACCIO;
  if (binary) return { command: binary, args: configArgs };
  return { command: "pnpm", args: ["dlx", "verdaccio@6.10.6", ...configArgs] };
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} tempDir
 */
function spawnDetached(command, args, tempDir) {
  const logFd = openSync(path.join(tempDir, "verdaccio.log"), "a");
  const child = spawn(command, args, {
    cwd: tempDir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);
  return child;
}

/**
 * @param {import("node:child_process").ChildProcess} child
 */
function onceSpawned(child) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      child.removeListener("spawn", onSpawn);
      reject(error);
    };
    const onSpawn = () => {
      child.removeListener("error", onError);
      resolve();
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
}

/**
 * @param {number} ms
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} file
 */
function tail(file) {
  try {
    return readFileSync(file, "utf8").slice(-1500);
  } catch {
    return "";
  }
}

/**
 * @param {string} url
 * @param {import("node:child_process").ChildProcess} child
 * @param {string} logPath
 */
async function waitForPing(url, child, logPath) {
  const deadline = Date.now() + 30_000;
  let last = "no response";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`STACK:REGISTRY_EXIT: ${tail(logPath)}`);
    }
    try {
      const response = await fetch(`${url}-/ping`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(200);
  }
  throw new Error(`STACK:REGISTRY_TIMEOUT: ${last}\n${tail(logPath)}`);
}

/**
 * Verdaccio does not accept an arbitrary bearer token. Register a throw-away htpasswd user and keep the returned token.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function registerStackUser(url) {
  const password = `pw-${randomBytes(16).toString("hex")}`;
  const response = await fetch(`${url}-/user/org.couchdb.user:stack`, {
    method: "PUT",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ name: "stack", password, email: "stack@example.com" }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`STACK:REGISTRY_AUTH: ${response.status} ${text}`);
  const body = JSON.parse(text);
  if (typeof body.token !== "string" || body.token.length === 0) {
    throw new Error(`STACK:REGISTRY_AUTH: missing token ${text}`);
  }
  return body.token;
}

/**
 * @param {number} pid
 * @param {NodeJS.Signals} signal
 */
function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
}

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {number} timeoutMs
 */
function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve();
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("exit", onExit);
  });
}

/**
 * The leader can exit on SIGTERM while a child that ignores SIGTERM stays in the group.
 * @param {number} pid
 * @returns {boolean}
 */
function groupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {import("node:child_process").ChildProcess} child
 */
async function killProcessGroup(child) {
  const pid = child.pid;
  if (!pid || pid <= 0) return;
  signalGroup(pid, "SIGTERM");
  await waitForExit(child, 3000);
  if (!groupExists(pid)) return;
  signalGroup(pid, "SIGKILL");
  const deadline = Date.now() + 2000;
  while (groupExists(pid) && Date.now() < deadline) await delay(50);
  await waitForExit(child, 2000);
}

/**
 * `throw 0` is a real rejection. A truthiness check would swallow it.
 * @param {boolean} failed
 * @param {unknown} failure
 */
function rethrowIfFailed(failed, failure) {
  if (failed) throw failure;
}

/**
 * @param {{ bin?: string, command?: string, args?: string[] }} [options]
 * @param {(ctx: { url: string, npmrc: string, storage: string }) => unknown} fn
 */
export async function withRegistry(options = {}, fn) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "gwen-stack-registry-"));
  const storage = path.join(tempDir, "storage");
  mkdirSync(storage);
  /** @type {import("node:child_process").ChildProcess | undefined} */
  let child;
  /** @type {unknown} */
  let result;
  let failed = false;
  /** @type {unknown} */
  let failure;
  try {
    const port = await freePort();
    const configPath = path.join(tempDir, "config.json");
    const config = buildConfig({ storage, port });
    config.auth = { htpasswd: { file: path.join(tempDir, "htpasswd") } };
    // JSON is valid YAML; Verdaccio reads this file.
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const launch = verdaccioLaunch(configPath, port, options);
    child = spawnDetached(launch.command, launch.args, tempDir);
    await onceSpawned(child);
    const url = `http://127.0.0.1:${port}/`;
    await waitForPing(url, child, path.join(tempDir, "verdaccio.log"));
    const token = (await registerStackUser(url)).replace(/\s+/g, "");
    const npmrc = path.join(tempDir, "npmrc");
    writeFileSync(npmrc, `//127.0.0.1:${port}/:_authToken=${token}\n`);
    result = await fn({ url, npmrc, storage });
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    if (child) {
      try {
        await killProcessGroup(child);
      } catch {
        // Keep the callback's error as the rejection.
      }
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      if (!failed) {
        failed = true;
        failure = error;
      }
    }
  }
  rethrowIfFailed(failed, failure);
  return result;
}

/**
 * @param {{ url: string, npmrc: string, tarballs: string[] }} options
 */
export function publishTarballs({ url, npmrc, tarballs }) {
  for (const tarball of tarballs) {
    const result = spawnSync(
      "npm",
      ["publish", tarball, "--registry", url, "--userconfig", npmrc, "--tag", "integration"],
      { encoding: "utf8", env: { ...process.env, CI: process.env.CI || "1" } },
    );
    if (result.status !== 0) {
      const reason = `${result.stderr || ""}${result.stdout || ""}`.trim();
      throw new Error(`STACK:PUBLISH_FAILED: ${path.basename(tarball)}: ${reason}`);
    }
  }
}

/**
 * @param {string} url
 */
function withSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Inherit stdio so a satellite log larger than the spawnSync buffer still succeeds, and so the CLI shows it.
 * The shell is its own process group: a SIGINT delivered only to this CLI can still kill the command.
 * @param {string} command
 * @param {{ cwd: string, env: NodeJS.ProcessEnv }} options
 * @returns {Promise<void>}
 */
function runChecked(command, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: options.env,
      shell: true,
      detached: true,
      stdio: "inherit",
    });
    let settled = false;
    const signal = interrupt?.signal;
    /**
     * @param {unknown} [error]
     */
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onAbort = () => {
      const pid = child.pid;
      if (!pid || pid <= 0) return;
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // The command group is already gone.
      }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort);
    }
    child.once("error", (error) => {
      if (signal?.aborted) {
        finish(signal.reason);
        return;
      }
      finish(new Error(`STACK:SATELLITE_FAILED: ${command} (exit ${error.message})`));
    });
    child.once("exit", (status, childSignal) => {
      if (signal?.aborted) {
        finish(signal.reason);
        return;
      }
      if (status !== 0) {
        const detail = childSignal || status;
        finish(new Error(`STACK:SATELLITE_FAILED: ${command} (exit ${detail})`));
        return;
      }
      finish();
    });
  });
}

/**
 * @param {{ dir: string, url: string, version: string, command?: string | string[] }} options
 */
export async function installSatellite({ dir, url, version, command }) {
  const registry = withSlash(url);
  writeFileSync(path.join(dir, ".npmrc"), `@gwenjs:registry=${registry}\n`);
  const file = path.join(dir, "package.json");
  const json = JSON.parse(readFileSync(file, "utf8"));
  for (const sectionName of ["dependencies", "devDependencies"]) {
    const section = json[sectionName];
    if (!section || typeof section !== "object") continue;
    for (const name of Object.keys(section)) {
      if (name.startsWith("@gwenjs/")) section[name] = version;
    }
  }
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  const env = {
    ...process.env,
    CI: process.env.CI || "1",
    "npm_config_@gwenjs:registry": registry,
  };
  await runChecked("pnpm install --no-frozen-lockfile", { cwd: dir, env });
  const commands = (Array.isArray(command) ? command : [command]).filter(
    (entry) => typeof entry === "string",
  );
  for (const entry of commands) await runChecked(entry, { cwd: dir, env });
}

/**
 * @param {{ repo: string, branch: string }} options
 * @param {(dir: string) => unknown} fn
 */
export async function withRepoCheckout({ repo, branch }, fn) {
  const parent = mkdtempSync(path.join(tmpdir(), "gwen-stack-repo-"));
  const dir = path.join(parent, "checkout");
  /** @type {unknown} */
  let result;
  let failed = false;
  /** @type {unknown} */
  let failure;
  try {
    const clone = spawnSync(
      "git",
      ["clone", "--branch", branch, "--single-branch", "--", repo, dir],
      { encoding: "utf8" },
    );
    if (clone.status !== 0) {
      throw new Error(`STACK:CLONE_FAILED: ${(clone.stderr || clone.stdout || "").trim()}`);
    }
    result = await fn(dir);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    try {
      rmSync(parent, { recursive: true, force: true });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      if (!failed) {
        failed = true;
        failure = error;
      }
    }
  }
  rethrowIfFailed(failed, failure);
  return result;
}

/**
 * @param {string[]} argv
 */
function parseRunArgs(argv) {
  /** @type {{ out?: string, satellite?: string, repo?: string, branch: string, cmd: string[] }} */
  const parsed = { branch: "integration/hooks", cmd: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "run") continue;
    const next = argv[index + 1];
    if (next === undefined) throw new Error(`STACK:INVALID_ARG: ${arg}`);
    if (arg === "--out") parsed.out = next;
    else if (arg === "--satellite") parsed.satellite = next;
    else if (arg === "--repo") parsed.repo = next;
    else if (arg === "--branch") parsed.branch = next;
    else if (arg === "--cmd") parsed.cmd.push(next);
    else throw new Error(`STACK:INVALID_ARG: ${arg}`);
    index += 1;
  }
  if (!parsed.out) throw new Error("STACK:INVALID_ARG: --out");
  if (!parsed.satellite && !parsed.repo)
    throw new Error("STACK:INVALID_ARG: --satellite or --repo");
  if (parsed.cmd.length === 0) parsed.cmd.push("pnpm test");
  return parsed;
}

/**
 * @param {string[]} argv
 */
async function runCli(argv) {
  const parsed = parseRunArgs(argv);
  const manifest = JSON.parse(readFileSync(path.join(parsed.out, "stack-manifest.json"), "utf8"));
  const tarballs = manifest.packages.map((pkg) => path.join(parsed.out, "tarballs", pkg.file));
  /**
   * @param {string} dir
   */
  const publishAndInstall = async (dir) => {
    await withRegistry({}, async ({ url, npmrc }) => {
      console.error(`STACK:REGISTRY_URL ${url}`);
      publishTarballs({ url, npmrc, tarballs });
      await installSatellite({ dir, url, version: manifest.version, command: parsed.cmd });
    });
  };
  if (parsed.repo) {
    await withRepoCheckout({ repo: parsed.repo, branch: parsed.branch }, publishAndInstall);
    return;
  }
  if (!parsed.satellite) throw new Error("STACK:INVALID_ARG: --satellite or --repo");
  await publishAndInstall(parsed.satellite);
}

/** @type {AbortController | undefined} */
let interrupt;

/**
 * A terminal Ctrl-C reaches only this process. Abort so `withRegistry`'s finally still runs.
 * @param {"SIGINT" | "SIGTERM"} signal
 */
function requestShutdown(signal) {
  if (!interrupt || interrupt.signal.aborted) return;
  const exitCode = signal === "SIGINT" ? 130 : 143;
  const error = /** @type {Error & { exitCode: number }} */ (
    new Error(`STACK:INTERRUPTED: ${signal}`)
  );
  error.exitCode = exitCode;
  interrupt.abort(error);
}

function installSignalHandlers() {
  interrupt = new AbortController();
  process.on("SIGINT", () => requestShutdown("SIGINT"));
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));
}

/**
 * @param {unknown} error
 * @returns {number | undefined}
 */
function interruptedExitCode(error) {
  if (!error || typeof error !== "object" || !("exitCode" in error)) return undefined;
  const code = /** @type {{ exitCode?: unknown }} */ (error).exitCode;
  if (code === 130 || code === 143) return code;
  return undefined;
}

async function main() {
  installSignalHandlers();
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    const code = interruptedExitCode(error);
    if (code !== undefined) process.exit(code);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  main();
}
