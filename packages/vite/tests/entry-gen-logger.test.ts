/**
 * Generated bootstrap passes the app logger into createEngine.
 */
import { describe, expect, it } from "vitest";
import { generateEntryModule } from "../src/entry-gen.js";

/** Argument text of the first createEngine(...) call. Empty when the call is absent. */
function createEngineArgument(source: string): string {
  const marker = "createEngine(";
  const open = source.indexOf(marker);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open + marker.length - 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + marker.length, index);
    }
  }
  return "";
}

describe("generateEntryModule logger", () => {
  it("the generated entry passes logger to createEngine and does not assign engine.logger", () => {
    const source = generateEntryModule(false);
    const argument = createEngineArgument(source);
    expect([
      source.includes("engine.logger ="),
      argument.includes("logger: gwenConfig.logger"),
    ]).toEqual([false, true]);
  });
});
