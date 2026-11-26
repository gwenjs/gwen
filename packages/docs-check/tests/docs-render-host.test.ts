import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../src/deprecated-walker.js";

const REMOVED = [
  "createManagerServices",
  "getOrCreateLayerManager",
  "getOrCreateScreenService",
  "getOrCreateCameraManager",
  "getOrCreateViewportManager",
  "createViewportsPlugin",
  "createScreenPlugin",
  "FOREIGN_LAYER_MANAGER",
];

function page(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), "utf8");
}

describe("render host docs", () => {
  it("the custom renderer guide registers on the declared layerManager and never mounts (EN and FR)", () => {
    for (const file of ["docs/kit/custom-renderer.md", "docs/fr/kit/custom-renderer.md"]) {
      const text = page(file);
      expect(text, file).toContain("engine.inject('layerManager').register(");
      expect(text, file).toContain("RenderHostPlugin");
      expect(text, file).not.toContain("manager.mount()");
      for (const name of REMOVED) expect(text, `${file} ${name}`).not.toContain(name);
    }
  });

  it("the renderer-core API page documents RenderHostPlugin and none of the removed names (EN and FR)", () => {
    for (const file of ["docs/api/renderer-core.md", "docs/fr/api/renderer-core.md"]) {
      const text = page(file);
      expect(text, file).toContain("RenderHostPlugin");
      expect(text, file).toContain("RENDERER:MOUNT_FAILED");
      for (const name of REMOVED) expect(text, `${file} ${name}`).not.toContain(name);
    }
  });

  it("the screen page names the render host and no getOrCreateScreenService (EN and FR)", () => {
    for (const file of ["docs/rendering/screen.md", "docs/fr/rendering/screen.md"]) {
      const text = page(file);
      expect(text, file).toContain("RenderHostPlugin");
      expect(text, file).not.toContain("getOrCreateScreenService");
    }
  });
});
