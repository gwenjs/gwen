import { emit, onCleanup } from "@gwenjs/core";
import {
  defineActor,
  definePrefab,
  useEntityId,
  useTransform,
  type ActorPool,
} from "@gwenjs/core/actor";
import type { EntityId } from "@gwenjs/core";
import { onUpdate, useService } from "@gwenjs/core/system";
import { onContact, useDynamicBody } from "@gwenjs/physics2d";
import type { CoinProps } from "./Coin";

export interface PlayerProps {
  coins: ActorPool<CoinProps, unknown>;
  coinIds: Set<EntityId>;
}

export const Player = defineActor(definePrefab([]), (props: PlayerProps) => {
  const transform = useTransform();
  const canvas = useService("canvas2d");
  const self = useEntityId();
  const body = useDynamicBody({ fixedRotation: true });
  canvas.draw(self, { w: 1, h: 1, color: "#e53935" });

  const keys = new Set<string>();
  const down = (event: KeyboardEvent): void => {
    keys.add(event.key);
  };
  const up = (event: KeyboardEvent): void => {
    keys.delete(event.key);
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  onCleanup(() => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
  });

  let total = 0;
  onContact((contact) => {
    if (!contact.started) return;
    const other = contact.entityA === self ? contact.entityB : contact.entityA;
    if (!props.coinIds.delete(other)) return;
    props.coins.release(other);
    total += 1;
    emit("game:coin-collected", { total });
  });

  onUpdate(() => {
    const dir = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
    body.setVelocity(dir * 4, body.velocity.y);
  });

  return {
    get x(): number {
      return transform.worldRaw.x;
    },
  };
});
