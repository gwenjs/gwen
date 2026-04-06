import { expectTypeOf } from 'vitest';
import type {
  SceneRouterHandle,
  EventsOf,
  StatesOf,
  RouteConfig,
} from '../../src/router/router-types.js';

type MockRoutes = {
  menu: RouteConfig<MockRoutes> & { on: { PLAY: 'game'; OPTIONS: 'settings' } };
  game: RouteConfig<MockRoutes> & { on: { PAUSE: 'pause'; DIE: 'gameover' } };
  pause: RouteConfig<MockRoutes> & { on: { RESUME: 'game'; QUIT: 'menu' } };
  gameover: RouteConfig<MockRoutes> & { on: { RETRY: 'game'; MENU: 'menu' } };
  settings: RouteConfig<MockRoutes> & { on: { BACK: 'menu' } };
};

type Events = EventsOf<MockRoutes>;
type States = StatesOf<MockRoutes>;

// Events should be the union of all event names
expectTypeOf<Events>().toEqualTypeOf<
  'PLAY' | 'OPTIONS' | 'PAUSE' | 'DIE' | 'RESUME' | 'QUIT' | 'RETRY' | 'MENU' | 'BACK'
>();

// States should be all route keys
expectTypeOf<States>().toEqualTypeOf<'menu' | 'game' | 'pause' | 'gameover' | 'settings'>();

// Handle.current should be StatesOf
type MockHandle = SceneRouterHandle<MockRoutes>;
expectTypeOf<MockHandle['current']>().toEqualTypeOf<States>();
