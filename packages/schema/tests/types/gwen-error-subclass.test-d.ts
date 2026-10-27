import { describe, expectTypeOf, it } from "vitest";
import { GwenError } from "@gwenjs/schema";

class AudioPluginError extends GwenError {
  constructor(message: string) {
    super("AUDIO:ERROR", message);
    this.name = "AudioPluginError";
  }
}

describe("GwenError subclass", () => {
  it("a two-argument GwenError subclass still compiles", () => {
    const error = new AudioPluginError("Boom.");
    expectTypeOf(error).toEqualTypeOf<AudioPluginError>();
    expectTypeOf(error).toMatchTypeOf<GwenError>();
  });
});
