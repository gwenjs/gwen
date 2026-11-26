import { describe, expect, it } from "vitest";
import * as rendererCore from "@gwenjs/renderer-core";
import * as app from "../src/index.js";

describe("render host in the app root entry", () => {
  it("re-exports RenderHostPlugin and ScreenPlugin from renderer-core and drops createViewportsPlugin and createScreenPlugin", () => {
    expect(typeof Reflect.get(app, "RenderHostPlugin")).toBe("function");
    expect(Reflect.get(app, "RenderHostPlugin")).toBe(
      Reflect.get(rendererCore, "RenderHostPlugin"),
    );
    expect(typeof Reflect.get(app, "ScreenPlugin")).toBe("function");
    expect(Reflect.get(app, "ScreenPlugin")).toBe(Reflect.get(rendererCore, "ScreenPlugin"));
    expect(Object.keys(app)).not.toContain("createViewportsPlugin");
    expect(Object.keys(app)).not.toContain("createScreenPlugin");
  });
});
