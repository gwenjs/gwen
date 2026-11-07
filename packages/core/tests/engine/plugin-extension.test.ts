/**
 * Extension API at engine.use: requirements, compatibility, and dependents.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import type { GwenEngine } from "@gwenjs/core";
import type { GwenExtensionApi, GwenPlugin } from "@gwenjs/schema";
import { definePlugin, isExtensionApiCompatible } from "@gwenjs/kit/plugin";
import "../support/plugin-registry";

const engines: GwenEngine[] = [];

async function open(): Promise<GwenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

function api(major: number, minor: number): GwenExtensionApi {
  return { major, minor };
}

function field(error: unknown, key: string): unknown {
  return error !== null && typeof error === "object" ? Reflect.get(error, key) : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

async function rejected(run: Promise<void>): Promise<unknown> {
  try {
    await run;
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

function countPlugin(
  name: string,
  setups: { n: number },
  extensionApi?: GwenExtensionApi,
): GwenPlugin {
  return {
    name,
    ...(extensionApi === undefined ? {} : { extensionApi }),
    setup() {
      setups.n += 1;
    },
  };
}

function extensionOf(
  name: string,
  base: "base",
  major: number,
  minor: number,
  setups: { n: number },
): GwenPlugin {
  return {
    name,
    requires: { plugins: [{ name: base, extensionApi: api(major, minor) }] },
    setup() {
      setups.n += 1;
    },
  };
}

describe("extension API at engine.use", () => {
  it("an extension without its base rejects CORE:PLUGIN_DEPENDENCY_MISSING before setup", async () => {
    const engine = await open();
    const setups = { n: 0 };
    const error = await rejected(engine.use(extensionOf("ext", "base", 1, 0, setups)));
    expect(field(error, "missing")).toEqual([{ kind: "plugin", name: "base" }]);
    expect(field(error, "code")).toBe("CORE:PLUGIN_DEPENDENCY_MISSING");
    expect(setups.n).toBe(0);
  });

  it("a different major rejects CORE:PLUGIN_EXTENSION_API_MISMATCH before setup", async () => {
    const engine = await open();
    const setups = { n: 0 };
    await engine.use(countPlugin("base", { n: 0 }, api(2, 0)));
    const error = await rejected(engine.use(extensionOf("ext", "base", 1, 0, setups)));
    expect(field(error, "code")).toBe("CORE:PLUGIN_EXTENSION_API_MISMATCH");
    expect(field(error, "mismatches")).toEqual([
      { base: "base", required: { major: 1, minor: 0 }, actual: { major: 2, minor: 0 } },
    ]);
    expect(setups.n).toBe(0);
    expect(engine.getStats().plugins).toEqual(["base"]);
  });

  it("a lower base minor rejects; an equal or higher minor installs", async () => {
    const engine = await open();
    await engine.use(countPlugin("base", { n: 0 }, api(1, 1)));
    const low = { n: 0 };
    const error = await rejected(engine.use(extensionOf("low", "base", 1, 2, low)));
    expect(field(error, "code")).toBe("CORE:PLUGIN_EXTENSION_API_MISMATCH");
    expect(field(error, "mismatches")).toEqual([
      { base: "base", required: { major: 1, minor: 2 }, actual: { major: 1, minor: 1 } },
    ]);
    expect(low.n).toBe(0);
    const equal = { n: 0 };
    const higher = { n: 0 };
    await expect(engine.use(extensionOf("equal", "base", 1, 1, equal))).resolves.toBeUndefined();
    await expect(engine.use(extensionOf("higher", "base", 1, 0, higher))).resolves.toBeUndefined();
    expect(equal.n).toBe(1);
    expect(higher.n).toBe(1);
  });

  it("a base without extensionApi rejects with actual null", async () => {
    const engine = await open();
    const setups = { n: 0 };
    await engine.use(countPlugin("base", { n: 0 }));
    const error = await rejected(engine.use(extensionOf("ext", "base", 1, 0, setups)));
    expect(field(error, "mismatches")).toEqual([
      { base: "base", required: { major: 1, minor: 0 }, actual: null },
    ]);
    expect(field(error, "code")).toBe("CORE:PLUGIN_EXTENSION_API_MISMATCH");
    expect(setups.n).toBe(0);
  });

  it("missing requirements are reported before API mismatches", async () => {
    const engine = await open();
    const setups = { n: 0 };
    await engine.use(countPlugin("base", { n: 0 }, api(2, 0)));
    const ext: GwenPlugin = {
      name: "ext",
      requires: {
        plugins: [
          { name: "gone", extensionApi: api(1, 0) },
          { name: "base", extensionApi: api(1, 0) },
        ],
      },
      setup() {
        setups.n += 1;
      },
    };
    const missing = await rejected(engine.use(ext));
    expect(field(missing, "missing")).toEqual([{ kind: "plugin", name: "gone" }]);
    expect(field(missing, "code")).toBe("CORE:PLUGIN_DEPENDENCY_MISSING");
    expect(setups.n).toBe(0);
    await engine.use(countPlugin("gone", { n: 0 }, api(1, 0)));
    const mismatch = await rejected(engine.use(ext));
    expect(field(mismatch, "code")).toBe("CORE:PLUGIN_EXTENSION_API_MISMATCH");
    expect(field(mismatch, "mismatches")).toEqual([
      { base: "base", required: { major: 1, minor: 0 }, actual: { major: 2, minor: 0 } },
    ]);
    expect(setups.n).toBe(0);
  });

  it("unuse of the base while an extension is installed rejects CORE:PLUGIN_IN_USE naming the extension", async () => {
    const engine = await open();
    await engine.use(countPlugin("base", { n: 0 }, api(1, 0)));
    await expect(engine.use(extensionOf("ext", "base", 1, 0, { n: 0 }))).resolves.toBeUndefined();
    const error = await rejected(engine.unuse("base"));
    expect(field(error, "code")).toBe("CORE:PLUGIN_IN_USE");
    expect(field(error, "dependents")).toEqual(["ext"]);
    expect(engine.getStats().plugins).toEqual(["base", "ext"]);
  });

  it("unuse of the extension leaves the base installed and its hooks firing", async () => {
    const engine = await open();
    let updates = 0;
    await engine.use({
      name: "base",
      extensionApi: api(1, 0),
      setup(host) {
        host.hooks.hook("engine:update", () => {
          updates += 1;
        });
      },
    });
    await expect(engine.use(extensionOf("ext", "base", 1, 0, { n: 0 }))).resolves.toBeUndefined();
    await expect(engine.unuse("ext")).resolves.toBeUndefined();
    expect(engine.getStats().plugins).toEqual(["base"]);
    await engine.startExternal();
    await engine.advance(1 / 60);
    expect(updates).toBe(1);
  });

  it("an extension of an extension blocks each level and stop tears down top first", async () => {
    const engine = await open();
    const order: string[] = [];
    const tear = (name: string): (() => void) => {
      return () => {
        order.push(name);
      };
    };
    await engine.use({
      name: "base",
      extensionApi: api(1, 0),
      setup() {},
      teardown: tear("base"),
    });
    await expect(
      engine.use({
        name: "E1",
        extensionApi: api(1, 0),
        requires: { plugins: [{ name: "base", extensionApi: api(1, 0) }] },
        setup() {},
        teardown: tear("E1"),
      }),
    ).resolves.toBeUndefined();
    await engine.use({
      name: "E2",
      requires: { plugins: [{ name: "E1", extensionApi: api(1, 0) }] },
      setup() {},
      teardown: tear("E2"),
    });
    const baseBlocked = await rejected(engine.unuse("base"));
    expect(field(baseBlocked, "code")).toBe("CORE:PLUGIN_IN_USE");
    expect(field(baseBlocked, "dependents")).toEqual(["E1"]);
    const midBlocked = await rejected(engine.unuse("E1"));
    expect(field(midBlocked, "dependents")).toEqual(["E2"]);
    await engine.stop();
    expect(order).toEqual(["E2", "E1", "base"]);
  });

  it("two extensions on one base: IN_USE lists both; removing one keeps the other working", async () => {
    const engine = await open();
    let updates = 0;
    await engine.use(countPlugin("base", { n: 0 }, api(1, 0)));
    await expect(engine.use(extensionOf("A", "base", 1, 0, { n: 0 }))).resolves.toBeUndefined();
    await engine.use({
      name: "B",
      requires: { plugins: [{ name: "base", extensionApi: api(1, 0) }] },
      setup(host) {
        host.hooks.hook("engine:update", () => {
          updates += 1;
        });
      },
    });
    const blocked = await rejected(engine.unuse("base"));
    expect(field(blocked, "dependents")).toEqual(["A", "B"]);
    await expect(engine.unuse("A")).resolves.toBeUndefined();
    const still = await rejected(engine.unuse("base"));
    expect(field(still, "dependents")).toEqual(["B"]);
    await engine.startExternal();
    await engine.advance(1 / 60);
    expect(updates).toBe(1);
  });

  it("a base on engine A does not satisfy an extension on engine B", async () => {
    const engineA = await open();
    const engineB = await open();
    const setups = { n: 0 };
    await engineA.use(countPlugin("base", { n: 0 }, api(1, 0)));
    const error = await rejected(engineB.use(extensionOf("ext", "base", 1, 0, setups)));
    expect(field(error, "missing")).toEqual([{ kind: "plugin", name: "base" }]);
    expect(field(error, "code")).toBe("CORE:PLUGIN_DEPENDENCY_MISSING");
    expect(setups.n).toBe(0);
    expect(engineA.getStats().plugins).toEqual(["base"]);
    expect(engineB.getStats().plugins).toEqual([]);
  });

  it("use, unuse, use of the extension re-checks the API", async () => {
    const engine = await open();
    const setups = { n: 0 };
    await engine.use(countPlugin("base", { n: 0 }, api(1, 0)));
    await expect(engine.use(extensionOf("ext", "base", 1, 0, setups))).resolves.toBeUndefined();
    expect(setups.n).toBe(1);
    await engine.unuse("ext");
    await engine.unuse("base");
    await engine.use(countPlugin("base", { n: 0 }, api(2, 0)));
    const error = await rejected(engine.use(extensionOf("ext", "base", 1, 0, setups)));
    expect(field(error, "code")).toBe("CORE:PLUGIN_EXTENSION_API_MISMATCH");
    expect(field(error, "mismatches")).toEqual([
      { base: "base", required: { major: 1, minor: 0 }, actual: { major: 2, minor: 0 } },
    ]);
    expect(setups.n).toBe(1);
    expect(engine.getStats().plugins).toEqual(["base"]);
  });

  it("extensionApi boundaries: major 0, minor -1, 1.5 and a missing name reject CORE:PLUGIN_INVALID_SHAPE; major 1 minor 0 installs", async () => {
    const rows: readonly { extra: object; keys: readonly string[]; fragment: string }[] = [
      {
        extra: { extensionApi: { major: 0, minor: 0 } },
        keys: ["extensionApi"],
        fragment: "invalid extensionApi",
      },
      {
        extra: { extensionApi: { major: 1, minor: -1 } },
        keys: ["extensionApi"],
        fragment: "invalid extensionApi",
      },
      {
        extra: { extensionApi: { major: 1.5, minor: 0 } },
        keys: ["extensionApi"],
        fragment: "invalid extensionApi",
      },
      {
        extra: { extensionApi: { major: 1, minor: 0.5 } },
        keys: ["extensionApi"],
        fragment: "invalid extensionApi",
      },
      { extra: { extensionApi: "nope" }, keys: ["extensionApi"], fragment: "invalid extensionApi" },
      { extra: { extensionApi: null }, keys: ["extensionApi"], fragment: "invalid extensionApi" },
      { extra: { extensionApi: [] }, keys: ["extensionApi"], fragment: "invalid extensionApi" },
      {
        extra: { requires: { plugins: [{ extensionApi: api(1, 0) }] } },
        keys: ["requires"],
        fragment: "invalid requires",
      },
      {
        extra: { requires: { plugins: [{ name: "base", extensionApi: { major: 0, minor: 0 } }] } },
        keys: ["requires"],
        fragment: "invalid requires",
      },
      {
        extra: {
          requires: { plugins: ["base", { name: "base", extensionApi: api(1, 0) }] },
        },
        keys: ["requires"],
        fragment: "invalid requires",
      },
      {
        extra: { requires: { plugins: ["base", "base"] } },
        keys: ["requires"],
        fragment: "invalid requires",
      },
      {
        extra: { requires: { plugins: [null] } },
        keys: ["requires"],
        fragment: "invalid requires",
      },
      { extra: { requires: { plugins: [1] } }, keys: ["requires"], fragment: "invalid requires" },
      {
        extra: { requires: { plugins: "base" } },
        keys: ["requires"],
        fragment: "invalid requires",
      },
      {
        extra: { requires: { plugins: [{ name: "base" }] } },
        keys: ["requires"],
        fragment: "invalid requires",
      },
      {
        extra: { requires: { plugins: [{ name: 5, extensionApi: api(1, 0) }] } },
        keys: ["requires"],
        fragment: "invalid requires",
      },
    ];
    for (const row of rows) {
      const engine = await open();
      const setups = { n: 0 };
      const plugin: GwenPlugin = {
        name: "bad",
        setup() {
          setups.n += 1;
        },
      };
      const error = await rejected(engine.use(Object.assign(plugin, row.extra)));
      expect(field(error, "code")).toBe("CORE:PLUGIN_INVALID_SHAPE");
      expect(field(error, "plugin")).toBe("bad");
      expect(field(error, "keys")).toEqual(row.keys);
      expect(messageOf(error)).toContain(row.fragment);
      expect(setups.n).toBe(0);
    }
    const engine = await open();
    const setups = { n: 0 };
    await expect(engine.use(countPlugin("base", setups, api(1, 0)))).resolves.toBeUndefined();
    expect(setups.n).toBe(1);
  });

  it("a string requirement checks no API", async () => {
    const engine = await open();
    const setups = { n: 0 };
    await engine.use(countPlugin("base", { n: 0 }, api(2, 0)));
    // The object form of the same requirement is checked against the base major.
    const checked = await rejected(engine.use(extensionOf("typed", "base", 1, 0, setups)));
    expect(field(checked, "code")).toBe("CORE:PLUGIN_EXTENSION_API_MISMATCH");
    expect(setups.n).toBe(0);
    await expect(
      engine.use({
        name: "ext",
        requires: { plugins: ["base"] },
        setup() {
          setups.n += 1;
        },
      }),
    ).resolves.toBeUndefined();
    expect(setups.n).toBe(1);
    expect(engine.getStats().plugins).toEqual(["base", "ext"]);
  });

  it("kit and core agree on every row of the compatibility table", async () => {
    expect(typeof isExtensionApiCompatible).toBe("function");
    const rows: ReadonlyArray<{
      readonly required: GwenExtensionApi;
      readonly actual: GwenExtensionApi | undefined;
    }> = [
      { required: api(1, 0), actual: api(1, 0) },
      { required: api(1, 0), actual: api(1, 2) },
      { required: api(1, 2), actual: api(1, 0) },
      { required: api(2, 0), actual: api(1, 0) },
      { required: api(1, 0), actual: api(2, 0) },
      { required: api(1, 0), actual: undefined },
      { required: api(1, 2), actual: api(1, 2) },
    ];
    for (const row of rows) {
      const engine = await open();
      const setups = { n: 0 };
      const base =
        row.actual === undefined
          ? definePlugin({ provides: [] }, () => ({ name: "base", setup() {} }))()
          : definePlugin({ provides: [], extensionApi: row.actual }, () => ({
              name: "base",
              setup() {},
            }))();
      await engine.use(base);
      const extension = definePlugin({ provides: [] }, () => ({
        name: "ext",
        requires: { plugins: [{ name: "base", extensionApi: row.required }] },
        setup() {
          setups.n += 1;
        },
      }))();
      const compatible = isExtensionApiCompatible(row.required, base.extensionApi);
      const error = await rejected(engine.use(extension));
      if (compatible) {
        expect(error).toBeUndefined();
        expect(setups.n).toBe(1);
      } else {
        expect(field(error, "code")).toBe("CORE:PLUGIN_EXTENSION_API_MISMATCH");
        expect(setups.n).toBe(0);
      }
    }
  });
});
