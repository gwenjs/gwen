import type { EntityId } from "../../engine/engine-api";
import type { ActorPlugin } from "./types";

/**
 * Call `plugin.spawn` with the props tuple.
 * A void props type takes no argument. Any other props type passes one object.
 */
export function spawnActor<Props>(plugin: ActorPlugin<Props>, props?: Props): EntityId {
  const args = (props === undefined ? [] : [props]) as Props extends void ? [] : [props: Props];
  return plugin.spawn(...args);
}
