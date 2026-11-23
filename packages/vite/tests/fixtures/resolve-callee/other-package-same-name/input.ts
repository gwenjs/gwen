import { defineSystem } from "some-lib";
import { defineScene as ds } from "@gwenjs/core/scene";

export const system = defineSystem(() => 1);
export const scene = ds(() => 1);
