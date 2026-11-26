import { createRealEngine, type RealEngineHandle } from "@gwenjs/core/testing";
import type { SceneFactory } from "@gwenjs/core/scene";
import type { GwenSceneName } from "@gwenjs/schema";
import { Physics2DPlugin } from "@gwenjs/physics2d";
import config from "../gwen.config";
import RenderCanvas2D, { type Canvas2DContext } from "../src/plugins/render-canvas2d";

/** One `fillRect` call, with the `fillStyle` set when it ran. */
export interface Draw {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: string;
}

/** A canvas boundary recorder: `clearRect` starts a render, `fillRect` adds a draw to it. */
export interface Recorder extends Canvas2DContext {
  readonly renders: Draw[][];
}

export function createRecorder(): Recorder {
  const renders: Draw[][] = [];
  return {
    renders,
    fillStyle: "",
    clearRect() {
      renders.push([]);
    },
    fillRect(x, y, w, h) {
      renders[renders.length - 1]?.push({ x, y, w, h, color: String(this.fillStyle) });
    },
  };
}

export interface BootedScene {
  readonly handle: RealEngineHandle;
  readonly recorder: Recorder;
  /** Every `alpha` passed to `engine:render`, in order. */
  readonly alphas: number[];
}

export async function bootScene(scene: SceneFactory<GwenSceneName>): Promise<BootedScene> {
  const maxEntities = config.engine?.maxEntities ?? 2000;
  const handle = await createRealEngine({
    variant: "physics2d",
    maxEntities,
    scenes: true,
    ...(config.engine?.physicsHz !== undefined ? { physicsHz: config.engine.physicsHz } : {}),
  });
  try {
    const { engine } = handle;
    await engine.use(Physics2DPlugin({ ...config.physics2d, maxEntities }));
    const recorder = createRecorder();
    await engine.use(RenderCanvas2D({ context: recorder }));
    const alphas: number[] = [];
    engine.hooks.hook("engine:render", (alpha: number) => {
      alphas.push(alpha);
    });
    const systems = engine.run(() => scene({ register() {} }).systems);
    for (const system of systems) await engine.use(system);
    await engine.hooks.callHook("scene:enter", scene.sceneName, undefined);
    return { handle, recorder, alphas };
  } catch (error) {
    await handle.dispose();
    throw error;
  }
}
