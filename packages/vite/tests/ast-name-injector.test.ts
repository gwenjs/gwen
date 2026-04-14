import { describe, it, expect } from "vitest";
import { createAstNameInjector } from "../src/plugins/ast-name-injector";

describe("createAstNameInjector", () => {
  it("injects name into matching call", () => {
    const transform = createAstNameInjector("defineSystem", (varName, args, s) => {
      if (args.length > 0 && args[0]!.type !== "Literal") {
        s.prependLeft(args[0]!.start, `'${varName}', `);
        return true;
      }
      return false;
    });

    const result = transform("export const ScoreSystem = defineSystem(() => {})");
    expect(result).toContain("defineSystem('ScoreSystem',");
  });

  it("does not modify already-named calls", () => {
    const transform = createAstNameInjector("defineSystem", (varName, args, s) => {
      if (args.length > 0 && args[0]!.type !== "Literal") {
        s.prependLeft(args[0]!.start, `'${varName}', `);
        return true;
      }
      return false;
    });

    const input = "export const ScoreSystem = defineSystem('ScoreSystem', () => {})";
    expect(transform(input)).toBe(input);
  });

  it("returns original code when no matching call found", () => {
    const transform = createAstNameInjector("defineSystem", () => true);
    const input = "const x = 42;";
    expect(transform(input)).toBe(input);
  });
});
