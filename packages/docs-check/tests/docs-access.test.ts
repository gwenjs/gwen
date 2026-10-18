/**
 * The pages deferred from PR 7a still teach indexed column writes,
 * a pause, and milliseconds.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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

  it("says timeScale 0 makes the step dt 0 and leaves the state idle", () => {
    const english = pageText("docs/api/core.md");
    expect(english).toContain(
      "`timeScale` of `0` makes the step `dt` `0` and leaves the state `idle`",
    );
    expect(english).toContain("There is no `pause()` and no `paused` state.");
    expect(english).not.toContain("pauses all systems");
    expect(english).not.toContain("Paused");

    const french = pageText("docs/fr/api/core.md");
    expect(french).toContain(
      "Un `timeScale` de `0` rend le `dt` du pas égal à `0` et laisse l'état `idle`.",
    );
    expect(french).toContain("Il n'y a pas de `pause()` ni d'état `paused`.");
    expect(french).not.toContain("met en pause");
    expect(french).not.toContain("Pause —");
    expect(french).not.toContain("Pause vs");
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
});
