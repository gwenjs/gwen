/**
 * @file Context and composable errors.
 *
 * Canonical home of `GwenContextError` and `GwenComposableError`.
 * `@gwenjs/core` re-exports the same class objects.
 */

import { GwenError } from "@gwenjs/schema";

/**
 * Structured error codes for {@link GwenContextError}.
 * Each value is the code a composable throws when called outside that boundary.
 */
export const GwenContextErrorCodes = {
  OUTSIDE_ENGINE_CONTEXT: "CORE:OUTSIDE_ENGINE_CONTEXT",
  OUTSIDE_ACTOR_CONTEXT: "CORE:OUTSIDE_ACTOR_CONTEXT",
  OUTSIDE_SYSTEM_CONTEXT: "CORE:OUTSIDE_SYSTEM_CONTEXT",
  OUTSIDE_SCENE_CONTEXT: "CORE:OUTSIDE_SCENE_CONTEXT",
  OUTSIDE_LAYOUT_CONTEXT: "CORE:OUTSIDE_LAYOUT_CONTEXT",
  OUTSIDE_CLEANUP_CONTEXT: "CORE:OUTSIDE_CLEANUP_CONTEXT",
} as const;

export type GwenContextErrorCode =
  (typeof GwenContextErrorCodes)[keyof typeof GwenContextErrorCodes];

/** One callsite named by {@link GWEN_CONTEXT_BOUNDARIES}. */
export type GwenContextBoundary =
  | "defineSystem()"
  | "defineActor()"
  | "defineScene()"
  | "defineLayout()"
  | "plugin setup()"
  | "engine.run()"
  | "withCleanup()";

const CAPTURE_HINT = [
  "Capture the handle synchronously in the factory, then use it as a closure after await.",
  "const transform = useTransform(); onStart(async () => { await loadAssets(); transform.setPosition(400, 300) })",
].join("\n");

/** Three steps from the former engine message, without its opening line. */
const ENGINE_STEPS = `Common causes and fixes:

1. Called at module top-level or in a plain callback
   → Wrap with engine.run():
     engine.run(() => { useEngine() })

2. Called after an \`await\` inside an async lifecycle callback (context lost)
   → In onEnter / onExit: run through \`gwen dev\` / \`gwen build\` (the GWEN Vite plugin restores the context).
     The async context transform handles this automatically.

   → In onStart or a custom async callback: use withAsyncContext() (exported by the core package):
     onStart(withAsyncContext(async () => {
       await doSomething()
       useHTML()  // ✅ context restored
     }))

   → Or capture the composable before the first await (preferred for actors):
     onStart(async () => {
       const html = useHTML()  // ✅ captured before await
       await doSomething()
       html.mount()
     })`;

function contextHint(code: GwenContextErrorCode): string {
  if (code === GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT) return ENGINE_STEPS;
  return CAPTURE_HINT;
}

/** Valid callsites for each {@link GwenContextErrorCode}. Frozen. */
export const GWEN_CONTEXT_BOUNDARIES: {
  readonly [K in GwenContextErrorCode]: readonly GwenContextBoundary[];
} = {
  [GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT]: [
    "defineSystem()",
    "defineActor()",
    "defineScene()",
    "plugin setup()",
    "engine.run()",
  ],
  [GwenContextErrorCodes.OUTSIDE_ACTOR_CONTEXT]: ["defineActor()"],
  [GwenContextErrorCodes.OUTSIDE_SYSTEM_CONTEXT]: ["defineSystem()", "defineActor()"],
  [GwenContextErrorCodes.OUTSIDE_SCENE_CONTEXT]: ["defineScene()"],
  [GwenContextErrorCodes.OUTSIDE_LAYOUT_CONTEXT]: ["defineLayout()"],
  [GwenContextErrorCodes.OUTSIDE_CLEANUP_CONTEXT]: [
    "defineActor()",
    "plugin setup()",
    "withCleanup()",
  ],
};

Object.freeze(GWEN_CONTEXT_BOUNDARIES);
for (const row of Object.values(GWEN_CONTEXT_BOUNDARIES)) Object.freeze(row);

/**
 * Thrown when a composable runs outside the contexts listed for its code.
 *
 * The message names `composable` and those contexts. In dev, `hint` adds a fix.
 */
export class GwenContextError extends GwenError {
  override readonly code: GwenContextErrorCode;

  override readonly composable: string;

  readonly validContexts: readonly GwenContextBoundary[];

  constructor(
    code: GwenContextErrorCode,
    composable: string,
    options?: { hint?: string | undefined; cause?: unknown },
  ) {
    const valid = GWEN_CONTEXT_BOUNDARIES[code];
    super(code, `Called outside ${valid.join(" or ")}.`, {
      composable,
      hint: __GWEN_DEV__ ? (options?.hint ?? contextHint(code)) : undefined,
      ...(options?.cause !== undefined ? { cause: options.cause } : {}),
    });
    this.name = "GwenContextError";
    this.code = code;
    this.composable = composable;
    this.validContexts = valid;
  }
}

/**
 * Thrown when a composable is called outside its valid context.
 *
 * All GWEN composables (`useEntityId`, `useComponent`, `onStart`, `onDestroy`,
 * `onEvent`, etc.) throw this error when invoked at the wrong lifecycle phase.
 * Catch it with `instanceof GwenComposableError` to handle composable misuse
 * independently from engine or actor errors.
 *
 * @example
 * ```ts
 * try {
 *   useEntityId(); // called outside a factory
 * } catch (e) {
 *   if (e instanceof GwenComposableError) {
 *     console.error('Composable misuse:', e.code, e.message);
 *   }
 * }
 * ```
 */
export class GwenComposableError extends GwenError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "GwenComposableError";
  }
}
