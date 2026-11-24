import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "../components";

export const Move = defineSystem("Move", () => useQuery([Position]));
