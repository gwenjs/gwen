import { defineActor, defineActorPool, definePrefab, useEntityId } from "@gwenjs/core/actor";
import { useTransform } from "@gwenjs/core/actor";
import { useService } from "@gwenjs/core/system";
import { useBoxCollider } from "@gwenjs/physics2d";
import { Coin } from "../components/Coin";

export interface CoinProps {
  x: number;
  y: number;
}

const CoinActor = defineActor(
  definePrefab([{ def: Coin, defaults: { value: 1 } }]),
  (props: CoinProps) => {
    useTransform();
    const canvas = useService("canvas2d");
    useBoxCollider({
      w: 0.6,
      h: 0.6,
      isSensor: true,
      offsetX: props.x,
      offsetY: props.y,
    });
    canvas.draw(useEntityId(), { w: 0.6, h: 0.6, color: "#fdd835" });
  },
);

export const CoinPool = defineActorPool(CoinActor, { size: 8 });
