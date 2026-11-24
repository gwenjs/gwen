import { describe, it, expect } from "vitest";
import { generateLayoutsModule, extractLayoutNames } from "../src/plugins/layout.js";

describe("generateLayoutsModule", () => {
  it("returns empty layouts object when no files given", () => {
    const code = generateLayoutsModule(new Map());
    expect(code).toContain("export const layouts = {}");
  });

  it("generates lazy imports for each layout", () => {
    const layoutMap = new Map([
      ["Level1", "/project/src/layouts/level-1.ts"],
      ["DungeonFloor1", "/project/src/layouts/dungeon-floor-1.ts"],
    ]);
    const code = generateLayoutsModule(layoutMap);

    expect(code).toContain("import('/project/src/layouts/level-1.ts')");
    expect(code).toContain("import('/project/src/layouts/dungeon-floor-1.ts')");
    expect(code).toContain("'Level1':");
    expect(code).toContain("'DungeonFloor1':");
    expect(code).toContain("export const layouts = {");
  });

  it("generates correct number of entries", () => {
    const layoutMap = new Map([
      ["A", "/a.ts"],
      ["B", "/b.ts"],
      ["C", "/c.ts"],
    ]);
    const code = generateLayoutsModule(layoutMap);
    const matches = code.match(/import\(/g);
    expect(matches).toHaveLength(3);
  });

  it("properly formats the layouts object", () => {
    const layoutMap = new Map([["TestLayout", "/path/to/test.ts"]]);
    const code = generateLayoutsModule(layoutMap);

    expect(code).toMatch(/\{\s*'TestLayout':/);
    expect(code).toMatch(/\}\s*;/);
  });
});

describe("extractLayoutNames", () => {
  it("extracts layout names from const declarations", () => {
    const code = `const Level1 = defineLayout(() => {});`;
    const names = extractLayoutNames(code);

    expect(names).toContain("Level1");
    expect(names.size).toBe(1);
  });

  it("extracts multiple layout names from the same file", () => {
    const code = `
      const Level1 = defineLayout(() => {});
      const Level2 = defineLayout(() => {});
    `;
    const names = extractLayoutNames(code);

    expect(names).toContain("Level1");
    expect(names).toContain("Level2");
    expect(names.size).toBe(2);
  });

  it("extracts layout names with export keyword", () => {
    const code = `export const Level1 = defineLayout(() => {});`;
    const names = extractLayoutNames(code);

    expect(names).toContain("Level1");
  });

  it("handles multiline defineLayout calls", () => {
    const code = `
      export const ComplexLayout = defineLayout(
        () => {
          return { width: 100 };
        }
      );
    `;
    const names = extractLayoutNames(code);

    expect(names).toContain("ComplexLayout");
  });

  it("returns empty set when no defineLayout found", () => {
    const code = `const x = 1;`;
    const names = extractLayoutNames(code);

    expect(names.size).toBe(0);
  });

  it("ignores non-layout definitions", () => {
    const code = `
      const defineLayout = () => {};
      const Level1 = defineLayout(() => {});
      const someOtherVar = something();
    `;
    const names = extractLayoutNames(code);

    expect(names).toContain("Level1");
    expect(names.size).toBe(1);
  });
});
