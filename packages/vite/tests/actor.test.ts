import { describe, it, expect } from "vitest";
import { generateActorsModule, transformActorNames } from "../src/plugins/actor.js";

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

describe("transformActorNames — string literal injection", () => {
  it("injects actor name as string literal (not comment)", () => {
    const input = `const EnemyActor = defineActor(EnemyPrefab, () => {});`;
    const result = transformActorNames(input);
    // Must inject a string literal 'EnemyActor' as first arg
    expect(result).toContain(`defineActor('EnemyActor',`);
    // Must NOT inject a comment
    expect(result).not.toContain("/*");
  });

  it("injects name before first argument", () => {
    const input = `const PlayerActor = defineActor(PlayerPrefab, factory);`;
    const result = transformActorNames(input);
    expect(result).toBe(`const PlayerActor = defineActor('PlayerActor', PlayerPrefab, factory);`);
  });

  it("skips if first argument is already a string literal", () => {
    const input = `const Hero = defineActor('Hero', HeroPrefab, factory);`;
    expect(transformActorNames(input)).toBe(input);
  });

  it("handles export const form", () => {
    const input = `export const HeroActor = defineActor(HeroPrefab, () => {});`;
    const result = transformActorNames(input);
    expect(result).toContain(`defineActor('HeroActor',`);
  });

  it("does NOT inject name into definePrefab calls", () => {
    const input = `const EnemyPrefab = definePrefab([]);`;
    const result = transformActorNames(input);
    // definePrefab keeps its comment injection (unchanged behaviour)
    expect(result).not.toContain("definePrefab('EnemyPrefab'");
  });

  it("does not transform defineActor inside a string literal", () => {
    const code = `const s = "const Foo = defineActor(bar)";`;
    expect(transformActorNames(code)).toBe(code);
  });

  it("returns code unchanged if no defineActor or definePrefab", () => {
    expect(transformActorNames(`const x = 1;`)).toBe(`const x = 1;`);
  });

  it("handles defineActor with no arguments (edge case)", () => {
    const code = `const Foo = defineActor();`;
    const result = transformActorNames(code);
    expect(result).toContain(`defineActor('Foo'`);
    expect(result).not.toContain("/*");
  });

  it("transforms multiple defineActor calls in one file", () => {
    const code = [
      `const PlayerActor = defineActor(PlayerPrefab, factory);`,
      `const EnemyActor = defineActor(EnemyPrefab, factory);`,
    ].join("\n");
    const result = transformActorNames(code);
    expect(result).toContain(`defineActor('PlayerActor',`);
    expect(result).toContain(`defineActor('EnemyActor',`);
  });
});
