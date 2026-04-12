import { describe, it, expect } from "vitest";
import { transformAsyncContext } from "../../src/plugins/async-context.js";

describe("transformAsyncContext", () => {
  it("returns undefined for code with no onEnter/onExit/withAsyncContext", () => {
    const code = `const x = 1; function foo() { return x; }`;
    expect(transformAsyncContext(code, "foo.ts")).toBeUndefined();
  });

  it("instruments await inside async onEnter callback", () => {
    const code = `
onEnter(async () => {
  await loadAssets()
  useEngine()
})`;
    const result = transformAsyncContext(code, "scene.ts");
    expect(result).toBeDefined();
    expect(result!.code).toContain("__executeAsync");
    expect(result!.code).toContain("executeAsync");
    expect(result!.code).toContain(`from "@gwenjs/core"`);
  });

  it("instruments await inside async onExit callback", () => {
    const code = `
onExit(async () => {
  await saveProgress()
})`;
    const result = transformAsyncContext(code, "scene.ts");
    expect(result).toBeDefined();
    expect(result!.code).toContain("__executeAsync");
  });

  it("instruments await inside withAsyncContext callback", () => {
    const code = `
onStart(withAsyncContext(async () => {
  await spawnAnimation()
  useEngine()
}))`;
    const result = transformAsyncContext(code, "actor.ts");
    expect(result).toBeDefined();
    expect(result!.code).toContain("__executeAsync");
  });

  it("does NOT instrument await inside onUpdate", () => {
    const code = `
onUpdate(async () => {
  await something()
})`;
    // onUpdate is not in asyncFunctions — transform should not touch it
    expect(transformAsyncContext(code, "system.ts")).toBeUndefined();
  });

  it("does NOT instrument synchronous onEnter", () => {
    const code = `onEnter(() => { doSetup() })`;
    // No await — transform has nothing to do
    expect(transformAsyncContext(code, "scene.ts")).toBeUndefined();
  });

  it("includes the helperModule import from @gwenjs/core", () => {
    const code = `onEnter(async () => { await load() })`;
    const result = transformAsyncContext(code, "scene.ts");
    expect(result!.code).toContain(`from "@gwenjs/core"`);
    expect(result!.code).not.toContain(`from "unctx"`);
  });

  it("generates a source map", () => {
    const code = `onEnter(async () => { await load() })`;
    const result = transformAsyncContext(code, "scene.ts");
    expect(result!.map).toBeDefined();
  });
});
