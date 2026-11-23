/**
 * @file Root and `./module` value exports of `@gwenjs/physics3d`.
 *
 * This package's `tsconfig.json` includes `src` only, so `tsc` does not
 * typecheck this file. `Reflect.get` keeps the `./module` read assignable.
 */

import { describe, expect, it } from "vitest";
import * as entry from "../src/index";

describe("@gwenjs/physics3d root entry", () => {
  it("has no physics3dModule and no physics3dVitePlugin, and still defaults to Physics3DPlugin", () => {
    expect("physics3dModule" in entry).toBe(false);
    expect("physics3dVitePlugin" in entry).toBe(false);
    expect(Reflect.get(entry, "default")).toBe(Reflect.get(entry, "Physics3DPlugin"));
  });
});

describe("@gwenjs/physics3d ./module entry", () => {
  it("exports physics3dVitePlugin as a function", async () => {
    const loaded = await import("../src/module");
    expect(typeof Reflect.get(loaded, "physics3dVitePlugin")).toBe("function");
  });
});
