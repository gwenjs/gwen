/** Inlines a string `defineTint("red" | "green" | "blue")` call as its color number. */
import type { GwenCallSite, GwenSourceTransform, GwenTransformEdit } from "@gwenjs/kit/module";

function tintNumber(color: string): number | undefined {
  if (color === "red") return 16711680;
  if (color === "green") return 65280;
  if (color === "blue") return 255;
  return undefined;
}

function isTintCall(call: GwenCallSite): boolean {
  const binding = call.binding;
  if (binding === null) return false;
  return binding.source === "@example/tint" && binding.imported === "defineTint";
}

/** Build transform `tint:inline`. A dynamic argument is left as a runtime call. */
export const tintTransform: GwenSourceTransform = {
  name: "tint:inline",
  run(_program, ctx) {
    const edits: GwenTransformEdit[] = [];
    for (const call of ctx.calls()) {
      if (!isTintCall(call)) continue;
      const arg = call.arguments[0];
      if (arg === undefined || arg.kind === "other") continue;
      if (arg.kind !== "string") continue;
      const color = tintNumber(arg.value);
      if (color === undefined) {
        ctx.raise("TINT:UNKNOWN_COLOR", arg, `Unknown tint color "${arg.value}".`, {
          composable: "defineTint",
        });
      }
      edits.push({ kind: "overwrite", start: call.start, end: call.end, text: String(color) });
    }
    return edits;
  },
};
