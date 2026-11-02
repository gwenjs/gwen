import { describe, expect, it } from "vitest";
import { indexJson } from "../src/json.js";

describe("indexJson", () => {
  it("locates keys and values of nested objects and arrays by path", () => {
    const index = indexJson(`{
  "a": {
    "b": [
      "x",
      { "c": 1 }
    ]
  },
  "d": null
}
`);

    expect(index.valueLine([])).toBe(1);
    expect(index.keyLine(["a"])).toBe(2);
    expect(index.keyLine(["a", "b"])).toBe(3);
    expect(index.valueLine(["a", "b"])).toBe(3);
    expect(index.valueLine(["a", "b", "0"])).toBe(4);
    expect(index.valueLine(["a", "b", "1"])).toBe(5);
    expect(index.keyLine(["a", "b", "1", "c"])).toBe(5);
    expect(index.valueLine(["a", "b", "1", "c"])).toBe(5);
    expect(index.keyLine(["d"])).toBe(8);
    expect(index.valueLine(["d"])).toBe(8);
  });

  it("returns undefined for a path that is absent, for the root key and for an array element key", () => {
    const index = indexJson(`{
  "a": ["x"],
  "b": { "c": 1 }
}
`);

    expect(index.keyLine(["missing"])).toBeUndefined();
    expect(index.valueLine(["missing"])).toBeUndefined();
    expect(index.keyLine([])).toBeUndefined();
    expect(index.keyLine(["a", "0"])).toBeUndefined();
    expect(index.valueLine(["a", "0"])).toBe(2);
    expect(index.valueLine(["a", "1"])).toBeUndefined();
  });

  it("does not match a nested key at a shallower path", () => {
    const index = indexJson(`{
  "outer": {
    "inner": 1
  },
  "inner": 2
}
`);

    expect(index.keyLine(["inner"])).toBe(5);
    expect(index.keyLine(["outer", "inner"])).toBe(3);
    expect(index.keyLine(["outer", "outer"])).toBeUndefined();
  });

  it("decodes escaped quotes, escaped backslashes and unicode escapes in keys", () => {
    const index = indexJson(String.raw`{
  "a\"b": 1,
  "c\\": 2,
  "é": 3,
  "é!": 4,
  "after": 5
}
`);

    expect(index.keyLine(['a"b'])).toBe(2);
    expect(index.keyLine(["c\\"])).toBe(3);
    expect(index.keyLine(["é"])).toBe(4);
    expect(index.keyLine(["é!"])).toBe(5);
    expect(index.keyLine(["after"])).toBe(6);
  });

  it("counts a CRLF break as one line", () => {
    const index = indexJson('{\r\n  "a": 1,\r\n  "b": {\r\n    "c": 2\r\n  }\r\n}\r\n');

    expect(index.keyLine(["a"])).toBe(2);
    expect(index.keyLine(["b"])).toBe(3);
    expect(index.keyLine(["b", "c"])).toBe(4);
  });

  it("keeps a surrogate pair key whole, raw or escaped", () => {
    const index = indexJson(String.raw`{
  "😀": 1,
  "😀x": 2,
  "after": 3
}
`);

    expect(index.keyLine(["😀"])).toBe(2);
    expect(index.keyLine(["😀x"])).toBe(3);
    expect(index.keyLine(["after"])).toBe(4);
  });

  it("locates the members that follow an empty object and an empty array", () => {
    const index = indexJson(`{
  "a": {},
  "b": [ ],
  "c": 1
}
`);

    expect(index.valueLine(["a"])).toBe(2);
    expect(index.valueLine(["b"])).toBe(3);
    expect(index.keyLine(["c"])).toBe(4);
    expect(index.keyLine(["a", "x"])).toBeUndefined();
    expect(indexJson("{}").valueLine([])).toBe(1);
    expect(indexJson("{}").keyLine(["a"])).toBeUndefined();
  });

  it("tells a key apart from a string value with the same text", () => {
    const index = indexJson(`{
  "name": "exports",
  "exports": "name"
}
`);

    expect(index.keyLine(["name"])).toBe(2);
    expect(index.valueLine(["name"])).toBe(2);
    expect(index.keyLine(["exports"])).toBe(3);
    expect(index.valueLine(["exports"])).toBe(3);
    expect(index.keyLine(["name", "exports"])).toBeUndefined();
  });

  it("puts a key at column 0 on its own line", () => {
    const index = indexJson('{\n"a": 1,\n"b": 2\n}');

    expect(index.keyLine(["a"])).toBe(2);
    expect(index.keyLine(["b"])).toBe(3);
  });

  it("resolves every line of a long document", () => {
    const lines: string[] = [];
    for (let position = 0; position < 1000; position += 1) {
      lines.push(`  "k${position}": ${position}`);
    }
    const index = indexJson(`{\n${lines.join(",\n")}\n}\n`);

    expect(index.keyLine(["k0"])).toBe(2);
    expect(index.keyLine(["k1"])).toBe(3);
    expect(index.keyLine(["k499"])).toBe(501);
    expect(index.keyLine(["k500"])).toBe(502);
    expect(index.keyLine(["k999"])).toBe(1001);
  });

  it("keeps the last of two equal keys, as JSON.parse does", () => {
    const index = indexJson('{\n  "a": 1,\n  "a": 2\n}\n');

    expect(index.keyLine(["a"])).toBe(3);
    expect(index.valueLine(["a"])).toBe(3);
  });

  it("locates numbers, booleans and null", () => {
    const index = indexJson(`{
  "n": -1.5e3,
  "t": true,
  "f": false,
  "z": null
}
`);

    expect(index.valueLine(["n"])).toBe(2);
    expect(index.valueLine(["t"])).toBe(3);
    expect(index.valueLine(["f"])).toBe(4);
    expect(index.valueLine(["z"])).toBe(5);
  });

  it("keeps what it found before a syntax break and does not throw", () => {
    const index = indexJson('{\n"a": 1,\n"b" 2\n}');

    expect(index.keyLine(["a"])).toBe(2);
    expect(index.keyLine(["b"])).toBeUndefined();
    expect(indexJson('{"a": "never closed').keyLine(["a"])).toBe(1);
    expect(indexJson("").valueLine([])).toBeUndefined();
  });

  it("indexes a deeply nested array without recursing", () => {
    const depth = 50000;
    const index = indexJson(`${"[".repeat(depth)}${"]".repeat(depth)}`);

    expect(index.valueLine([])).toBe(1);
    expect(index.valueLine(["0"])).toBe(1);
  });
});
