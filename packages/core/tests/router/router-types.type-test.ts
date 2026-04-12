import { expectTypeOf } from "vitest";
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
