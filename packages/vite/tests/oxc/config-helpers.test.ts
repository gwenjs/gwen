import { describe, it, expect } from "vitest";
import { findDefaultExportObject, readStringArrayProp } from "../../src/oxc/config-helpers";

describe("findDefaultExportObject", () => {
  it("returns the ObjectExpression from export default { ... }", () => {
    const source = `export default { modules: ['a', 'b'], css: ['main.css'] }`;
    const obj = findDefaultExportObject(source);
    expect(obj).not.toBeNull();
    expect(obj!.type).toBe("ObjectExpression");
  });

  it("returns null when there is no export default", () => {
    const source = `const x = 1;`;
    expect(findDefaultExportObject(source)).toBeNull();
  });

  it("returns null when export default is not an object literal", () => {
    const source = `export default myVar;`;
    expect(findDefaultExportObject(source)).toBeNull();
  });
});

describe("readStringArrayProp", () => {
  it("reads a string array property from an ObjectExpression", () => {
    const source = `export default { modules: ['foo', 'bar'] }`;
    const obj = findDefaultExportObject(source)!;
    expect(readStringArrayProp(obj, "modules")).toEqual(["foo", "bar"]);
  });

  it("returns empty array when property is missing", () => {
    const source = `export default { css: [] }`;
    const obj = findDefaultExportObject(source)!;
    expect(readStringArrayProp(obj, "modules")).toEqual([]);
  });

  it("returns empty array when property is not an ArrayExpression", () => {
    const source = `export default { modules: getModules() }`;
    const obj = findDefaultExportObject(source)!;
    expect(readStringArrayProp(obj, "modules")).toEqual([]);
  });
});
