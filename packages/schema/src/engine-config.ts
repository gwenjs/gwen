/**
 * @file Engine config contract: the eight fields, their defaults, and pure rules.
 *
 * `checkEngineConfig` never throws. Callers turn the first issue into their own error.
 */

export interface GwenEngineConfig {
  maxEntities: number;
  targetFPS: number;
  maxDeltaSeconds: number;
  variant: "light" | "physics2d" | "physics3d";
  loop: "internal" | "external";
  physicsHz: number;
  maxCatchupSteps: number;
  debug: boolean;
}

/** Defaults for every engine field except `variant`. */
export const ENGINE_DEFAULTS: Readonly<Omit<GwenEngineConfig, "variant">> = Object.freeze({
  maxEntities: 10_000,
  targetFPS: 60,
  maxDeltaSeconds: 0.1,
  loop: "internal",
  physicsHz: 0,
  maxCatchupSteps: 2,
  debug: false,
});

/**
 * One rejected config field.
 * A resolver sets `conflictsWith` when two sources name different values.
 */
export interface GwenConfigIssue {
  readonly path: string;
  readonly expected: string;
  readonly received: string;
  readonly owner: string;
  readonly conflictsWith?: string;
}

const ENGINE_FIELDS = [
  "maxEntities",
  "targetFPS",
  "maxDeltaSeconds",
  "variant",
  "loop",
  "physicsHz",
  "maxCatchupSteps",
  "debug",
] as const;

type EngineField = (typeof ENGINE_FIELDS)[number];

const EXPECTED: Readonly<Record<EngineField, string>> = {
  maxEntities: "an integer in [1, 2000000]",
  targetFPS: "a number in [1, 300]",
  maxDeltaSeconds: "a finite number in (0, 10]",
  variant: '"light" | "physics2d" | "physics3d"',
  loop: '"internal" | "external"',
  physicsHz: "a finite number >= 0",
  maxCatchupSteps: "an integer >= 0",
  debug: "a boolean",
};

interface ReadOk {
  readonly ok: true;
  readonly value: unknown;
}

interface ReadFail {
  readonly ok: false;
  readonly circular: boolean;
}

function tryRead(read: () => unknown): ReadOk | ReadFail {
  try {
    return { ok: true, value: read() };
  } catch (error: unknown) {
    const circular =
      error instanceof TypeError &&
      typeof error.message === "string" &&
      error.message.includes("circular");
    return { ok: false, circular };
  }
}

function jsonText(value: unknown): string {
  const read = tryRead(() => JSON.stringify(value));
  if (!read.ok) return read.circular ? "[circular]" : "[unreadable]";
  if (typeof read.value !== "string") return "[unreadable]";
  return read.value;
}

function constructorName(value: object): string {
  const read = tryRead(() => {
    const ctor: unknown = Reflect.get(value, "constructor");
    if (typeof ctor !== "function") return "Object";
    const name: unknown = Reflect.get(ctor, "name");
    if (typeof name !== "string" || name.length === 0) return "Object";
    return name;
  });
  if (!read.ok || typeof read.value !== "string") return "Object";
  return read.value;
}

/**
 * Stable text for a rejected value.
 * Non-finite numbers and `-0` are spelled out. `JSON.stringify` would print them as `null` or `0`.
 */
export function formatReceived(value: unknown): string {
  if (value === undefined) return "undefined";
  const kind = typeof value;
  if (kind === "symbol") return "[symbol]";
  if (kind === "bigint") return "[bigint]";
  if (kind === "function") return "[function]";
  if (kind === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Number.POSITIVE_INFINITY) return "Infinity";
    if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
    if (Object.is(value, -0)) return "-0";
    return jsonText(value);
  }
  if (kind === "string" || kind === "boolean" || value === null) return jsonText(value);
  if (kind === "object") {
    const shape = tryRead(() => {
      if (Array.isArray(value)) return "array";
      const proto: object | null = Object.getPrototypeOf(value);
      if (proto === Object.prototype || proto === null) return "plain";
      return "exotic";
    });
    if (!shape.ok) return "[unreadable]";
    if (shape.value === "array" || shape.value === "plain") return jsonText(value);
    if (shape.value === "exotic") return `[object ${constructorName(value)}]`;
    return "[unreadable]";
  }
  return "[unreadable]";
}

function rule(field: EngineField, value: unknown): string | undefined {
  switch (field) {
    case "maxEntities":
      if (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 2_000_000
      ) {
        return undefined;
      }
      return EXPECTED.maxEntities;
    case "targetFPS":
      if (typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 300) {
        return undefined;
      }
      return EXPECTED.targetFPS;
    case "maxDeltaSeconds":
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 10) {
        return EXPECTED.maxDeltaSeconds;
      }
      return undefined;
    case "variant":
      if (value === "light" || value === "physics2d" || value === "physics3d") return undefined;
      return EXPECTED.variant;
    case "loop":
      if (value === "internal" || value === "external") return undefined;
      return EXPECTED.loop;
    case "physicsHz":
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return EXPECTED.physicsHz;
      }
      return undefined;
    case "maxCatchupSteps":
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        return EXPECTED.maxCatchupSteps;
      }
      return undefined;
    case "debug":
      if (typeof value !== "boolean") return EXPECTED.debug;
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Checks the eight engine fields. Other keys are ignored. `undefined` is skipped.
 * Issues follow field order: maxEntities, targetFPS, maxDeltaSeconds, variant,
 * loop, physicsHz, maxCatchupSteps, debug.
 *
 * @param input - Record to read. Only the eight engine fields are considered.
 * @param owner - Written on every issue. Default `@gwenjs/schema`.
 * @param prefix - Prepended to each field name (`"engine."` yields `engine.maxEntities`).
 */
export function checkEngineConfig(
  input: Readonly<Record<string, unknown>>,
  owner = "@gwenjs/schema",
  prefix = "",
): readonly GwenConfigIssue[] {
  const issues: GwenConfigIssue[] = [];
  for (const field of ENGINE_FIELDS) {
    const read = tryRead(() => input[field]);
    let expected: string | undefined;
    let received = "";
    if (!read.ok) {
      expected = EXPECTED[field];
      received = "[unreadable]";
    } else if (read.value === undefined) {
      continue;
    } else {
      expected = rule(field, read.value);
      if (expected === undefined) continue;
      received = formatReceived(read.value);
    }
    issues.push({
      path: `${prefix}${field}`,
      expected,
      received,
      owner,
    });
  }
  return issues;
}
