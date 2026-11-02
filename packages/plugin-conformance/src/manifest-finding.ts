import { ConformanceErrorCodes } from "./error-codes.js";
import type { ConformanceFinding } from "./types.js";

/** A manifest finding pinned to `package.json` line 1. */
export function manifestFinding(message: string, hint: string): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.MANIFEST,
    message,
    hint,
    file: "package.json",
    line: 1,
  };
}

/** Finding for a `package.json` that cannot be loaded. */
export function packageReadFinding(
  reason: "missing" | "invalid" | "unreadable",
): ConformanceFinding {
  if (reason === "missing") {
    return manifestFinding(
      "package.json is missing",
      "Add a package.json file at the package root.",
    );
  }
  if (reason === "invalid") {
    return manifestFinding(
      "package.json is not valid JSON",
      "Fix the JSON syntax in package.json.",
    );
  }
  return manifestFinding("package.json cannot be read", "Make package.json a readable UTF-8 file.");
}
