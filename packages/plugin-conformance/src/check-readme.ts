import { readFile } from "node:fs/promises";
import path from "node:path";
import { ConformanceErrorCodes } from "./error-codes.js";
import { isRecord } from "./json.js";
import type { PackageContext } from "./package-context.js";
import { readSnapshot } from "./snapshot.js";
import type { ConformanceFinding } from "./types.js";

function readmeFinding(message: string, hint: string): ConformanceFinding {
  return { code: ConformanceErrorCodes.README_EXPORT_MISSING, message, hint, file: "README.md" };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every name of `public-api.snap.json` except `default` must appear in `README.md` as a whole
 * identifier, once per distinct name. A snapshot that cannot be read has no name to require.
 */
export async function checkReadme(
  context: Pick<PackageContext, "root">,
): Promise<readonly ConformanceFinding[]> {
  const read = await readSnapshot(context.root);
  if (!read.ok) return [];
  const required = new Map<string, string>();
  for (const [subpath, entry] of Object.entries(read.snapshot)) {
    for (const name of [...entry.values, ...entry.types]) {
      if (name !== "default" && !required.has(name)) required.set(name, subpath);
    }
  }
  if (required.size === 0) return [];
  let readme: string;
  try {
    readme = await readFile(path.join(context.root, "README.md"), "utf8");
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : "unknown error";
    if (code === "ENOENT") {
      return [readmeFinding("README.md is missing", "Add a README.md that documents the exports.")];
    }
    return [readmeFinding(`README.md cannot be read (${code})`, "Make README.md a readable file.")];
  }
  const findings: ConformanceFinding[] = [];
  for (const [name, subpath] of required) {
    if (new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`).test(readme)) continue;
    findings.push(
      readmeFinding(
        `README.md does not mention ${JSON.stringify(name)} (subpath ${JSON.stringify(subpath)})`,
        `Document ${JSON.stringify(name)} in README.md.`,
      ),
    );
  }
  return findings;
}
