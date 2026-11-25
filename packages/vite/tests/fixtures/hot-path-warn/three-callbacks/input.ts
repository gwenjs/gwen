import {
  defineSystem,
  onAfterUpdate,
  onBeforeUpdate,
  onRender,
  onUpdate,
  useQuery,
  useService,
  useWasmModule,
} from "@gwenjs/core/system";
import { Position } from "./components";

export const Frame = defineSystem("Frame", () => {
  onBeforeUpdate(() => {
    useQuery([Position]);
  });
  onUpdate(() => {});
  onAfterUpdate(() => {
    useWasmModule("nav");
  });
  onRender(() => {
    useService("fx");
    useService("fx");
  });
});
