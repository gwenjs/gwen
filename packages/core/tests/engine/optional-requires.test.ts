import { afterEach, describe, expect, it } from "vitest";
import { createEngine, type GwenEngine } from "@gwenjs/core";
import { definePlugin } from "@gwenjs/kit/plugin";
import type { GwenEngineBase } from "@gwenjs/schema";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "p72:alpha": { readonly n: number };
  }
}

const engines: GwenEngine[] = [];

async function open(): Promise<GwenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

function install(
  engine: GwenEngine,
  name: string,
  setup: (host: GwenEngineBase) => void,
  requires?: { services?: readonly string[]; optional?: readonly string[] },
): Promise<void> {
  return engine.use(
    definePlugin(() => ({ name, setup, ...(requires === undefined ? {} : { requires }) }))(),
  );
}

describe("optional service requirements", () => {
  it("optional is absent and unuse of that provider fires service:removed", async () => {
    const engine = await open();
    let seen: unknown;
    let removed: unknown;
    await install(
      engine,
      "reader",
      (host) => {
        expect(host.tryInject("p72:alpha")).toBeUndefined();
        host.hooks.hook("service:provided", (event) => {
          if (event.key === "p72:alpha") seen = event.value;
        });
        host.hooks.hook("service:removed", (event) => {
          if (event.key === "p72:alpha") removed = event.value;
        });
      },
      { optional: ["p72:alpha"] },
    );
    const marker = { n: 3 };
    await install(engine, "provider", (host) => host.provide("p72:alpha", marker));
    expect(seen).toBe(marker);
    await engine.unuse("provider");
    expect(removed).toBe(marker);
    expect(engine.tryInject("p72:alpha")).toBeUndefined();
  });
  it("an empty optional list installs and a provide emits", async () => {
    const engine = await open();
    let provided = 0;
    engine.hooks.hook("service:provided", () => (provided += 1));
    await install(engine, "empty", (host) => host.provide("p72:alpha", { n: 1 }), {
      optional: [],
    });
    expect(provided).toBe(1);
  });
});
