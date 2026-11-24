import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync, type Node } from "oxc-parser";
import { walk } from "oxc-walker";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

interface AllowRow {
  file: string;
  pattern: string;
  on: string;
}

interface Site {
  file: string;
  pattern: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowRow(value: unknown): value is AllowRow {
  if (!isRecord(value)) return false;
  return (
    typeof value["file"] === "string" &&
    typeof value["pattern"] === "string" &&
    typeof value["on"] === "string"
  );
}

function repoPath(file: string): string {
  return join(repoRoot, file);
}

function readSource(file: string): string {
  return readFileSync(repoPath(file), "utf8");
}

/** `.ts` sources under the scan roots. Declaration files are not modules. */
function scanFiles(): string[] {
  const files: string[] = [];
  const walkDir = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
      files.push(relative(repoRoot, full).split(sep).join("/"));
    }
  };
  walkDir(join(repoRoot, "packages/vite/src"));
  files.push("packages/physics2d/src/vite-plugin.ts");
  files.push("packages/physics3d/src/vite-plugin.ts");
  return files;
}

function patternOf(code: string, node: Node): string | undefined {
  if (node.type === "Literal" && "regex" in node) {
    return code.slice(node.start, node.end);
  }
  if (node.type !== "CallExpression" && node.type !== "NewExpression") return undefined;
  const { callee } = node;
  if (callee.type !== "Identifier" || callee.name !== "RegExp") return undefined;
  return code.slice(node.start, node.end);
}

function sitesIn(file: string, code: string): Site[] {
  const found: Site[] = [];
  let program: Node;
  try {
    program = parseSync(file, code).program;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "parse failed";
    return [{ file, pattern: `PARSE ${message}` }];
  }
  walk(program, {
    enter(node) {
      const pattern = patternOf(code, node);
      if (pattern !== undefined) found.push({ file, pattern });
    },
  });
  return found;
}

function siteKeys(rows: readonly { file: string; pattern: string }[]): string[] {
  return rows.map((row) => row.file + row.pattern).sort();
}

function allowRows(): AllowRow[] {
  const raw: unknown = JSON.parse(
    readFileSync(new URL("./no-regex.allow.json", import.meta.url), "utf8"),
  );
  if (!Array.isArray(raw)) return [];
  return raw.filter(isAllowRow);
}

describe("no regex gate", () => {
  it("no regex is applied to module source or config text", () => {
    const files = scanFiles();
    expect(files.length).toBeGreaterThanOrEqual(40);
    expect(files).toContain("packages/vite/src/scanners/index.ts");
    expect(files).toContain("packages/vite/src/plugins/tween.ts");
    expect(files).toContain("packages/physics2d/src/vite-plugin.ts");
    expect(files).toContain("packages/physics3d/src/vite-plugin.ts");
    expect(sitesIn("synthetic.ts", "const a = code.match(/x/);")).toEqual([
      { file: "synthetic.ts", pattern: "/x/" },
    ]);

    const found = files.flatMap((file) => sitesIn(file, readSource(file)));
    expect(siteKeys(found)).toEqual(siteKeys(allowRows()));
  });

  it("no second parser in the vite package", () => {
    // dev-strip counts and reports, it does not rewrite user modules a second time
    const allowed = new Set([
      "packages/vite/src/pipeline/parse.ts",
      "packages/vite/src/plugins/dev-strip.ts",
    ]);
    const offenders = scanFiles().filter(
      (file) => file.startsWith("packages/vite/src/") && readSource(file).includes("parseSync("),
    );
    expect(offenders.filter((file) => !allowed.has(file)).sort()).toEqual([]);

    const raw: unknown = JSON.parse(readSource("packages/vite/package.json"));
    const dependencies = isRecord(raw) && isRecord(raw["dependencies"]) ? raw["dependencies"] : {};
    const banned = ["acorn", "unctx", "@babel/parser", "typescript"];
    expect(
      banned.filter((name) => Object.prototype.hasOwnProperty.call(dependencies, name)),
    ).toEqual([]);
  });

  it("no parseSource remains in the vite package or the physics vite plugins", () => {
    const hits = scanFiles().filter((file) =>
      /(^|[^A-Za-z0-9_])parseSource([^A-Za-z0-9_]|$)/.test(readSource(file)),
    );
    expect(hits.sort()).toEqual([]);
  });
});
