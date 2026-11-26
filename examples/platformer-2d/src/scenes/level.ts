import { useActor, useActorPool } from "@gwenjs/core/actor";
import type { EntityId } from "@gwenjs/core";
import { defineScene, onEnter, useSystem } from "@gwenjs/core/scene";
import { CoinPool } from "../actors/Coin";
import { Drifter } from "../actors/Drifter";
import { Ground } from "../actors/Ground";
import { Player } from "../actors/Player";
import { watchDrifter, watchPlayer } from "../plugins/probe";
import { MovementSystem } from "../systems/Movement";

export const level = defineScene("level", () => {
  const ground = useActor(Ground);
  const player = useActor(Player);
  const drifter = useActor(Drifter);
  const coins = useActorPool(CoinPool);
  const coinIds = new Set<EntityId>();
  useSystem(MovementSystem());

  onEnter(() => {
    ground.spawnOnce();
    watchDrifter(drifter.spawnOnce());
    for (const x of [3, 6, 9]) coinIds.add(coins.acquire({ x, y: 0 }));
    player.spawnOnce({ coins, coinIds });
    watchPlayer(() => player.get()?.x ?? 0);
  });
});
