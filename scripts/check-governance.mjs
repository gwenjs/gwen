import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function packageDirs() {
  const dirs = [root];
  const packages = join(root, "packages");
  if (!existsSync(packages)) return dirs;
  for (const name of readdirSync(packages)) {
    const dir = join(packages, name);
    if (statSync(dir).isDirectory() && existsSync(join(dir, "package.json"))) {
      dirs.push(dir);
    }
  }
  return dirs;
}

// A package is published when it is not private and either it is a workspace
// package under packages/* (gwen publishes those) or its manifest has a files
// allow-list (satellite packages). A private package, and a root manifest
// with no files allow-list, is not published.
function isPublished(dir, manifest) {
  if (manifest.private === true) return false;
  const rel = relative(root, dir);
  if (rel === "") return Array.isArray(manifest.files);
  return /^packages\/[^/]+$/.test(rel);
}

function label(dir) {
  return relative(root, dir) || ".";
}

function checkPack(dir) {
  let stdout;
  try {
    stdout = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const detail = (err.stderr || err.message || "").toString().trim();
    errors.push(`${label(dir)}: npm pack --dry-run --json failed: ${detail}`);
    return;
  }
  const startArray = stdout.indexOf("[");
  const startObj = stdout.indexOf("{");
  const start =
    startArray === -1
      ? startObj
      : startObj === -1
        ? startArray
        : Math.min(startArray, startObj);
  if (start === -1) {
    errors.push(`${label(dir)}: npm pack returned no JSON`);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch (err) {
    errors.push(`${label(dir)}: npm pack JSON parse failed: ${err.message}`);
    return;
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const files = entries.flatMap((entry) => entry.files ?? []);
  if (!files.some((file) => file.path === "LICENSE")) {
    errors.push(`${label(dir)}: npm pack tarball lacks LICENSE`);
  }
}

function walkYaml(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkYaml(path, out);
    else if (name.endsWith(".yml") || name.endsWith(".yaml")) out.push(path);
  }
}

function checkUses() {
  const files = [];
  walkYaml(join(root, ".github"), files);
  const lineRe = /^\s*(?:-\s*)?uses:\s*['"]?([^'"\s#]+)/;
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*#/.test(line)) continue;
      const match = line.match(lineRe);
      if (!match) continue;
      const ref = match[1];
      if (ref.startsWith("./")) continue;
      if (/@[0-9a-f]{40}$/.test(ref)) continue;
      errors.push(`${relative(root, file)}:${i + 1}: unpinned action ${ref}`);
    }
  }
}

for (const dir of packageDirs()) {
  const manifestPath = join(dir, "package.json");
  const manifest = readJson(manifestPath);
  if (!isPublished(dir, manifest)) continue;
  if (manifest.license !== "MPL-2.0") {
    errors.push(`${label(dir)}/package.json license must be "MPL-2.0"`);
  }
  checkPack(dir);
}
checkUses();

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("governance ok");
