import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractFences } from "../src/fences.js";
import { checkFences } from "../src/snippets.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function pageText(file: string): string {
  return readFileSync(path.join(repoRoot, file), "utf8");
}

const PHYSICS2D_PAGES = [
  "docs/physics/physics2d-composables.md",
  "docs/fr/physics/physics2d-composables.md",
];

describe("API reference pages", () => {
  it("2D composable pages state damping default 0 and fixedRotation as implemented", () => {
    const english = pageText("docs/physics/physics2d-composables.md");
    expect(english).toContain("Linear velocity damping (default: 0)\n");
    expect(english).toContain("Angular velocity damping (default: 0)\n");
    expect(english).toContain("Lock rotation (default: false)");
    expect(english).not.toContain("(default: 0.1)");
    expect(english).not.toContain("not yet supported");

    const french = pageText("docs/fr/physics/physics2d-composables.md");
    expect(french).toContain("vélocité linéaire (défaut: 0)\n");
    expect(french).toContain("vélocité angulaire (défaut: 0)\n");
    expect(french).toContain("Verrouiller la rotation (défaut: false)");
    expect(french).not.toContain("(défaut: 0.1)");
    expect(french).not.toContain("pas encore pris en charge");
  });

  it("3D composable pages state damping default 0", () => {
    const english = pageText("docs/physics/physics3d-composables.md");
    expect(english).toContain("Velocity damping (default: 0)\n");
    expect(english).toContain("Rotation damping (default: 0)\n");
    expect(english).not.toContain("(default: 0.1)");

    const french = pageText("docs/fr/physics/physics3d-composables.md");
    expect(french).toContain("vélocité (défaut: 0)\n");
    expect(french).toContain("rotation (défaut: 0)\n");
    expect(french).not.toContain("(défaut: 0.1)");
  });

  it("physics helpers name usePhysics2D and the physics2d service key", () => {
    for (const file of PHYSICS2D_PAGES) {
      const text = pageText(file);
      expect(text, file).not.toContain("services.get('physics')");
      expect(text, file).toContain("usePhysics2D()");
      expect(text, file).toContain("`physics2d`");
    }
  });

  it("defineGwenModule is imported from @gwenjs/kit/module", () => {
    const files = [
      "docs/kit/overview.md",
      "docs/kit/custom-module.md",
      "docs/fr/kit/overview.md",
      "docs/fr/kit/custom-module.md",
      "packages/app/README.md",
    ];
    for (const file of files) {
      const text = pageText(file);
      expect(text, file).toContain("@gwenjs/kit/module");
      expect(text, file).not.toContain("`defineGwenModule()` from `@gwenjs/kit`");
      expect(text, file).not.toContain("`defineGwenModule()` depuis `@gwenjs/kit`");
      expect(text, file).not.toContain("from `@gwenjs/kit`'s `defineGwenModule`");
    }
  });

  it("the removed physics3d plugin name is absent from the API pages", () => {
    const files = [
      "docs/api/physics3d.md",
      "docs/api/vite.md",
      "docs/fr/api/physics3d.md",
      "docs/fr/api/vite.md",
    ];
    for (const file of files) {
      expect(pageText(file), file).not.toContain("createGwenPhysics3DPlugin");
    }
  });

  it("the core source README names setupGwen", () => {
    const text = pageText("packages/core/src/README.md");
    expect(text).toContain("setupGwen()");
    expect(text).not.toContain("initWasm");
  });

  it("the vite README scene example type-checks", () => {
    const file = "packages/vite/README.md";
    const text = pageText(file);
    expect(text).not.toContain("onInit");
    const tagged = extractFences(text, file).filter(
      (fence) => fence.tag === "check" || fence.tag === "run",
    );
    const checks = tagged.filter((fence) => fence.tag === "check");
    expect(checks.length).toBeGreaterThan(0);
    expect(checkFences(tagged)).toEqual([]);
  });
});
