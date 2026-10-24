import { describe, expect, it } from "vitest";
import {
  assertModuleFirstInput,
  defaultOptions,
  GwenError,
  validateResolvedConfig,
  type GwenOptions,
} from "../src/index.js";

const SEE = /\nSee https:\/\/gwenjs\.github\.io\/gwen\/api\/errors#schema-/;

function withEngine(patch: Record<string, unknown>): GwenOptions {
  const engine: GwenOptions["engine"] = { ...defaultOptions.engine };
  Object.assign(engine, patch);
  return { ...defaultOptions, engine };
}

function withField(key: string, value: unknown): GwenOptions {
  const config: GwenOptions = { ...defaultOptions };
  Object.assign(config, { [key]: value });
  return config;
}

const cases: ReadonlyArray<readonly [string, () => void]> = [
  ["legacy plugins", () => assertModuleFirstInput({ plugins: [{ name: "legacy" }] })],
  ["maxEntities", () => validateResolvedConfig(withEngine({ maxEntities: 50 }))],
  ["targetFPS", () => validateResolvedConfig(withEngine({ targetFPS: 500 }))],
  ["loop", () => validateResolvedConfig(withEngine({ loop: "manual" }))],
  ["maxDelta", () => validateResolvedConfig(withEngine({ maxDeltaSeconds: 0 }))],
  [
    "background",
    () => validateResolvedConfig(withField("html", { ...defaultOptions.html, background: "red" })),
  ],
  ["modules", () => validateResolvedConfig(withField("modules", "nope"))],
  [
    "bad tuple",
    () => validateResolvedConfig(withField("modules", [["@gwenjs/input", "invalid-options"]])),
  ],
  ["plugins", () => validateResolvedConfig(withField("plugins", { name: "x" }))],
];

describe("schema validation messages", () => {
  it("an invalid targetFPS renders [GWEN] what and the See line", () => {
    let caught: unknown;
    try {
      validateResolvedConfig(withEngine({ targetFPS: 500 }));
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) return;
    const lines = caught.message.split("\n");
    expect(lines[0]).toBe("[GWEN] targetFPS must be between 30 and 240.");
    expect(lines.length).toBe(__GWEN_DEV__ ? 3 : 2);
    if (__GWEN_DEV__) expect(lines[1]).toBe("Fix: Set targetFPS to a value from 30 to 240.");
    expect(lines[lines.length - 1]).toMatch(/\(SCHEMA:INVALID_CONFIG\)$/);
  });

  it.each(cases)("every schema validation error ends with the See line (%s)", (_name, run) => {
    expect(run).toThrow(SEE);
  });
});
