/**
 * @file Root and `./module` value exports of `@gwenjs/physics2d`.
 *
 * This package's `tsconfig.json` includes `src` only, so `tsc` does not
 * typecheck this file. `Reflect.get` keeps the `./module` read assignable.
 */

import { describe, expect, it } from "vitest";
import * as entry from "../src/index";

describe("@gwenjs/physics2d root entry", () => {
  it("has no default export and no physics2dVitePlugin", () => {
    expect("default" in entry).toBe(false);
    expect("physics2dVitePlugin" in entry).toBe(false);
  });
});

describe("@gwenjs/physics2d ./module entry", () => {
  it("exports physics2dVitePlugin as a function", async () => {
    const loaded = await import("../src/module");
    expect(typeof Reflect.get(loaded, "physics2dVitePlugin")).toBe("function");
  });
});
