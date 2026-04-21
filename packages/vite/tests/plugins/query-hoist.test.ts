import { describe, it, expect } from "vitest";
import { gwenQueryHoistPlugin } from "../../src/plugins/query-hoist";

function transform(code: string): string {
  const plugin = gwenQueryHoistPlugin();
  const result = (plugin as any).transform(code, "test.ts");
  return result?.code ?? code;
}

describe("gwenQueryHoistPlugin", () => {
  it("hoists a static useQuery array to module level", () => {
    const input = `const entities = useQuery([Position, Velocity]);`;
    const output = transform(input);
    expect(output).toContain("const _q0 = [Position, Velocity]");
    expect(output).toContain("useQuery(_q0, 'Position|Velocity')");
    expect(output).not.toMatch(/useQuery\(\[Position/);
  });

  it("pre-computes cache key with sorted component names", () => {
    const input = `const e = useQuery([Velocity, Position]);`;
    const output = transform(input);
    expect(output).toContain("'Position|Velocity'");
  });

  it("does NOT transform dynamic arrays", () => {
    const input = `const e = useQuery(myComponents);`;
    const output = transform(input);
    expect(output).toBe(input);
  });

  it("does NOT transform arrays with spreads", () => {
    const input = `const e = useQuery([...tags, Position]);`;
    const output = transform(input);
    expect(output).toBe(input);
  });

  it("does NOT transform arrays with non-identifier elements", () => {
    const input = `const e = useQuery([getComp()]);`;
    const output = transform(input);
    expect(output).toBe(input);
  });

  it("handles multiple useQuery calls in the same file", () => {
    const input = `const a = useQuery([Position]);\nconst b = useQuery([Velocity]);`;
    const output = transform(input);
    expect(output).toContain("const _q0 =");
    expect(output).toContain("const _q1 =");
  });

  it("fast bail-out: returns undefined for files without useQuery", () => {
    const plugin = gwenQueryHoistPlugin();
    const result = (plugin as any).transform("const x = 1;", "test.ts");
    expect(result).toBeUndefined();
  });

  it("inserts hoisted declarations after the last import", () => {
    const input = `import { useQuery } from '@gwenjs/core';
const e = useQuery([Position]);`;
    const output = transform(input);
    // Should have hoisted declaration between imports and the rest
    const importLine = output.indexOf("import");
    const q0Line = output.indexOf("const _q0");
    const useLine = output.indexOf("useQuery(_q0");
    expect(importLine).toBeLessThan(q0Line);
    expect(q0Line).toBeLessThan(useLine);
  });

  it("handles files with no imports correctly", () => {
    const input = `const e = useQuery([Position]);`;
    const output = transform(input);
    expect(output).toContain("const _q0");
    expect(output).toContain("useQuery(_q0");
  });

  it("preserves other code unchanged", () => {
    const input = `const x = 42;
const e = useQuery([Position]);
const y = x + 1;`;
    const output = transform(input);
    expect(output).toContain("const x = 42;");
    expect(output).toContain("const y = x + 1;");
    expect(output).toContain("useQuery(_q0");
  });
});
