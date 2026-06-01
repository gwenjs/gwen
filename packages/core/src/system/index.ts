export {
  defineSystem,
  onUpdate,
  onBeforeUpdate,
  onAfterUpdate,
  onRender,
  useQuery,
  useService,
  useWasmModule,
} from "./runtime/define-system";
export type { LiveQuery, ComponentDef, EntityAccessor } from "./runtime/define-system";
export { useComponentFor } from "./runtime/use-component";
