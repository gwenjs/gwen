/**
 * gwenVitePlugin installs no optimizer; optimizer: true is a no-op until #69.
 * gwenOptimizerPlugin and gwenTransform are not exported.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Logger, type Plugin } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as entry from "../../src/index.js";
import { gwenVitePlugin } from "../../src/plugins/index.js";
import type { GwenViteOptions } from "../../src/types.js";

const POSITION = `import { defineComponent, Types } from "@gwenjs/core";
export const Position = defineComponent({ name: "Position", _typeId: 1, schema: { x: Types.f32, y: Types.f32 } });
`;
const VELOCITY = POSITION.replaceAll("Position", "Velocity").replace("_typeId: 1", "_typeId: 2");
const MOVER = `import { defineActor, onUpdate, useComponent } from "@gwenjs/core/actor";
import { Prefab } from "./prefab";
import { useQuery } from "./query";            // local, NOT the canonical binding: the pipeline hoist skips it
import { Position } from "./position";
import { Velocity } from "./velocity";
export const Mover = defineActor(Prefab, () => {
  const entities = useQuery([Position, Velocity]);
  onUpdate((dt) => {
    for (const e of entities) {
      const pos = useComponent(e.id, Position);
      const vel = useComponent(e.id, Velocity);
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
    }
  });
});
`;

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** `@gwenjs/*` is not resolvable from a temp dir. */
const stubGwenImports: Plugin = {
  name: "test:stub-gwen-imports",
  resolveId(id) {
    return id.startsWith("@gwenjs/") ? "\0stub" : undefined;
  },
  load(id) {
    return id === "\0stub" ? "export {};" : undefined;
  },
};

function recordingLogger(warnings: string[]): Logger {
  return {
    hasWarned: false,
    info() {},
    warn(message: string) {
      warnings.push(message);
    },
    warnOnce(message: string) {
      warnings.push(message);
    },
    error() {},
    clearScreen() {},
    hasErrorLogged() {
      return false;
    },
  };
}

async function transformMover(
  options: GwenViteOptions,
): Promise<{ code: string; warnings: string[] }> {
  // macOS tmpdir is /var → /private/var. Vite ids use the real path.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gwen-optimizer-noop-")));
  roots.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/position.ts"), POSITION);
  writeFileSync(join(root, "src/velocity.ts"), VELOCITY);
  writeFileSync(join(root, "src/prefab.ts"), "export const Prefab = {};\n");
  writeFileSync(
    join(root, "src/query.ts"),
    "export const useQuery = (_c: unknown[]): unknown[] => [];\n",
  );
  writeFileSync(join(root, "src/mover.ts"), MOVER);
  const warnings: string[] = [];
  const server = await createServer({
    configFile: false,
    root,
    plugins: [stubGwenImports, gwenVitePlugin(options)],
    server: { middlewareMode: true, hmr: false },
    customLogger: recordingLogger(warnings),
  });
  try {
    const result = await server.transformRequest("/src/mover.ts");
    return { code: result?.code ?? "", warnings };
  } finally {
    await server.close();
  }
}

describe("optimizer is a no-op until #69", () => {
  it("optimizer: true is a no-op until #69", async () => {
    const on = await transformMover({ optimizer: true });
    const off = await transformMover({});
    expect(on.code).not.toContain("queryReadBulk");
    expect(on.code).not.toContain("__gwen_bridge__");
    expect(on.code).toBe(off.code);
  });

  it("an unset optimizer option logs no [gwen:optimizer] warning", async () => {
    const { warnings } = await transformMover({});
    const tagged = warnings.filter((line) => line.includes("[gwen:optimizer]"));
    expect(tagged).toEqual([]);
  });

  it("optimizer: { debug: true } prints no [gwen:optimizer] line", async () => {
    const log = vi.spyOn(console, "log");
    await transformMover({ optimizer: { debug: true } });
    const tagged = log.mock.calls
      .map((call) => call[0])
      .filter((first) => typeof first === "string" && first.includes("[gwen:optimizer]"));
    expect(tagged).toEqual([]);
  });

  it("gwenOptimizerPlugin and gwenTransform are not exported", () => {
    expect("gwenOptimizerPlugin" in entry).toBe(false);
    expect("gwenTransform" in entry).toBe(false);
    expect("gwenPhysics3DOptimizerPlugin" in entry).toBe(true);
  });
});
