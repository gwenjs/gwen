import { describe, it, expect } from "vitest";
import {
  generateActorsModule,
  transformActorNames,
  extractUseActorNames,
} from "../src/plugins/actor.js";
import { parseSource } from "../src/oxc/index.js";
import type { ArrowFunctionExpression } from "oxc-parser";

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

// Helper: parse a factory expression string and return it as an AST node.
function parseFactory(src: string): ArrowFunctionExpression {
  // Wrap in a variable declaration so the parser accepts it
  const code = `const X = defineActor(P, ${src})`;
  const parsed = parseSource("test.ts", code)!;
  const decl = parsed.program.body[0] as {
    type: string;
    declarations: { init: { arguments: { type: string }[] } }[];
  };
  const call = decl.declarations[0]!.init;
  // Last argument is the factory
  const args = call.arguments;
  return args[args.length - 1] as ArrowFunctionExpression;
}

describe("extractUseActorNames", () => {
  it("returns empty array when factory has no useActor calls", () => {
    const factory = parseFactory(`() => { return {} }`);
    expect(extractUseActorNames(factory)).toEqual([]);
  });

  it("returns the identifier name of a single useActor call", () => {
    const factory = parseFactory(`() => { const x = useActor(LaserActor); return {} }`);
    expect(extractUseActorNames(factory)).toEqual(["LaserActor"]);
  });

  it("returns all identifier names for multiple useActor calls", () => {
    const factory = parseFactory(`() => {
      const a = useActor(LaserActor)
      const b = useActor(ParticleActor)
      return {}
    }`);
    expect(extractUseActorNames(factory)).toEqual(["LaserActor", "ParticleActor"]);
  });

  it("finds useActor calls nested inside callbacks", () => {
    const factory = parseFactory(`() => {
      onEvent('foo', () => {
        const x = useActor(ExplosionActor)
      })
      return {}
    }`);
    expect(extractUseActorNames(factory)).toEqual(["ExplosionActor"]);
  });

  it("ignores dynamic useActor calls (non-identifier argument)", () => {
    const factory = parseFactory(`() => {
      const x = useActor(actors[0])
      return {}
    }`);
    expect(extractUseActorNames(factory)).toEqual([]);
  });

  it("does not return duplicates when the same actor is referenced twice", () => {
    const factory = parseFactory(`() => {
      const a = useActor(LaserActor)
      const b = useActor(LaserActor)
      return {}
    }`);
    expect(extractUseActorNames(factory)).toEqual(["LaserActor"]);
  });
});

describe("transformActorNames — _deps injection", () => {
  it("injects _deps when factory contains a useActor call", () => {
    const input = [
      `const LaserManagerActor = defineActor(LaserManagerPrefab, () => {`,
      `  const laser = useActor(LaserActor)`,
      `  return {}`,
      `})`,
    ].join("\n");

    const result = transformActorNames(input);

    // Name injection still works
    expect(result).toContain(`defineActor('LaserManagerActor',`);
    // _deps injection is present
    expect(result).toContain(`LaserManagerActor._plugin._deps = [LaserActor._plugin]`);
  });

  it("does not inject _deps when factory has no useActor calls", () => {
    const input = `const PlayerActor = defineActor(PlayerPrefab, () => { return {} })`;
    const result = transformActorNames(input);
    expect(result).not.toContain("_deps");
  });

  it("injects all deps when factory has multiple useActor calls", () => {
    const input = [
      `const ManagerActor = defineActor(ManagerPrefab, () => {`,
      `  const a = useActor(LaserActor)`,
      `  const b = useActor(ExplosionActor)`,
      `  return {}`,
      `})`,
    ].join("\n");

    const result = transformActorNames(input);
    expect(result).toContain(`LaserActor._plugin`);
    expect(result).toContain(`ExplosionActor._plugin`);
    expect(result).toContain(`ManagerActor._plugin._deps = [`);
  });

  it("does not inject _deps for dynamic useActor arguments", () => {
    const input = [
      `const FooActor = defineActor(FooPrefab, () => {`,
      `  const x = useActor(list[0])`,
      `  return {}`,
      `})`,
    ].join("\n");

    const result = transformActorNames(input);
    expect(result).not.toContain("_deps");
  });

  it("does not inject _deps for definePrefab", () => {
    const input = `const FooPrefab = definePrefab([{ def: Position, defaults: {} }])`;
    const result = transformActorNames(input);
    expect(result).not.toContain("_deps");
  });

  it("handles multiple defineActor declarations in one file independently", () => {
    const input = [
      `const ManagerActor = defineActor(ManagerPrefab, () => {`,
      `  const x = useActor(LaserActor)`,
      `  return {}`,
      `})`,
      `const SimpleActor = defineActor(SimplePrefab, () => { return {} })`,
    ].join("\n");

    const result = transformActorNames(input);
    expect(result).toContain(`ManagerActor._plugin._deps = [LaserActor._plugin]`);
    expect(result).not.toMatch(/SimpleActor\._plugin\._deps/);
  });
});
