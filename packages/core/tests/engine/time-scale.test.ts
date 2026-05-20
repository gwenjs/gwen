import { describe, it, expect } from "vitest";
import { createEngine } from "../../src";
import { defineSystem, onUpdate } from "@gwenjs/core/system";

async function collectDt(timeScale: number, rawDt: number): Promise<number> {
  const engine = await createEngine();
  let received = -1;

  await engine.use(
    defineSystem(function collectDtSystem() {
      onUpdate((dt) => {
        received = dt;
      });
    })(),
  );
  await engine.startExternal();

  engine.timeScale = timeScale;
  await engine.advance(rawDt);

  return received;
}

describe("engine.timeScale", () => {
  it("defaults to 1", async () => {
    const engine = await createEngine();
    expect(engine.timeScale).toBe(1);
  });

  it("timeScale = 1 passes dt unchanged", async () => {
    const dt = await collectDt(1, 1 / 60);
    expect(dt).toBeCloseTo(1 / 60);
  });

  it("timeScale = 2 doubles dt", async () => {
    const dt = await collectDt(2, 1 / 60);
    expect(dt).toBeCloseTo((1 / 60) * 2);
  });

  it("timeScale = 0.5 halves dt", async () => {
    const dt = await collectDt(0.5, 1 / 60);
    expect(dt).toBeCloseTo((1 / 60) * 0.5);
  });

  it("timeScale = 0 results in dt = 0 (pause)", async () => {
    const dt = await collectDt(0, 1 / 60);
    expect(dt).toBe(0);
  });

  it("clamps negative timeScale to 0", async () => {
    const dt = await collectDt(-1, 1 / 60);
    expect(dt).toBe(0);
  });

  it("clamps timeScale above 100 to 100", async () => {
    // Use a small rawDt so maxDeltaSeconds cap does not interfere
    const dt = await collectDt(200, 0.0005);
    expect(dt).toBeCloseTo(0.0005 * 100);
  });

  it("timeScale is mutable at runtime", async () => {
    const engine = await createEngine();
    const received: number[] = [];

    await engine.use(
      defineSystem(function mutableSystem() {
        onUpdate((dt) => received.push(dt));
      })(),
    );
    await engine.startExternal();

    engine.timeScale = 1;
    await engine.advance(0.01);

    engine.timeScale = 0;
    await engine.advance(0.01);

    expect(received[0]).toBeCloseTo(0.01);
    expect(received[1]).toBe(0);
  });
});
