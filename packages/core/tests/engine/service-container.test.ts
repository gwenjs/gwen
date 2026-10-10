/**
 * ServiceContainer without an engine.
 * Each test stores a real logger and reads it back.
 */

import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/logger/index";
import { GwenPluginNotFoundError } from "../../src/engine/engine-errors";
import { GwenError } from "@gwenjs/schema";
import { ServiceContainer } from "../../src/engine/service-container";

describe("ServiceContainer", () => {
  it("constructs without createEngine and provide then inject returns that logger", () => {
    const container = new ServiceContainer({
      assertState() {},
    });
    const logger = createLogger("svc", false);

    container.provide("logger", logger);

    expect(container.inject("logger")).toBe(logger);
  });

  it("constructs without createEngine and a second provide replaces the logger", () => {
    const container = new ServiceContainer({
      assertState() {},
    });
    const first = createLogger("svc-a", false);
    const second = createLogger("svc-b", false);
    container.provide("logger", first);

    container.provide("logger", second);

    expect(container.inject("logger")).toBe(second);
  });

  it("constructs without createEngine and inject of an absent key throws plugin not found", () => {
    const container = new ServiceContainer({
      assertState() {},
    });

    let caught: unknown;
    try {
      container.inject("logger");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GwenPluginNotFoundError);
    if (!(caught instanceof GwenPluginNotFoundError)) throw caught;
    expect(caught.code).toBe("GWEN_PLUGIN_NOT_FOUND");
    expect(caught.pluginName).toBe("logger");
    expect(caught.hint).toBe("Call engine.use(loggerPlugin()) before using this service.");
    expect(caught.docsUrl).toBe("https://gwenengine.dev/docs/plugins");
    expect(caught.message).toBe(
      '[GwenEngine] Plugin/service "logger" not found. Call engine.use(loggerPlugin()) before using this service.',
    );
  });

  it("constructs without createEngine and tryInject of an absent key returns undefined", () => {
    const container = new ServiceContainer({
      assertState() {},
    });

    expect(container.tryInject("logger")).toBeUndefined();
  });

  it("constructs without createEngine and tryInject returns the provided logger", () => {
    const container = new ServiceContainer({
      assertState() {},
    });
    const logger = createLogger("svc", false);

    container.provide("logger", logger);

    expect(container.tryInject("logger")).toBe(logger);
  });

  it("constructs without createEngine and provide while faulted does not store the logger", () => {
    const gate = new GwenError(
      "CORE:INVALID_STATE_TRANSITION",
      "[GwenEngine] provide() is not allowed while the engine is faulted.",
    );
    const container = new ServiceContainer({
      assertState() {
        throw gate;
      },
    });
    const logger = createLogger("svc", false);

    let caught: unknown;
    try {
      container.provide("logger", logger);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(gate);
    expect(container.tryInject("logger")).toBeUndefined();
  });

  it("constructs without createEngine and a second container does not see the first logger", () => {
    const first = new ServiceContainer({
      assertState() {},
    });
    const second = new ServiceContainer({
      assertState() {},
    });
    const logger = createLogger("svc", false);
    first.provide("logger", logger);

    expect(second.tryInject("logger")).toBeUndefined();
    expect(first.inject("logger")).toBe(logger);
  });
});
