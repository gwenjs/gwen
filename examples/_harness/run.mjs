import { renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, createLogger } from "vite";
import { harnessConfig } from "./config.mjs";
import { VARIANTS, writeReport } from "./report.mjs";

const [example, command] = process.argv.slice(2);
if (example === undefined || !Object.hasOwn(VARIANTS, example)) {
  throw new Error(`Usage: node run.mjs <${Object.keys(VARIANTS).join("|")}> build|prepare`);
}
if (command !== "build" && command !== "prepare") {
  throw new Error(`Unknown command "${command}": expected build or prepare`);
}

const exampleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", example);
const dist = path.join(exampleDir, "dist");

/** Messages Vite and its plugins log, kept for `dist/build.log`. */
const lines = [];
const customLogger = createLogger("info");
for (const level of ["info", "warn", "warnOnce", "error"]) {
  const log = customLogger[level].bind(customLogger);
  customLogger[level] = (message, options) => {
    lines.push(message);
    log(message, options);
  };
}

const config = harnessConfig(exampleDir);

if (command === "prepare") {
  // The `buildStart` of `gwen()` writes `.gwen/types/*.d.ts` as a side effect: nothing is emitted.
  await build({ ...config, customLogger, build: { ...config.build, write: false } });
} else {
  // A failed build must never leave the previous `dist/` for the tests to read.
  rmSync(dist, { recursive: true, force: true });
  await build({ ...config, customLogger });
  renameSync(path.join(dist, ".gwen", "index.html"), path.join(dist, "index.html"));
  rmdirSync(path.join(dist, ".gwen"));
  writeFileSync(path.join(dist, "build.log"), lines.join("\n"));
  writeReport(example);
}
