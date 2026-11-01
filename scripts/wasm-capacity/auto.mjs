// Opens auto engines on the shipped Node entry until the first engine after
// engine 1 is on the pool, creation throws, or the ceiling. Prints one JSON line.
// Exit 0 when that line is printed. The judge decides.
import path from "node:path";
import { pathToFileURL } from "node:url";

// 1 pool engine + the default isolated budget (16) + the first fallback engine
// (packages/core/src/engine/wasm-instance-provider.ts:162).
const CEILING = 18;

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorText(err) {
  if (err instanceof Error) return `${err.constructor.name}: ${err.message}`;
  return String(err);
}

const coreDir = path.resolve(process.argv[2] ?? "");
const nodeEntry = path.join(coreDir, "dist", "node.js");
// Node's default is "isolated" (packages/core/src/node.ts:114). Pass "auto".
const loaded = await import(pathToFileURL(nodeEntry).href);
if (typeof loaded.createEngine !== "function") {
  throw new TypeError("dist/node.js did not export createEngine");
}
const createEngine = loaded.createEngine;

/**
 * @typedef {{
 *   wasmInstance: string,
 *   frameCount: number,
 *   memory: { linearMemory(): WebAssembly.Memory | null },
 *   advance(dt: number): Promise<void>,
 *   stop(): Promise<void>,
 * }} AutoEngine
 */

/** @type {AutoEngine[]} */
const opened = [];
/** @type {number | null} */
let fallbackAt = null;
/** @type {number | null} */
let rejectedAt = null;
/** @type {string | null} */
let error = null;

try {
  for (let index = 1; index <= CEILING; index += 1) {
    /** @type {AutoEngine} */
    let engine;
    try {
      engine = await createEngine({ variant: "light", wasmInstance: "auto" });
    } catch (err) {
      rejectedAt = index;
      error = errorText(err);
      break;
    }
    opened.push(engine);
    // Engine 1 is the pool. The first later "shared" engine is the fallback.
    if (index > 1 && engine.wasmInstance === "shared") {
      fallbackAt = index;
      break;
    }
  }

  let advanced = true;
  for (const engine of opened) {
    const prior = engine.frameCount;
    try {
      await engine.advance(1 / 60);
    } catch (err) {
      advanced = false;
      if (error === null) error = errorText(err);
      break;
    }
    if (engine.frameCount !== prior + 1) advanced = false;
  }

  const first = opened[0];
  const fallback = fallbackAt === null ? undefined : opened[fallbackAt - 1];
  const firstMemory = first?.memory.linearMemory() ?? null;
  const fallbackMemory = fallback?.memory.linearMemory() ?? null;
  const sameMemory = firstMemory !== null && firstMemory === fallbackMemory;
  const isolated = opened.filter((engine) => engine.wasmInstance === "isolated").length;

  console.log(
    JSON.stringify({
      arch: process.arch,
      node: process.version,
      flags: process.execArgv,
      variant: "light",
      mode: "auto",
      fallback_at: fallbackAt,
      rejected_at: rejectedAt,
      isolated,
      same_memory: sameMemory,
      advanced,
      error,
    }),
  );
} finally {
  for (let index = opened.length - 1; index >= 0; index -= 1) {
    const engine = opened[index];
    try {
      await engine.stop();
    } catch {
      // Teardown must not replace the printed status.
    }
  }
}
