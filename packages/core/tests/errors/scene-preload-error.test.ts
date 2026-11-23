/**
 * GwenScenePreloadError: message grammar, cause identity, dev hint.
 */
import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { GwenScenePreloadError } from "../../src/scene/scene-preload-error";

const ROUTER_HINT =
  "Handle the error inside onPreload or keep the previous scene; the transition was cancelled.";
const MAIN_SCENE_HINT =
  "Handle the error inside onPreload of the main scene; the first scene could not be activated.";

function lastLine(message: string): string {
  return message.split("\n").at(-1) ?? "";
}

describe("GwenScenePreloadError", () => {
  it("renders the message, the See line and the fields", () => {
    const cause = new Error("disk");
    const error = new GwenScenePreloadError({ scene: "level", from: "menu", cause });
    expect(error.code).toBe("CORE:SCENE_PRELOAD_FAILED");
    expect(error.name).toBe("GwenScenePreloadError");
    expect(error.composable).toBe("useSceneRouter().send");
    expect(error.scene).toBe("level");
    expect(error.from).toBe("menu");
    expect(error.cause).toBe(cause);
    expect(error).toBeInstanceOf(GwenError);
    expect(error.message.split("\n")[0]).toBe(
      '[useSceneRouter().send()] Preload of scene "level" failed.',
    );
    expect(
      lastLine(error.message).endsWith("#core-scene-preload-failed (CORE:SCENE_PRELOAD_FAILED)"),
    ).toBe(true);
  });

  it("keeps from as null and a non-Error rejection as the cause", () => {
    const text = new GwenScenePreloadError({ scene: "level", from: null, cause: "boom" });
    expect(text.from).toBeNull();
    expect(Object.is(text.cause, "boom")).toBe(true);
    const zero = new GwenScenePreloadError({ scene: "level", from: null, cause: 0 });
    expect(Object.is(zero.cause, 0)).toBe(true);
    const empty = new GwenScenePreloadError({ scene: "level", from: null, cause: null });
    expect(Object.is(empty.cause, null)).toBe(true);
  });

  it("carries the dev hint only in dev builds", () => {
    const error = new GwenScenePreloadError({
      scene: "level",
      from: "menu",
      cause: new Error("x"),
    });
    if (__GWEN_DEV__) {
      expect(error.hint).toBe(ROUTER_HINT);
      expect(error.message).toContain(`Fix: ${ROUTER_HINT}`);
    } else {
      expect(error.hint).toBeUndefined();
      expect(error.message).not.toContain("Fix:");
      expect(error.message.split("\n")[0]).toBe(
        '[useSceneRouter().send()] Preload of scene "level" failed.',
      );
    }
  });

  it("derives the composable and the hint from from", () => {
    const initial = new GwenScenePreloadError({ scene: "level", from: null, cause: "boom" });
    expect(initial.message.split("\n")[0]).toBe('[GWEN] Preload of scene "level" failed.');
    expect(initial.composable).toBeUndefined();
    if (__GWEN_DEV__) {
      expect(initial.hint).toBe(MAIN_SCENE_HINT);
    }
    const routed = new GwenScenePreloadError({ scene: "level", from: "menu", cause: "boom" });
    expect(routed.composable).toBe("useSceneRouter().send");
    expect(routed.message.split("\n")[0]).toBe(
      '[useSceneRouter().send()] Preload of scene "level" failed.',
    );
    if (__GWEN_DEV__) {
      expect(routed.hint).toBe(ROUTER_HINT);
    }
  });
});
