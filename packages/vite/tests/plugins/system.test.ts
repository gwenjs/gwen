import { describe, it, expect } from "vitest";
import { transformSystemNames } from "../../src/plugins/system.js";

describe("transformSystemNames", () => {
  it("injects variable name as first string arg for anonymous arrow function", () => {
    const input = `export const ScoreSystem = defineSystem(() => {})`;
    const out = transformSystemNames(input);
    expect(out).toBe(`export const ScoreSystem = defineSystem('ScoreSystem', () => {})`);
  });

  it("injects name for multiline arrow function", () => {
    const input = `
export const MovementSystem = defineSystem(() => {
  onUpdate((dt) => {})
})`;
    const out = transformSystemNames(input);
    expect(out).toContain(`defineSystem('MovementSystem', () => {`);
  });

  it("does not inject name when first arg is already a string literal", () => {
    const input = `export const ScoreSystem = defineSystem('ScoreSystem', () => {})`;
    const out = transformSystemNames(input);
    expect(out).toBe(input);
  });

  it("does not transform a different name if explicit name differs", () => {
    const input = `export const Foo = defineSystem('CustomName', () => {})`;
    const out = transformSystemNames(input);
    expect(out).toBe(input);
  });

  it("does not modify non-defineSystem calls", () => {
    const input = `export const EnemyActor = defineActor(EnemyPrefab, () => {})`;
    const out = transformSystemNames(input);
    expect(out).toBe(input);
  });

  it("handles multiple systems in one file", () => {
    const input = `
export const AISystem = defineSystem(() => { onUpdate(() => {}) })
export const RenderSystem = defineSystem(() => { onRender(() => {}) })
`;
    const out = transformSystemNames(input);
    expect(out).toContain(`defineSystem('AISystem', `);
    expect(out).toContain(`defineSystem('RenderSystem', `);
  });

  it("returns original string unchanged when no defineSystem is present", () => {
    const input = `export const x = 42`;
    const out = transformSystemNames(input);
    expect(out).toBe(input);
  });
});
