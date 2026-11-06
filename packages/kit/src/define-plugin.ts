/**
 * @file definePlugin — factory API for GWEN plugins.
 *
 * Returns a typed factory function. Plugin authors provide a factory that
 * returns a plain object conforming to the {@link GwenPlugin} interface.
 * The first argument declares the services the plugin provides, the options
 * it accepts, and, for a base, its `extensionApi`. `definePlugin` writes
 * `provides`, `validateOptions`, and `extensionApi` when declared, onto the
 * plugin the factory returns.
 *
 * @example
 * ```typescript
 * import { definePlugin } from '@gwenjs/kit/plugin'
 *
 * export const AudioPlugin = definePlugin(
 *   { provides: ['audio'], options: { defaults: { volume: 1 } } },
 *   (config) => {
 *     const manager = new AudioManager(config)
 *     return {
 *       name: 'AudioPlugin',
 *       setup(engine) {
 *         engine.provide('audio', manager)
 *       },
 *       teardown() { manager.dispose() },
 *     }
 *   },
 * )
 *
 * // Create an instance:
 * const plugin = AudioPlugin({ volume: 0.8 })
 * await engine.use(plugin)
 * ```
 */

import {
  GWEN_PLUGIN_LIFECYCLE_HOOKS,
  type ForbiddenPluginKey,
  type GwenConfigIssue,
  type GwenEngineBase,
  type GwenExtensionApi,
  type GwenPlugin,
  type GwenPluginServiceKey,
  type GwenProvides,
} from "@gwenjs/schema";

/**
 * A typed factory function returned by {@link definePlugin}.
 *
 * When `Options` is `void` the factory requires no arguments.
 * Otherwise the options argument is optional (the declaration's `defaults`
 * fill every key the caller leaves out).
 *
 * @typeParam Options - Options the factory accepts (`void` = no options needed).
 * @typeParam P - The plugin type the factory produces.
 */
export type GwenPluginFactory<Options, P extends GwenPlugin> = [Options] extends [void]
  ? () => P
  : (options?: Options) => P;

/**
 * Compile-time message for a key `definePlugin` does not accept.
 * A lifecycle key names the hook to register inside `setup`.
 * `provides`, `validateOptions`, and `extensionApi` are written by `definePlugin` from its first argument.
 * Any other extra key names the keys a plugin object may declare.
 */
export type PluginKeyError<K extends PropertyKey> = K extends ForbiddenPluginKey
  ? `"${K}" is never called by the engine. In setup(), use engine.hooks.hook("${(typeof GWEN_PLUGIN_LIFECYCLE_HOOKS)[K]}", …)`
  : K extends "provides" | "validateOptions" | "extensionApi"
    ? `"${K}" is set by definePlugin's first argument`
    : `"${K & string}" is not a GwenPlugin key (allowed: name, setup, teardown, onError, requires)`;

/** Keys a plugin author writes in the object the factory returns. */
type AuthorPluginKey = "name" | "setup" | "teardown" | "onError" | "requires";

/**
 * `TPlugin` with every key outside the author keys replaced by {@link PluginKeyError}.
 * The factory return is checked against this, so those keys fail at compile time.
 */
export type ExactPlugin<P extends object> = P & {
  [K in Exclude<keyof P, AuthorPluginKey>]: PluginKeyError<K>;
};

/**
 * The options a caller passes to a plugin factory: every key of `O`, each optional.
 * Under `exactOptionalPropertyTypes` an explicit `undefined` is rejected
 * unless `O[P]` itself includes it.
 */
export type GwenPluginOptionsInput<O> = { [P in keyof O]?: O[P] };

/**
 * What a plugin declares: the services it provides and the options it accepts.
 *
 * @typeParam O - The resolved options shape.
 * @typeParam K - The service keys the plugin provides.
 */
export interface GwenPluginDeclaration<O extends object, K extends GwenPluginServiceKey> {
  /** Service keys the plugin provides. Use the function form when the set depends on the options. */
  provides: readonly K[] | ((options: Readonly<O>) => readonly K[]);
  /**
   * Version of this base's extension surface. Not the package version.
   * Copied onto the plugin. Absent on a plugin that is not a base.
   */
  readonly extensionApi?: GwenExtensionApi;
  options: {
    /** The resolved options shape. Every required key of `O` must be present. */
    defaults: O;
    /** Pure check of the resolved options. A `path` is relative to the options object. */
    validate?: (options: Readonly<O>) => readonly GwenConfigIssue[];
  };
}

/**
 * The engine a plugin `setup` receives: `provide` accepts only the declared keys `K`.
 *
 * @typeParam K - The service keys the plugin provides.
 */
export type GwenPluginSetupEngine<K extends GwenPluginServiceKey> = Omit<
  GwenEngineBase,
  "provide"
> & {
  provide<P extends K>(key: P, value: GwenProvides[P]): void;
};

/**
 * The plugin object a factory passed to {@link definePlugin} returns.
 * `provides`, `validateOptions`, and `extensionApi` are absent: `definePlugin` writes them.
 *
 * @typeParam K - The service keys the plugin provides.
 */
export type GwenPluginDefinition<K extends GwenPluginServiceKey> = Omit<
  GwenPlugin,
  "setup" | "provides" | "validateOptions" | "extensionApi"
> & {
  setup(engine: GwenPluginSetupEngine<K>): void | Promise<void>;
};

/**
 * Members `definePlugin` writes. `extensionApi` is optional on the type.
 * The key is present at run time only when the declaration passed one.
 *
 * @typeParam K - The service keys the plugin provides.
 */
export type GwenDeclaredPlugin<K extends GwenPluginServiceKey> = {
  readonly provides: readonly K[];
  readonly validateOptions: () => readonly GwenConfigIssue[];
  readonly extensionApi?: GwenExtensionApi;
};

/**
 * The service keys a plugin factory declares, or `never` when it declares none.
 *
 * @typeParam F - A factory returned by {@link definePlugin}.
 */
export type GwenPluginProvidedKeys<F> = F extends (...args: never[]) => GwenDeclaredPlugin<infer K>
  ? K
  : never;

/**
 * Define a GWEN plugin via a factory function.
 *
 * The factory returns a plain object conforming to {@link GwenPlugin}.
 * `definePlugin` writes `provides` and `validateOptions` onto that object, and
 * `extensionApi` when the declaration has one. It leaves `setup`, `teardown`
 * and `onError` untouched. A `setup` failure reaches
 * the caller as the original throw. The returned factory never validates and
 * never throws for bad options: `validateOptions()` is a method of the plugin, and nothing calls it
 * at the factory call.
 *
 * The object the factory returns must be extensible: `definePlugin` adds two members to it, so a
 * frozen or sealed object throws a `TypeError` at the factory call.
 *
 * Keys the engine never calls (`onUpdate`, `onRender`, …) are a type error.
 * Register that work with `engine.hooks.hook` inside `setup`. `provides`,
 * `validateOptions`, and `extensionApi` in the factory return are a type error too.
 *
 * Overload 1 declares no services and no options. The types give its factory
 * no argument. The returned function passes whatever argument it receives
 * through unchanged, so a caller that still passes one reaches the factory.
 *
 * @typeParam TPlugin - The concrete plugin type the factory produces. Inferred
 *   from the factory's return type.
 * @param factory - A function that returns a `GwenPlugin` object. It is called
 *   fresh each time the returned factory function is invoked, giving every
 *   plugin instance its own closure state.
 * @returns A typed {@link GwenPluginFactory}. Call it to get a plugin instance
 *   ready for `engine.use()`.
 *
 * @example
 * ```typescript
 * import { definePlugin } from '@gwenjs/kit/plugin'
 *
 * export const BarePlugin = definePlugin(() => ({
 *   name: 'BarePlugin',
 *   setup(engine) {
 *     engine.logger.child('BarePlugin').info('setup')
 *   },
 * }))
 * ```
 */
export function definePlugin<TPlugin extends GwenPluginDefinition<never>>(
  factory: () => ExactPlugin<TPlugin>,
): GwenPluginFactory<void, TPlugin & GwenDeclaredPlugin<never>>;
// The options overload comes before the services-only one on purpose. TypeScript resolves the
// return type of a function expression without parameters once, with the contextual type of the
// first overload that checks it. The services-only overload types `provides` as an array, so a
// `provides: () => [...]` checked there would widen its keys to `string`.
/**
 * Overload 3: options, with or without services (`provides` may be `[]`).
 *
 * The factory receives the frozen resolved options: `defaults` shallow-merged
 * with the caller's argument, where a key the caller sets to `undefined` keeps
 * its default. `options.validate` runs only when `plugin.validateOptions()` is called,
 * never at the factory call.
 *
 * @typeParam O - The resolved options shape, inferred from `options.defaults`.
 * @typeParam K - The service keys the plugin provides.
 * @typeParam TPlugin - The concrete plugin type the factory produces.
 * @param declaration - `{ provides, options: { defaults, validate? }, extensionApi? }`.
 * @param factory - A function that receives the resolved options and returns a `GwenPlugin` object.
 * @returns A typed {@link GwenPluginFactory} whose argument is {@link GwenPluginOptionsInput}.
 *
 * @example
 * ```typescript
 * export const GravityPlugin = definePlugin(
 *   {
 *     provides: ['physics2d'],
 *     options: { defaults: { gravity: -9.8 } },
 *   },
 *   (options) => ({
 *     name: 'GravityPlugin',
 *     setup(engine) {
 *       engine.provide('physics2d', createPhysics(options.gravity))
 *     },
 *   }),
 * )
 *
 * const plugin = GravityPlugin({ gravity: -20 })
 * ```
 */
export function definePlugin<
  O extends object,
  const K extends GwenPluginServiceKey,
  TPlugin extends GwenPluginDefinition<K>,
>(
  declaration: GwenPluginDeclaration<O, K>,
  factory: (options: Readonly<O>) => ExactPlugin<TPlugin>,
): GwenPluginFactory<GwenPluginOptionsInput<O>, TPlugin & GwenDeclaredPlugin<K>>;
/**
 * Overload 2: services, no options.
 *
 * `provides` lists the service keys the plugin provides. Each must be a key of
 * `GwenProvides` that is not an engine key. `engine.provide` in an unannotated
 * `setup` accepts only those keys.
 *
 * @typeParam K - The service keys the plugin provides.
 * @typeParam TPlugin - The concrete plugin type the factory produces.
 * @param declaration - `{ provides, extensionApi? }`.
 * @param factory - A function that returns a `GwenPlugin` object.
 * @returns A typed {@link GwenPluginFactory} that takes no argument.
 *
 * @example
 * ```typescript
 * export const PhysicsPlugin = definePlugin({ provides: ['physics2d'] }, () => ({
 *   name: 'PhysicsPlugin',
 *   setup(engine) {
 *     engine.provide('physics2d', createPhysics())
 *   },
 * }))
 * ```
 */
export function definePlugin<
  const K extends GwenPluginServiceKey,
  TPlugin extends GwenPluginDefinition<K>,
>(
  declaration: { readonly provides: readonly K[]; readonly extensionApi?: GwenExtensionApi },
  factory: () => ExactPlugin<TPlugin>,
): GwenPluginFactory<void, TPlugin & GwenDeclaredPlugin<K>>;
// The implementation signature widens the overloads to runtime shapes, and TypeScript checks it
// only loosely against them. The public return types are deferred conditional types, which a
// function body cannot produce without a cast, so the overloads carry them instead. This is safe
// because the body creates and converts nothing: each factory's return value goes out as returned,
// with its declared members written onto it, so each caller sees exactly the types its overload states.
export function definePlugin(
  ...args:
    | [factory: RuntimeFactory]
    | [declaration: RuntimeDeclaration, factory: RuntimeOptionsFactory]
): unknown {
  if (args.length === 1) {
    const [factory] = args;
    return function PluginFactory(input?: unknown): unknown {
      return declare(factory(input), [], () => [], undefined);
    };
  }
  const [declaration, factory] = args;
  // One frozen copy for every call of this factory. A second defineProperty
  // on a shared return object is allowed only when the value is identical.
  const extensionApi = copyExtensionApi(declaration);
  return function PluginFactory(input?: unknown): unknown {
    const resolved = Object.freeze({
      ...declaration.options?.defaults,
      ...definedEntries(input),
    });
    const plugin = factory(resolved);
    const provides =
      typeof declaration.provides === "function"
        ? declaration.provides(resolved)
        : declaration.provides;
    return declare(
      plugin,
      provides,
      () => declaration.options?.validate?.(resolved) ?? [],
      extensionApi,
    );
  };
}

/** Runtime shape of the factory of overload 1: it receives whatever argument the caller passed. */
type RuntimeFactory = (input?: unknown) => unknown;

/** Runtime shape of the factory of overloads 2 and 3: it receives the frozen resolved options. */
type RuntimeOptionsFactory = (options: Readonly<object>) => unknown;

/** Runtime shape of the first argument: the declaration with its types widened. */
type RuntimeDeclaration = {
  readonly provides: GwenPluginDeclaration<object, GwenPluginServiceKey>["provides"];
  readonly options?: GwenPluginDeclaration<object, GwenPluginServiceKey>["options"];
  readonly extensionApi?: GwenExtensionApi;
};

/** The own enumerable entries of `input` whose value is not `undefined`. */
function definedEntries(input: unknown): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  if (typeof input === "object" && input !== null) {
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) entries[key] = value;
    }
  }
  return entries;
}

/** A frozen own copy, or `undefined` when the declaration has no `extensionApi`. */
function copyExtensionApi(declaration: RuntimeDeclaration): GwenExtensionApi | undefined {
  if (declaration.extensionApi === undefined) return undefined;
  return Object.freeze({ ...declaration.extensionApi });
}

/** Writes `provides`, `validateOptions`, and `extensionApi` when `extensionApi` is set. */
function declare(
  plugin: unknown,
  provides: readonly string[],
  validateOptions: () => readonly GwenConfigIssue[],
  extensionApi: GwenExtensionApi | undefined,
): unknown {
  const declared: unknown = Object.defineProperties(plugin, {
    provides: {
      value: Object.freeze([...new Set(provides)]),
      enumerable: true,
      configurable: true,
    },
    validateOptions: { value: validateOptions, enumerable: true, configurable: true },
  });
  if (extensionApi !== undefined) {
    Object.defineProperty(declared, "extensionApi", {
      value: extensionApi,
      enumerable: true,
    });
  }
  return declared;
}
