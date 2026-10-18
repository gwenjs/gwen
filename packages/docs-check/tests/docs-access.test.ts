/**
 * The pages deferred from PR 7a still teach indexed column writes,
 * a pause, and milliseconds.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { gwenSourceAliases } from "../../../vitest.aliases.js";
import { extractFences, type Fence } from "../src/fences.js";
import { checkFences } from "../src/snippets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packageRoot = path.join(repoRoot, "packages/docs-check");
const virtualRoot = "/virtual/gwen-docs-page";

function pageText(file: string): string {
  return readFileSync(path.join(repoRoot, file), "utf8");
}

const INDEXED = [
  "README.md",
  "docs/api/core.md",
  "docs/fr/api/core.md",
  "docs/guide/project-structure.md",
  "docs/fr/guide/project-structure.md",
  "docs/guide/quick-start.md",
  "docs/fr/guide/quick-start.md",
  "docs/rendering/screen.md",
  "docs/fr/rendering/screen.md",
];

const FORBIDDEN_INDEX = [
  "Position.x[",
  "Position.y[",
  "Velocity.vx[",
  "Velocity.vy[",
  "Velocity.x[",
  "Velocity.y[",
  "Health.hp[",
  "Transform.x[",
  "UIBox.x[",
];

describe("deferred access pages", () => {
  it("teaches chunk loops and actor fields instead of indexed column writes", () => {
    for (const file of INDEXED) {
      const page = pageText(file);
      for (const pattern of FORBIDDEN_INDEX) {
        expect(page, file).not.toContain(pattern);
      }
    }
    for (const file of [
      "README.md",
      "docs/api/core.md",
      "docs/fr/api/core.md",
      "docs/guide/project-structure.md",
      "docs/fr/guide/project-structure.md",
      "docs/guide/quick-start.md",
      "docs/fr/guide/quick-start.md",
    ]) {
      expect(pageText(file), file).toContain("chunk.get(");
    }
    for (const file of [
      "docs/api/core.md",
      "docs/fr/api/core.md",
      "docs/guide/project-structure.md",
      "docs/fr/guide/project-structure.md",
      "docs/rendering/screen.md",
      "docs/fr/rendering/screen.md",
    ]) {
      expect(pageText(file), file).toContain("useComponent(");
    }
  });

  it("says timeScale 0 makes the step dt 0 and does not change the state", () => {
    const english = pageText("docs/api/core.md");
    expect(english).toContain("`0` | The step `dt` is `0`. The state does not change.");
    expect(english).toContain(
      "`timeScale` of `0` makes the step `dt` `0`. The state does not change.",
    );
    expect(english).toContain("There is no `pause()` and no `paused` state.");
    expect(english).not.toContain("leaves the state `idle`");
    expect(english).not.toContain("The state stays `idle`");
    expect(english).not.toContain("stays idle");
    expect(english).not.toContain("pauses all systems");
    expect(english).not.toContain("Paused");

    const french = pageText("docs/fr/api/core.md");
    expect(french).toContain("`0` | Le `dt` du pas est `0`. L'état ne change pas.");
    expect(french).toContain(
      "Un `timeScale` de `0` rend le `dt` du pas égal à `0`. L'état ne change pas.",
    );
    expect(french).toContain("Il n'y a pas de `pause()` ni d'état `paused`.");
    expect(french).not.toContain("laisse l'état `idle`");
    expect(french).not.toContain("L'état reste `idle`");
    expect(french).not.toContain("reste idle");
    expect(french).not.toContain("met en pause");
    expect(french).not.toContain("Pause —");
    expect(french).not.toContain("Pause vs");

    const engine = pageText("docs/essentials/engine.md");
    expect(engine).toContain(
      "`timeScale` of `0` makes the step `dt` `0`. The state does not change.",
    );
    expect(engine).toContain("There is no `pause()` and no `paused` state.");
    expect(engine).not.toContain("leaves the state `idle`");
    expect(engine).not.toContain("The state stays `idle`");
    expect(engine).not.toContain("stays idle");
  });

  it("type-checks guide examples against the components fence on the same page", () => {
    for (const file of ["docs/guide/quick-start.md", "docs/fr/guide/quick-start.md"]) {
      const page = pageText(file);
      const movement = fenceAfterHeading(page, file, "**src/systems/Movement.ts**");
      expect(movement?.code ?? "", file).toMatch(
        /import\s*\{\s*Position\s*\}\s*from\s*['"]\.\.\/components\/Position['"]/,
      );
      expect(movement?.code ?? "", file).toContain("chunk.get(");
      const position = fenceAfterHeading(page, file, "**src/components/Position.ts**");
      expect(position, file).toBeDefined();
      const files = new Map<string, string>([
        [virtual("src/components/Position.ts"), `${position?.code ?? ""}\n`],
        [virtual("src/systems/Movement.ts"), `${movement?.code ?? ""}\n`],
      ]);
      expect(virtualDiagnostics(files, [virtual("src/systems/Movement.ts")]), file).toEqual([]);
    }

    for (const file of ["docs/guide/project-structure.md", "docs/fr/guide/project-structure.md"]) {
      const page = pageText(file);
      const movement = fenceAfterHeading(page, file, "**src/systems/Movement.ts**");
      expect(movement?.code ?? "", file).toMatch(
        /import\s*\{\s*Position\s*,\s*Velocity\s*\}\s*from\s*['"]\.\.\/components['"]/,
      );
      expect(movement?.code ?? "", file).toContain("chunk.get(");
      const player = fenceAfterHeading(page, file, "**src/actors/Player.ts**");
      expect(player?.code ?? "", file).toMatch(
        /import\s*\{\s*Position\s*,\s*Health\s*\}\s*from\s*['"]\.\.\/components['"]/,
      );
      expect(player?.code ?? "", file).toContain("useComponent(");
      const position = fenceAfterHeading(page, file, "**src/components/Position.ts**");
      const velocity = fenceAfterHeading(page, file, "**src/components/Velocity.ts**");
      const health = fenceAfterHeading(page, file, "**src/components/Health.ts**");
      const index = extractFences(page, file).find((fence) =>
        fence.code.includes("export * from './Position'"),
      );
      expect(position, file).toBeDefined();
      expect(velocity, file).toBeDefined();
      expect(health, file).toBeDefined();
      expect(index, file).toBeDefined();
      const files = new Map<string, string>([
        [virtual("src/components/Position.ts"), `${position?.code ?? ""}\n`],
        [virtual("src/components/Velocity.ts"), `${velocity?.code ?? ""}\n`],
        [virtual("src/components/Health.ts"), `${health?.code ?? ""}\n`],
        [virtual("src/components/index.ts"), `${index?.code ?? ""}\n`],
        [virtual("src/systems/Movement.ts"), `${movement?.code ?? ""}\n`],
        [virtual("src/actors/Player.ts"), `${player?.code ?? ""}\n`],
      ]);
      expect(
        virtualDiagnostics(files, [
          virtual("src/systems/Movement.ts"),
          virtual("src/actors/Player.ts"),
        ]),
        file,
      ).toEqual([]);
    }
  });

  it("awaits loadAssets inside the screen onStart check fence", () => {
    for (const file of ["docs/rendering/screen.md", "docs/fr/rendering/screen.md"]) {
      const fence = checkFencesOf(file).find((item) => item.code.includes("onStart"));
      expect(fence, file).toBeDefined();
      expect(fence?.code ?? "", file).toContain("async function loadAssets");
      expect(fence?.code ?? "", file).toContain("await loadAssets()");
      expect(fence?.code ?? "", file).toContain("pos.x = screen.pixels.width / 2");
    }
  });

  it("type-checks useActor spawn and despawn for EnemyActor", () => {
    for (const file of ["docs/api/core.md", "docs/fr/api/core.md"]) {
      const fence = checkFencesOf(file).find((item) => item.code.includes("useActor(EnemyActor)"));
      expect(fence, file).toBeDefined();
      expect(fence?.code ?? "", file).toContain(".spawn(");
      expect(fence?.code ?? "", file).toContain(".despawn(");
    }
  });

  it("says onUpdate dt is seconds", () => {
    const english = pageText("docs/api/math.md");
    expect(english).toContain("GWEN's `onUpdate(dt)` provides `dt` in **seconds**.");
    expect(english).not.toContain("milliseconds");
    expect(english).not.toContain("dt / 1000");

    const french = pageText("docs/fr/api/math.md");
    expect(french).toContain("Le `onUpdate(dt)` de GWEN fournit `dt` en **secondes**.");
    expect(french).not.toContain("millisecondes");
    expect(french).not.toContain("dt / 1000");
  });

  it("does not claim zero cost or zero overhead", () => {
    const leak = pageText("docs/advanced/actor-leak-detection.md");
    expect(leak).toContain("if (__GWEN_DEV__)");
    expect(leak).not.toContain("zero cost");

    const asyncPage = pageText("docs/advanced/async-context.md");
    expect(asyncPage).toContain("synchronous factory phase");
    expect(asyncPage).not.toContain("zero overhead");
  });

  it("type-checks the rewritten access fences", () => {
    const pages = [...INDEXED, "docs/api/math.md", "docs/fr/api/math.md"];
    const tagged = pages.flatMap((file) =>
      extractFences(pageText(file), file).filter(
        (fence) => fence.tag === "check" || fence.tag === "run",
      ),
    );
    expect(tagged.length).toBeGreaterThan(0);
    expect(checkFences(tagged)).toEqual([]);
  });
});

function checkFencesOf(file: string): Fence[] {
  return extractFences(pageText(file), file).filter((fence) => fence.tag === "check");
}

function fenceAfterHeading(markdown: string, file: string, heading: string): Fence | undefined {
  const at = markdown.indexOf(heading);
  if (at < 0) return undefined;
  const line = markdown.slice(0, at).split(/\r?\n/).length;
  return extractFences(markdown, file).find((fence) => fence.line > line);
}

function virtual(name: string): string {
  return `${virtualRoot}/${name}`;
}

function virtualDiagnostics(files: Map<string, string>, entries: string[]): string[] {
  const options = guideCompilerOptions();
  const host = ts.createCompilerHost(options, true);
  const virtualFiles = new Map<string, string>();
  for (const [name, text] of files) virtualFiles.set(path.resolve(name), text);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const hit = virtualFiles.get(path.resolve(fileName));
    if (hit !== undefined) {
      return ts.createSourceFile(fileName, hit, languageVersion, true, ts.ScriptKind.TS);
    }
    return read(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const exists = host.fileExists.bind(host);
  host.fileExists = (fileName) => virtualFiles.has(path.resolve(fileName)) || exists(fileName);
  const readFile = host.readFile.bind(host);
  host.readFile = (fileName) => virtualFiles.get(path.resolve(fileName)) ?? readFile(fileName);
  const directoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (dir) =>
    underVirtual(virtualFiles, dir) || (directoryExists?.(dir) ?? false);
  const realpath = host.realpath?.bind(host);
  host.realpath = (fileName) => {
    const resolved = path.resolve(fileName);
    if (virtualFiles.has(resolved) || underVirtual(virtualFiles, resolved)) return resolved;
    return realpath?.(fileName) ?? resolved;
  };
  const program = ts.createProgram(entries, options, host);
  const messages: string[] = [];
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    const name = diagnostic.file?.fileName;
    if (name !== undefined && !virtualFiles.has(path.resolve(name))) continue;
    messages.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  }
  return messages;
}

function underVirtual(files: Map<string, string>, dir: string): boolean {
  const resolved = path.resolve(dir);
  for (const name of files.keys()) {
    if (name === resolved || name.startsWith(`${resolved}${path.sep}`)) return true;
  }
  return false;
}

function guideCompilerOptions(): ts.CompilerOptions {
  const paths: Record<string, string[]> = {};
  for (const alias of gwenSourceAliases()) {
    const spec = alias.find.source.replace(/^\^/, "").replace(/\$$/, "").replace(/\\(.)/g, "$1");
    paths[spec] = [path.relative(repoRoot, alias.replacement)];
  }
  return {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: repoRoot,
    paths,
    verbatimModuleSyntax: true,
    ignoreDeprecations: "6.0",
    types: ["node"],
    typeRoots: [path.join(packageRoot, "node_modules/@types")],
  };
}
