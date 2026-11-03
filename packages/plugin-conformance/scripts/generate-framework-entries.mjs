// Generates src/framework-entries.generated.ts: the public names of every framework entry that a
// plugin may import, and the GwenProvides keys the framework already declares.
// Usage: node scripts/generate-framework-entries.mjs [--stdout] [--packages <dir>] [--out <file>]
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGES = path.resolve(here, "../..");
const DEFAULT_OUT = path.resolve(here, "../src/framework-entries.generated.ts");
const PRINT_WIDTH = 100;

/**
 * Allowed-import table (data), by package directory. `src` entries are importable everywhere,
 * `tests` entries only from tests. `modules` adds every `./<x>/module` subpath of the snapshot.
 */
const TABLE = {
  schema: { src: ["."], tests: [] },
  kit: { src: [".", "./plugin", "./module"], tests: [] },
  core: {
    src: [".", "./system", "./actor", "./scene", "./tween"],
    modules: true,
    tests: ["./testing", "./node"],
  },
  math: { src: ["."], tests: [] },
  "renderer-core": { src: [".", "./module"], tests: ["./testing"] },
  "camera-core": { src: [".", "./module"], tests: [] },
  "physics-core": { src: ["."], tests: [] },
};

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function readErrorCode(error) {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function parseArguments(argv) {
  const options = { stdout: false, packages: DEFAULT_PACKAGES, out: DEFAULT_OUT };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--stdout") {
      options.stdout = true;
    } else if (argument === "--packages" || argument === "--out") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} needs a value`);
      options[argument.slice(2)] = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
  }
  return options;
}

async function readSnapshot(packagesDir, directory) {
  try {
    const text = await readFile(path.join(packagesDir, directory, "public-api.snap.json"), "utf8");
    return JSON.parse(text);
  } catch (error) {
    // A package that is not published yet has no snapshot.
    if (readErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function specifierOf(directory, subpath) {
  return subpath === "." ? `@gwenjs/${directory}` : `@gwenjs/${directory}${subpath.slice(1)}`;
}

async function collectEntries(packagesDir) {
  const entries = {};
  const testOnly = [];
  for (const [directory, rule] of Object.entries(TABLE)) {
    const snapshot = await readSnapshot(packagesDir, directory);
    if (snapshot === undefined) continue;
    const moduleEntries =
      rule.modules === true
        ? Object.keys(snapshot).filter((subpath) => /^\.\/[^/]+\/module$/.test(subpath))
        : [];
    const wanted = [
      ...rule.src.map((subpath) => ({ subpath, onlyInTests: false })),
      ...moduleEntries.map((subpath) => ({ subpath, onlyInTests: false })),
      ...rule.tests.map((subpath) => ({ subpath, onlyInTests: true })),
    ];
    for (const { subpath, onlyInTests } of wanted) {
      const entry = snapshot[subpath];
      if (entry === undefined) continue;
      const specifier = specifierOf(directory, subpath);
      const names = [...(entry.values ?? []), ...(entry.types ?? [])];
      entries[specifier] = [...new Set(names)].sort(compareText);
      if (onlyInTests) testOnly.push(specifier);
    }
  }
  return { entries, testOnly: testOnly.sort(compareText) };
}

async function listSources(directory) {
  let found;
  try {
    found = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of found) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") files.push(...(await listSources(full)));
    } else if (/\.(ts|tsx|mts)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      files.push(full);
    }
  }
  return files.sort(compareText);
}

function memberName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) {
    return name.expression.text;
  }
  return undefined;
}

/** True for `interface GwenProvides` of schema itself or inside `declare module "@gwenjs/schema"`. */
function isFrameworkProvides(node, directory) {
  if (!ts.isInterfaceDeclaration(node) || node.name.text !== "GwenProvides") return false;
  if (directory === "schema" && ts.isSourceFile(node.parent)) return true;
  const block = node.parent;
  const declaration = ts.isModuleBlock(block) ? block.parent : undefined;
  return (
    declaration !== undefined &&
    ts.isModuleDeclaration(declaration) &&
    ts.isStringLiteral(declaration.name) &&
    declaration.name.text === "@gwenjs/schema"
  );
}

async function collectProvidesKeys(packagesDir) {
  const keys = {};
  const directories = (await readdir(packagesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareText);
  for (const directory of directories) {
    for (const file of await listSources(path.join(packagesDir, directory, "src"))) {
      const text = await readFile(file, "utf8");
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const visit = (node) => {
        if (isFrameworkProvides(node, directory)) {
          for (const member of node.members) {
            const name =
              ts.isPropertySignature(member) || ts.isMethodSignature(member)
                ? memberName(member.name)
                : undefined;
            if (name !== undefined && !Object.hasOwn(keys, name))
              keys[name] = `@gwenjs/${directory}`;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return keys;
}

function stringList(items, indent, prefix) {
  const quoted = items.map((item) => JSON.stringify(item));
  const inline = `${indent}${prefix}[${quoted.join(", ")}]`;
  if (items.length === 0) return `${indent}${prefix}[]`;
  if (inline.length + 1 <= PRINT_WIDTH) return inline;
  const inner = quoted.map((item) => `${indent}  ${item},`);
  return [`${indent}${prefix}[`, ...inner, `${indent}]`].join("\n");
}

function propertyKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function render({ entries, testOnly, provides }) {
  const entryLines = Object.keys(entries)
    .sort(compareText)
    .map(
      (specifier) => `${stringList(entries[specifier], "  ", `${JSON.stringify(specifier)}: `)},`,
    );
  const providerLines = Object.keys(provides)
    .sort(compareText)
    .map((key) => `  ${propertyKey(key)}: ${JSON.stringify(provides[key])},`);
  const object = (lines) => (lines.length === 0 ? "{}" : `{\n${lines.join("\n")}\n}`);
  return [
    "// Generated by scripts/generate-framework-entries.mjs from the public-api.snap.json files and",
    "// the GwenProvides declarations of packages/. Do not edit.",
    `export const FRAMEWORK_ENTRIES: Readonly<Record<string, readonly string[]>> = ${object(entryLines)};`,
    "",
    `${stringList(testOnly, "", "export const FRAMEWORK_TEST_ONLY_ENTRIES: readonly string[] = ")};`,
    "",
    `export const FRAMEWORK_PROVIDES_KEYS: Readonly<Record<string, string>> = ${object(providerLines)};`,
    "",
  ].join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { entries, testOnly } = await collectEntries(options.packages);
  const provides = await collectProvidesKeys(options.packages);
  const text = render({ entries, testOnly, provides });
  if (options.stdout) {
    process.stdout.write(text);
    return;
  }
  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, text);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
