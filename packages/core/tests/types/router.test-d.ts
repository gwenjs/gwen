import { expectTypeOf } from "vitest";
import { defineScene } from "../../src/scene/runtime/define-scene.js";
import { defineSceneRouter } from "../../src/router/defines/define-scene-router.js";
import { useSceneRouter } from "../../src/router/uses/use-scene-router.js";
import type {
  SceneRouterHandle,
  EventsOf,
  StatesOf,
  SceneInput,
} from "../../src/router/router-types.js";

// Plain object types (no RouteConfig intersection) so the `on` property
// keeps its literal key types — RouteConfig.on uses Record<string, ...>
// which would bleed a string index signature into the intersection.
declare const fakeScene: SceneInput;

type MockRoutes = {
  menu: { scene: typeof fakeScene; on: { PLAY: "game"; OPTIONS: "settings" } };
  game: { scene: typeof fakeScene; on: { PAUSE: "pause"; DIE: "gameover" } };
  pause: { scene: typeof fakeScene; on: { RESUME: "game"; QUIT: "menu" } };
  gameover: { scene: typeof fakeScene; on: { RETRY: "game"; MENU: "menu" } };
  settings: { scene: typeof fakeScene; on: { BACK: "menu" } };
};

type Events = EventsOf<MockRoutes>;
type States = StatesOf<MockRoutes>;

// Events should be the union of all event names
expectTypeOf<Events>().toEqualTypeOf<
  "PLAY" | "OPTIONS" | "PAUSE" | "DIE" | "RESUME" | "QUIT" | "RETRY" | "MENU" | "BACK"
>();

// States should be all route keys
expectTypeOf<States>().toEqualTypeOf<"menu" | "game" | "pause" | "gameover" | "settings">();

// Handle.current should be StatesOf
type MockHandle = SceneRouterHandle<MockRoutes>;
expectTypeOf<MockHandle["current"]>().toEqualTypeOf<States>();

const scene = defineScene("menu", () => {});

const router = defineSceneRouter({
  initial: "menu",
  routes: {
    menu: { scene, on: { PLAY: "game" } },
    game: { scene, on: {} },
  },
});
expectTypeOf(router.__type).toEqualTypeOf<"SceneRouterDefinition">();

type Accepts<O> = typeof defineSceneRouter extends (options: O) => unknown ? true : false;

type BadInitial = {
  initial: "mnu";
  routes: {
    menu: { scene: typeof scene; on: { PLAY: "game" } };
    game: { scene: typeof scene; on: Record<string, never> };
  };
};

type BadTarget = {
  initial: "menu";
  routes: {
    menu: { scene: typeof scene; on: { PLAY: "gmae" } };
    game: { scene: typeof scene; on: Record<string, never> };
  };
};

type GoodOptions = {
  initial: "menu";
  routes: {
    menu: { scene: typeof scene; on: { PLAY: "game" } };
    game: { scene: typeof scene; on: {} };
  };
};

expectTypeOf<Accepts<BadInitial>>().toEqualTypeOf<false>();
expectTypeOf<Accepts<BadTarget>>().toEqualTypeOf<false>();
expectTypeOf<Accepts<GoodOptions>>().toEqualTypeOf<true>();

type GoodRoutes = typeof router.options.routes;

declare function routerHandle(handle: ReturnType<typeof useSceneRouter<GoodRoutes>>): void;

type Handle = Parameters<typeof routerHandle>[0];

type SendAccepts<E> = Handle["send"] extends (
  event: E,
  params?: Record<string, unknown>,
) => Promise<void>
  ? true
  : false;

expectTypeOf<SendAccepts<"TYPO">>().toEqualTypeOf<false>();
expectTypeOf<SendAccepts<"PLAY">>().toEqualTypeOf<true>();
expectTypeOf<Parameters<Handle["send"]>[0]>().toEqualTypeOf<"PLAY">();
