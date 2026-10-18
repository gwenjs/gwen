import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { createRealEngine } from "@gwenjs/core/testing";
import type { GwenEngine } from "@gwenjs/core";

const ENGINE = "__GWEN_DOCS_ENGINE__";

let loaderReady = false;

function ensureLoader(): void {
  if (loaderReady) return;
  register(new URL("./loader.mjs", import.meta.url), import.meta.url);
  loaderReady = true;
}

export interface RunHooks {
  onDisposed?: (state: string) => void;
}

/**
 * Run one `ts run` block as an async module.
 * `engine` is the only injected binding. The engine is disposed in `finally`.
 */
export async function runSnippet(
  code: string,
  file: string,
  line: number,
  hooks?: RunHooks,
): Promise<void> {
  ensureLoader();
  const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
  let failure: unknown;
  try {
    await execute(code, handle.engine);
    if (handle.engine.state === "stopped") {
      failure = new Error(`${file}:${line} the block stopped the engine`);
    }
  } catch (error) {
    failure = error;
  } finally {
    await handle.dispose();
    hooks?.onDisposed?.(handle.engine.state);
  }
  if (failure) throw failure;
}

async function execute(code: string, engine: GwenEngine): Promise<void> {
  const compiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: "snippet.ts",
  }).outputText;
  const imports: string[] = [];
  const body: string[] = [];
  for (const line of compiled.split("\n")) {
    if (imports.length === body.length && line.startsWith("import ")) imports.push(line);
    else body.push(line);
  }
  const source = `${imports.join("\n")}\nconst engine = globalThis.${ENGINE};\n${body.join("\n")}\n`;
  const dir = mkdtempSync(path.join(tmpdir(), "gwen-docs-"));
  const modulePath = path.join(dir, "snippet.mjs");
  writeFileSync(modulePath, source);
  Reflect.set(globalThis, ENGINE, engine);
  try {
    await import(pathToFileURL(modulePath).href);
  } finally {
    Reflect.deleteProperty(globalThis, ENGINE);
    rmSync(dir, { recursive: true, force: true });
  }
}
