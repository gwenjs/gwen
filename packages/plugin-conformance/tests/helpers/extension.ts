import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";
import { checkPluginPackage } from "@gwenjs/plugin-conformance";
import type { ConformanceFinding } from "@gwenjs/plugin-conformance";

const extensionFixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/extension",
);

/** Read-only root of a `tests/fixtures/extension/<name>` package. */
export function extensionFixtureRoot(name: string): string {
  return path.join(extensionFixturesDir, name);
}

const extensionBasesDir = path.join(extensionFixturesDir, "bases");

async function rewriteInstalledName(directory: string, packageName: string): Promise<void> {
  const manifestPath = path.join(directory, "package.json");
  const text = await readFile(manifestPath, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("base package.json is not an object");
  }
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) next[key] = value;
  next.name = packageName;
  await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
}

/**
 * Copy `tests/fixtures/extension/bases/<name>` into `<root>/node_modules/<name>`.
 * A scoped name lands in `<root>/node_modules/@scope/name`.
 * `installedAs` installs that fixture under another package name and rewrites `package.json` `name`.
 */
export async function installBase(root: string, name: string, installedAs?: string): Promise<void> {
  const packageName = installedAs ?? name;
  const destination = path.join(root, "node_modules", packageName);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(extensionBasesDir, name), destination, { recursive: true });
  if (packageName !== name) await rewriteInstalledName(destination, packageName);
}

/** Manifest object written as `package.json`. Key order is the object's order. */
export type ExtensionManifest = Readonly<Record<string, unknown>>;

export interface ExtensionFixture {
  readonly root: string;
  /** Findings whose `code` equals `code`, from `checkPluginPackage` on this root. */
  checkOf(code: string, profile?: "plugin" | "package"): Promise<ConformanceFinding[]>;
  cleanup(): Promise<void>;
}

/** Findings of `code` from `checkPluginPackage` on `root`. Other codes stay out of the list. */
export async function extensionFindings(
  root: string,
  code: string,
  profile: "plugin" | "package" = "plugin",
): Promise<ConformanceFinding[]> {
  const report = await checkPluginPackage({ root, profile });
  return report.findings.filter((finding) => {
    const actual: string = finding.code;
    return actual === code;
  });
}

/**
 * Register an `afterEach` that removes every temp package the returned opener made, and return
 * that opener. `package.json` is 2-space JSON plus a final newline. Each `sources` path is
 * written under the temp root.
 */
export function openExtensionFixture(): (
  manifest: ExtensionManifest,
  sources?: Readonly<Record<string, string>>,
) => Promise<ExtensionFixture> {
  const roots: string[] = [];
  afterEach(async () => {
    const pending = roots.splice(0);
    for (const root of pending) {
      await rm(root, { recursive: true, force: true });
    }
  });
  return async (manifest, sources) => {
    const root = await mkdtemp(path.join(tmpdir(), "gwen-extension-"));
    roots.push(root);
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(path.join(root, "package.json"), text);
    if (sources !== undefined) {
      for (const [relative, body] of Object.entries(sources)) {
        const full = path.join(root, relative);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, body);
      }
    }
    let removed = false;
    return {
      root,
      checkOf(code, profile = "plugin") {
        return extensionFindings(root, code, profile);
      },
      async cleanup() {
        if (removed) return;
        removed = true;
        const index = roots.indexOf(root);
        if (index >= 0) roots.splice(index, 1);
        await rm(root, { recursive: true, force: true });
      },
    };
  };
}
