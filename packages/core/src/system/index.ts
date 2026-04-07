// packages/core/src/system/index.ts
export {
  defineSystem,
  onUpdate,
  onBeforeUpdate,
  onAfterUpdate,
  onRender,
  useQuery,
  useService,
  useWasmModule,
} from "../system.js";
export type { LiveQuery, ComponentDef, EntityAccessor } from "../system.js";
