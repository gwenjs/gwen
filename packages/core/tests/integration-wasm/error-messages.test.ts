import { describe, expect, it } from "vitest";
import { errorDocsUrl, GwenError } from "@gwenjs/schema";
import { CoreErrorCodes, GwenContextError, GwenWasmError } from "@gwenjs/core";
import { useTransform } from "@gwenjs/core/actor";
import { onUpdate } from "@gwenjs/core/system";
import { Physics3DPlugin, useDynamicBody } from "@gwenjs/physics3d";
import { createRealEngine } from "./harness.js";
import { NO_MEMORY_WASM, wasmDataUrl } from "./fixtures/transform-reader.js";

function thrown(run: () => void): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

async function thrownAsync(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error;
  }
}

function asContext(error: unknown): GwenContextError {
  expect(error).toBeInstanceOf(GwenContextError);
  if (!(error instanceof GwenContextError)) throw new Error("expected GwenContextError");
  return error;
}

function seeLine(code: string): string {
  return `See ${errorDocsUrl(code)} (${code})`;
}

describe("real wasm error grammar", () => {
  it("useTransform outside an actor names useTransform and defineActor()", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const error = asContext(thrown(() => handle.engine.run(() => useTransform())));
      expect(error.code).toBe("CORE:OUTSIDE_ACTOR_CONTEXT");
      expect(error.composable).toBe("useTransform");
      expect(error.message.startsWith("[useTransform()] Called outside defineActor().")).toBe(true);
      expect(error.message.endsWith(seeLine(error.code))).toBe(true);
      expect(error.docsUrl).toBe(errorDocsUrl(error.code));
    } finally {
      await handle.dispose();
    }
  });

  it("useDynamicBody outside an actor on a real physics3d engine names useDynamicBody", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 16 });
    try {
      await handle.engine.use(Physics3DPlugin({ gravity: { x: 0, y: -10, z: 0 } }));
      const error = asContext(thrown(() => handle.engine.run(() => useDynamicBody())));
      expect(error.code).toBe("CORE:OUTSIDE_ACTOR_CONTEXT");
      expect(error.composable).toBe("useDynamicBody");
      expect(error.message.startsWith("[useDynamicBody()] Called outside defineActor().")).toBe(
        true,
      );
      expect(error.message.endsWith(seeLine(error.code))).toBe(true);
    } finally {
      await handle.dispose();
    }
  });

  it("onUpdate outside a system names onUpdate", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const error = asContext(thrown(() => onUpdate(() => {})));
      expect(error.code).toBe("CORE:OUTSIDE_SYSTEM_CONTEXT");
      expect(error.composable).toBe("onUpdate");
      expect(
        error.message.startsWith("[onUpdate()] Called outside defineSystem() or defineActor()."),
      ).toBe(true);
      expect(error.message.endsWith(seeLine(error.code))).toBe(true);
    } finally {
      await handle.dispose();
    }
  });

  it("createEntity at the entity limit gives a GwenWasmError that follows the grammar", async () => {
    const N = 2;
    const handle = await createRealEngine({ variant: "light", maxEntities: N });
    try {
      const ids: bigint[] = [];
      for (let i = 0; i < N; i += 1) ids.push(handle.engine.createEntity());
      expect(new Set(ids).size).toBe(N);
      const caught = thrown(() => handle.engine.createEntity());
      expect(caught).toBeInstanceOf(GwenWasmError);
      if (!(caught instanceof GwenWasmError)) return;
      expect(caught.code).toBe(CoreErrorCodes.ENTITY_LIMIT_REACHED);
      expect(caught.exportName).toBe("create_entity");
      const code = CoreErrorCodes.ENTITY_LIMIT_REACHED;
      expect(caught.message).toBe(`[GWEN] Entity limit reached: ${N}.\n${seeLine(code)}`);
      expect(caught.docsUrl).toBe(errorDocsUrl(code));
      expect(caught.message.includes("Fix:")).toBe(false);
    } finally {
      await handle.dispose();
    }
  });

  it("loadWasmModule without an exported memory gives CORE:WASM_MODULE_NO_MEMORY", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      const hint = __GWEN_DEV__
        ? 'Add (export "memory" (memory ...)) to the WASM module.'
        : undefined;
      const caught = await thrownAsync(() =>
        handle.engine.loadWasmModule({
          name: "bare",
          url: wasmDataUrl(NO_MEMORY_WASM),
          channels: [{ name: "commands", direction: "ts→wasm", capacity: 1, itemByteSize: 4 }],
        }),
      );
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      expect(caught.code).toBe(CoreErrorCodes.WASM_MODULE_NO_MEMORY);
      expect(caught.composable).toBe("engine.loadWasmModule");
      expect(caught.hint).toBe(hint);
      const code = CoreErrorCodes.WASM_MODULE_NO_MEMORY;
      const fix = hint !== undefined ? `\nFix: ${hint}` : "";
      expect(caught.message).toBe(
        `[engine.loadWasmModule()] Channel "commands" was declared but module "bare" does not export memory.${fix}\n${seeLine(code)}`,
      );
    } finally {
      await handle.dispose();
    }
  });

  it("the production message has the first line and the See line only", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const error = asContext(thrown(() => handle.engine.run(() => useTransform())));
      const lines = error.message.split("\n");
      expect(lines[0]).toBe("[useTransform()] Called outside defineActor().");
      expect(lines[lines.length - 1]).toBe(seeLine("CORE:OUTSIDE_ACTOR_CONTEXT"));
      if (__GWEN_DEV__) {
        expect(error.message).toContain("\nFix:");
      } else {
        expect(lines).toHaveLength(2);
        expect(error.message.includes("Fix:")).toBe(false);
      }
    } finally {
      await handle.dispose();
    }
  });
});
