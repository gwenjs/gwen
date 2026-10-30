import path from "node:path";
import { fileURLToPath } from "node:url";

export const NON_WASM_MARK = "Flat JS Float32Array";

export function rerunFlag() {
  return "";
}

export function l1Void() {
  return false;
}

export function neededL0() {
  return [];
}

export function sumMedianNs() {
  return 0;
}

export function includedBenchRows() {
  return [];
}

export function foldRuns() {
  return { medianNs: 0, p99Ns: 0, spreadPct: 0 };
}

export function decideWinner() {
  return "P1:S0";
}

function main() {
  process.stdout.write("winner: P1:S0\n");
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
