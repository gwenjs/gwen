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

interface DrawnShape {
  entity: EntityId;
  ref: TransformRef2D;
  shape: Canvas2DShape;
}

export default definePlugin({ provides: ["canvas2d"] }, () => {
  const drawn: DrawnShape[] = [];
  let canvas: HTMLCanvasElement | undefined;
  let reader: TransformReader2D | undefined;

  return {
    name: "example:render-canvas2d",
    requires: { services: ["transform:2d"] },
    setup(engine) {
      const transforms = engine.inject("transform:2d");
      reader = transforms;
      const element = document.createElement("canvas");
      element.id = "platformer-canvas";
      element.width = 640;
      element.height = 360;
      document.body.appendChild(element);
      canvas = element;
      const context = element.getContext("2d");
      if (context === null) throw new Error("Canvas 2D is not available");
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
        context.clearRect(0, 0, element.width, element.height);
        for (const item of drawn) {
          if (!transforms.read(item.ref, sample)) continue;
          const w = item.shape.w * SCALE;
          const h = item.shape.h * SCALE;
          context.fillStyle = item.shape.color;
          context.fillRect(
            element.width / 2 + sample.x * SCALE - w / 2,
            element.height - 40 - sample.y * SCALE - h / 2,
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
});
