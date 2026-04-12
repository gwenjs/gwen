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
} from "./defines/define-system";
export type { LiveQuery, ComponentDef, EntityAccessor } from "./defines/define-system";
