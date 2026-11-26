import type {
  EntityId,
  TransformReader2D,
  TransformRef2D,
  TransformSample2D,
} from "@gwenjs/schema";
import { definePlugin } from "@gwenjs/kit/plugin";

export interface Canvas2DShape {
  readonly w: number;
  readonly h: number;
  readonly color: string;
}

export interface Canvas2DRenderer {
  draw(entity: EntityId, shape: Canvas2DShape): void;
}

declare module "@gwenjs/schema" {
  interface GwenProvides {
    canvas2d: Canvas2DRenderer;
  }
}

const SCALE = 40;

/** The part of a `CanvasRenderingContext2D` the plugin draws with. A test injects a recorder. */
export interface Canvas2DContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}

interface RenderCanvas2DOptions {
  /** Drawn into instead of a page canvas. Absent: the plugin appends its own canvas. */
  context: Canvas2DContext | undefined;
  width: number;
  height: number;
}

const DEFAULTS: RenderCanvas2DOptions = { context: undefined, width: 640, height: 360 };

interface DrawnShape {
  entity: EntityId;
  ref: TransformRef2D;
  shape: Canvas2DShape;
}

export default definePlugin(
  { provides: ["canvas2d"], options: { defaults: DEFAULTS } },
  (options) => {
    const drawn: DrawnShape[] = [];
    let canvas: HTMLCanvasElement | undefined;
    let reader: TransformReader2D | undefined;

    return {
      name: "example:render-canvas2d",
      requires: { services: ["transform:2d"] },
      setup(engine) {
        const transforms = engine.inject("transform:2d");
        reader = transforms;
        let context: Canvas2DContext;
        if (options.context === undefined) {
          const element = document.createElement("canvas");
          element.id = "platformer-canvas";
          element.width = options.width;
          element.height = options.height;
          document.body.appendChild(element);
          canvas = element;
          const own = element.getContext("2d");
          if (own === null) throw new Error("Canvas 2D is not available");
          context = own;
        } else {
          context = options.context;
        }
        const sample: TransformSample2D = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
        engine.provide("canvas2d", {
          draw(entity, shape) {
            drawn.push({ entity, ref: transforms.track(entity), shape });
          },
        });
        engine.hooks.hook("entity:destroy", (id) => {
          for (let index = drawn.length - 1; index >= 0; index -= 1) {
            const item = drawn[index];
            if (item === undefined || item.entity !== id) continue;
            transforms.release(item.ref);
            drawn.splice(index, 1);
          }
        });
        engine.hooks.hook("engine:render", () => {
          context.clearRect(0, 0, options.width, options.height);
          for (const item of drawn) {
            if (!transforms.read(item.ref, sample)) continue;
            const w = item.shape.w * SCALE;
            const h = item.shape.h * SCALE;
            context.fillStyle = item.shape.color;
            context.fillRect(
              options.width / 2 + sample.x * SCALE - w / 2,
              options.height - 40 - sample.y * SCALE - h / 2,
              w,
              h,
            );
          }
        });
      },
      teardown() {
        const transforms = reader;
        if (transforms !== undefined) {
          for (const item of drawn) transforms.release(item.ref);
        }
        drawn.length = 0;
        if (canvas !== undefined) canvas.remove();
        canvas = undefined;
        reader = undefined;
      },
    };
  },
);
