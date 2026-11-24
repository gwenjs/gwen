import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { gwenTweenPlugin } from "../src/plugins/tween.js";
import type { GwenViteOptions } from "../src/types.js";

// ── gwenTweenPlugin — virtual module ─────────────────────────────────────────

const VIRTUAL_ID = "virtual:gwen/used-easings";
const TWEEN_AUTO = [{ name: "useTween", from: "@gwenjs/core/tween" }];

function callHook(plugin: Plugin, name: "configResolved" | "resolveId" | "load", args: unknown[]) {
  const hook = plugin[name];
  if (typeof hook !== "function") return undefined;
  const result: unknown = Reflect.apply(hook, plugin, args);
  return result;
}

describe("gwenTweenPlugin()", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
    roots.length = 0;
  });

  /** A project root on disk holding `files` (path relative to the root to source text). */
  function projectWith(files: Record<string, string>): string {
    const projectRoot = mkdtempSync(join(tmpdir(), "gwen-tween-plugin-"));
    roots.push(projectRoot);
    for (const [rel, source] of Object.entries(files)) {
      const full = join(projectRoot, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, source);
    }
    return projectRoot;
  }

  /** Create the plugin for `projectRoot` and load the virtual module. */
  function loadVirtual(projectRoot: string, opts: GwenViteOptions = {}): string {
    const plugin = gwenTweenPlugin({ autoImports: TWEEN_AUTO, ...opts });
    callHook(plugin, "configResolved", [{ root: projectRoot }]);
    const resolved = callHook(plugin, "resolveId", [VIRTUAL_ID, undefined]);
    if (typeof resolved !== "string") return "";
    const value = callHook(plugin, "load", [resolved]);
    return typeof value === "string" ? value : "";
  }

  it("has the correct plugin name", () => {
    const plugin = gwenTweenPlugin();
    expect(plugin.name).toBe("gwen:tween");
  });

  it("resolves virtual:gwen/used-easings to internal ID", () => {
    const plugin = gwenTweenPlugin();
    expect(callHook(plugin, "resolveId", [VIRTUAL_ID, undefined])).toBe(
      "\0virtual:gwen/used-easings",
    );
  });

  it("does not resolve unknown module IDs", () => {
    const plugin = gwenTweenPlugin();
    // Should be undefined / falsy for unknown IDs.
    expect(callHook(plugin, "resolveId", ["some-other-module", undefined])).toBeFalsy();
  });

  it("virtual module exports empty array when no useTween files are processed", () => {
    const output = loadVirtual(projectWith({}));
    expect(output).toContain("export const usedEasings = []");
  });

  it("virtual module exports detected easing names", () => {
    const output = loadVirtual(
      projectWith({ "src/a.ts": "const t = useTween({ duration: 1, easing: 'easeOutQuad' });\n" }),
    );
    expect(output).toContain("easeOutQuad");
    expect(output).toContain("export const usedEasings");
  });

  it("virtual module exports multiple unique easing names sorted", () => {
    const output = loadVirtual(
      projectWith({
        "src/a.ts": "useTween({ duration: 1, easing: 'spring' })\n",
        "src/b.ts": "useTween({ duration: 2, easing: 'linear' })\n",
      }),
    );
    // Both names must appear.
    expect(output).toContain("linear");
    expect(output).toContain("spring");
    // Sorted: linear before spring alphabetically.
    expect(output.indexOf("linear")).toBeLessThan(output.indexOf("spring"));
  });

  it("does nothing when disableEasingAnalysis is true", () => {
    const projectRoot = projectWith({
      "src/a.ts": "useTween({ duration: 1, easing: 'easeOutQuad' })\n",
    });
    const output = loadVirtual(projectRoot, { tween: { disableEasingAnalysis: true } });
    // Should still return an empty array — no analysis was performed.
    expect(output).toContain("export const usedEasings = []");
  });

  it("load reads the project sources again on every call", () => {
    const projectRoot = projectWith({
      "src/a.ts": "useTween({ duration: 1, easing: 'easeOutExpo' })\n",
    });
    const plugin = gwenTweenPlugin({ autoImports: TWEEN_AUTO });
    callHook(plugin, "configResolved", [{ root: projectRoot }]);
    const resolved = callHook(plugin, "resolveId", [VIRTUAL_ID, undefined]);
    expect(typeof resolved).toBe("string");
    if (typeof resolved !== "string") return;

    expect(callHook(plugin, "load", [resolved])).toContain("easeOutExpo");

    writeFileSync(
      join(projectRoot, "src", "a.ts"),
      "useTween({ duration: 1, easing: 'easeInBack' })\n",
    );
    const second = callHook(plugin, "load", [resolved]);
    expect(second).toContain("easeInBack");
    expect(second).not.toContain("easeOutExpo");
  });

  it("virtual module exports the easing names found under the project root", () => {
    const projectRoot = projectWith({
      "src/actor.ts": 'useTween({ duration: 1, easing: "easeInBack" });\n',
    });
    const text = loadVirtual(projectRoot);
    expect(text).toContain("easeInBack");
  });
});
