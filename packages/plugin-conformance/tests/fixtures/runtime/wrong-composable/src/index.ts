import { GwenContextError, GwenContextErrorCodes } from "@gwenjs/kit";

export function Plugin() {
  return { name: "wrong-composable", setup() {} };
}

export function useA(): never {
  throw new GwenContextError(GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT, "useB");
}
