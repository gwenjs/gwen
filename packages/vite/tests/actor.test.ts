import { describe, it, expect } from "vitest";
import { generateActorsModule } from "../src/plugins/actor.js";

describe("generateActorsModule", () => {
  it("returns empty actors array when no files given", () => {
    expect(generateActorsModule([])).toContain("export const actors = []");
  });

  it("generates lazy imports for each actor file", () => {
    const code = generateActorsModule([
      "/project/src/actors/enemy.ts",
      "/project/src/actors/player.ts",
    ]);
    expect(code).toContain("import('/project/src/actors/enemy.ts')");
    expect(code).toContain("import('/project/src/actors/player.ts')");
    expect(code).toContain("export const actors = [");
  });

  it("generates correct number of entries", () => {
    const code = generateActorsModule(["/a.ts", "/b.ts", "/c.ts"]);
    expect(code.match(/import\(/g)).toHaveLength(3);
  });
});
