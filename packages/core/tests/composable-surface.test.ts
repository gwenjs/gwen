/**
 * @file Target composable surface of the five core entries (#75, P-75-2).
 *
 * Every table below describes the surface after the rename and move, not the
 * surface of today. A name that is on the wrong entry, or not yet renamed,
 * fails here.
 */

import { describe, expect, it } from "vitest";
import type { AutoImport, GwenKit } from "@gwenjs/schema";
import * as kit from "@gwenjs/kit";
import * as root from "../src/index";
import * as system from "../src/system/index";
import * as actor from "../src/actor/index";
import * as scene from "../src/scene/index";
import * as tween from "../src/tween/index";
import actorModule from "../src/actor/module.js";
import systemModule from "../src/system/module.js";
import sceneModule from "../src/scene/module.js";
import tweenModule from "../src/tween/module.js";
import routerModule from "../src/router/module.js";

const ENTRIES: Record<string, object> = { root, system, actor, scene, tween };
const ENTRY_NAMES = ["root", "system", "actor", "scene", "tween"] as const;
type EntryName = (typeof ENTRY_NAMES)[number];

const PREFIX_RULE = /^(define|use|on|place|create|get|with)[A-Z]/;

const EASING_NAMES = [
  "linear",
  "easeInQuad",
  "easeOutQuad",
  "easeInOutQuad",
  "easeInCubic",
  "easeOutCubic",
  "easeInOutCubic",
  "easeInQuart",
  "easeOutQuart",
  "easeInOutQuart",
  "easeInSine",
  "easeOutSine",
  "easeInOutSine",
  "easeInExpo",
  "easeOutExpo",
  "easeInOutExpo",
  "easeInBack",
  "easeOutBack",
  "easeInOutBack",
  "easeInElastic",
  "easeOutElastic",
  "easeInOutElastic",
  "easeInBounce",
  "easeOutBounce",
  "easeInOutBounce",
  "spring",
];

interface Classification {
  /** Function exports that follow the prefix rule. */
  prefixed: readonly string[];
  /** Function exports that do not follow it, each with the reason. */
  allowlist: Readonly<Record<string, string>>;
}

const EASING_ALLOWLIST: Readonly<Record<string, string>> = Object.fromEntries(
  EASING_NAMES.map((name) => [name, "easing function, named after the curve"]),
);

const SURFACE: Record<EntryName, Classification> = {
  root: {
    prefixed: [
      "createEntityId",
      "defineComponent",
      "useHook",
      "onCleanup",
      "withCleanup",
      "defineHooks",
      "createEngine",
      "createErrorBus",
      "createLogger",
      "useEngine",
      "withAsyncContext",
      "createEngineLocal",
    ],
    allowlist: {
      emit: "fires a user hook; the one verb-named composable on the root",
      setupGwen: "async engine bootstrap, the setup counterpart of createEngine",
      unpackEntityId: "pure helper, inverse of createEntityId",
      consoleLogProvider: "factory of the default log provider, not a composable",
      readInterpolatedTransform2D: "pure read of a transform pair, used by renderers",
    },
  },
  system: {
    prefixed: [
      "defineSystem",
      "onUpdate",
      "onBeforeUpdate",
      "onAfterUpdate",
      "onRender",
      "useQuery",
      "useService",
      "useWasmModule",
      "useComponent",
    ],
    allowlist: {},
  },
  actor: {
    prefixed: [
      "defineActor",
      "onStart",
      "onDestroy",
      "onRelease",
      "onReset",
      "onEnable",
      "onDisable",
      "useEntityId",
      "definePrefab",
      "useActor",
      "usePrefab",
      "defineLayout",
      "useLayout",
      "useTransform",
      "useChildren",
      "placeActor",
      "placeGroup",
      "placePrefab",
      "defineActorPool",
      "useActorPool",
      "useActorQuery",
    ],
    allowlist: {
      watchActorLeaks: "dev-time leak watcher that returns a stop function",
    },
  },
  scene: {
    prefixed: [
      "defineScene",
      "defineSceneRouter",
      "useSceneRouter",
      "useSystem",
      "onEnter",
      "onExit",
      "onTransitionExit",
      "onTransitionEnter",
    ],
    allowlist: {},
  },
  tween: {
    prefixed: ["useTween", "useSequence"],
    allowlist: EASING_ALLOWLIST,
  },
};

// A class is detected by its source text, which starts with `class`.
function isClass(value: unknown): boolean {
  return typeof value === "function" && /^class\b/.test(Function.prototype.toString.call(value));
}

function isFunctionExport(value: unknown): boolean {
  return typeof value === "function" && !isClass(value);
}

function functionExports(entry: object): string[] {
  return Object.entries(entry)
    .filter(([, value]) => isFunctionExport(value))
    .map(([name]) => name)
    .sort();
}

function valueExports(entry: object): string[] {
  return Object.entries(entry)
    .filter(([, value]) => !isClass(value))
    .map(([name]) => name)
    .sort();
}

function exportOf(entry: object, name: string): unknown {
  return Reflect.get(entry, name);
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((name) => !rightSet.has(name)).sort();
}

// The recording kit follows tests/modules/built-in-modules.test.ts: the module
// contract is public, so the test feeds it a kit that stores the auto-imports.
function isKit(value: object): value is GwenKit {
  return "options" in value;
}

function recordingKit(stored: AutoImport[]): GwenKit {
  const target = { options: {} };
  const proxy = new Proxy(target, {
    get(receiver, key) {
      if (typeof key !== "string") return undefined;
      if (key in receiver) return Reflect.get(receiver, key);
      if (key === "addAutoImports") {
        return (rows: AutoImport[]) => {
          stored.push(...rows);
        };
      }
      return () => undefined;
    },
  });
  if (!isKit(proxy)) throw new Error("recording kit is missing options");
  return proxy;
}

async function autoImportsOf(
  setup: (gwen: GwenKit) => void | Promise<void>,
): Promise<AutoImport[]> {
  const stored: AutoImport[] = [];
  await setup(recordingKit(stored));
  return stored;
}

describe("composable surface", () => {
  it("every function export matches a prefix rule or the allowlist", () => {
    const report: Record<string, Record<string, string[]>> = {};
    for (const name of ENTRY_NAMES) {
      const table = SURFACE[name];
      const actual = functionExports(ENTRIES[name] ?? {});
      const allowlisted = Object.keys(table.allowlist);
      const classified = [...table.prefixed, ...allowlisted];
      report[name] = {
        unclassified: difference(actual, classified),
        stale: difference(classified, actual),
        notPrefixed: table.prefixed.filter((entry) => !PREFIX_RULE.test(entry)).sort(),
        misfiled: allowlisted.filter((entry) => PREFIX_RULE.test(entry)).sort(),
      };
    }
    const clean = Object.fromEntries(
      ENTRY_NAMES.map((name) => [
        name,
        { unclassified: [], stale: [], notPrefixed: [], misfiled: [] },
      ]),
    );
    expect(report).toEqual(clean);
  });

  it("no value export appears in two entries", () => {
    const owners = new Map<string, string[]>();
    for (const name of ENTRY_NAMES) {
      for (const exported of valueExports(ENTRIES[name] ?? {})) {
        owners.set(exported, [...(owners.get(exported) ?? []), name]);
      }
    }
    const doubled = Object.fromEntries(
      [...owners.entries()]
        .filter(([, entries]) => entries.length > 1)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
    expect(
      doubled,
      `names exported by more than one entry: ${Object.keys(doubled).join(", ")}`,
    ).toEqual({});
  });

  it("root use*/on* exports are exactly useEngine, useHook, onCleanup", () => {
    const rootComposables = Object.keys(root)
      .filter((name) => /^(use|on)[A-Z]/.test(name))
      .sort();
    expect(rootComposables).toEqual(["onCleanup", "useEngine", "useHook"]);
  });

  it("each module.ts auto-import list equals the composable exports of its entry", async () => {
    // Composable export of an entry: a function value export that is not a
    // class, whose name starts in lower case, is not a create*, get* or with*
    // helper, and is not an easing function.
    const composableExports = (entry: object): string[] =>
      functionExports(entry).filter(
        (name) =>
          /^[a-z]/.test(name) &&
          !/^(create|get|with)[A-Z]/.test(name) &&
          !EASING_NAMES.includes(name),
      );

    // The router has no entry of its own: its rows point at the scene entry.
    const modules: Record<string, { specifier: string; entry: object; rows: AutoImport[] }> = {
      actor: {
        specifier: "@gwenjs/core/actor",
        entry: actor,
        rows: await autoImportsOf((gwen) => actorModule.setup({}, gwen)),
      },
      system: {
        specifier: "@gwenjs/core/system",
        entry: system,
        rows: await autoImportsOf((gwen) => systemModule.setup({}, gwen)),
      },
      scene: {
        specifier: "@gwenjs/core/scene",
        entry: scene,
        rows: [
          ...(await autoImportsOf((gwen) => sceneModule.setup({}, gwen))),
          ...(await autoImportsOf((gwen) => routerModule.setup({}, gwen))),
        ],
      },
      tween: {
        specifier: "@gwenjs/core/tween",
        entry: tween,
        rows: await autoImportsOf((gwen) => tweenModule.setup({ poolSize: 256 }, gwen)),
      },
    };

    const report: Record<string, { missingRow: string[]; extraRow: string[] }> = {};
    const rootRows: string[] = [];
    for (const [name, { specifier, entry, rows }] of Object.entries(modules)) {
      const listed = rows.filter((row) => row.from === specifier).map((row) => row.name);
      const exported = composableExports(entry);
      report[name] = {
        missingRow: difference(exported, listed),
        extraRow: difference(listed, exported),
      };
      rootRows.push(...rows.filter((row) => row.from === "@gwenjs/core").map((row) => row.name));
    }
    expect(report).toEqual({
      actor: { missingRow: [], extraRow: [] },
      system: { missingRow: [], extraRow: [] },
      scene: { missingRow: [], extraRow: [] },
      tween: { missingRow: [], extraRow: [] },
    });

    const allowedRootRows = [
      "useEngine",
      "useHook",
      "emit",
      "onCleanup",
      "defineHooks",
      "defineComponent",
    ];
    const rootExports = valueExports(root);
    expect({
      outsideAllowedRootRows: difference(rootRows, allowedRootRows),
      missingFromRoot: difference(rootRows, rootExports),
    }).toEqual({ outsideAllowedRootRows: [], missingFromRoot: [] });
  });

  it("onTransitionExit, useSequence exist and the old names do not", () => {
    expect(typeof exportOf(scene, "onTransitionExit")).toBe("function");
    expect(typeof exportOf(tween, "useSequence")).toBe("function");
    const leftovers = ENTRY_NAMES.flatMap((name) =>
      ["onTransitionLeave", "defineSequence"]
        .filter((old) => old in (ENTRIES[name] ?? {}))
        .map((old) => `${name}.${old}`),
    );
    expect(leftovers).toEqual([]);
  });

  it("getCurrentScope is exported and useCurrentScope is not", () => {
    expect(typeof exportOf(kit, "getCurrentScope")).toBe("function");
    expect("useCurrentScope" in kit).toBe(false);
  });
});
