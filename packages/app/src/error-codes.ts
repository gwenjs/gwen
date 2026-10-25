import { GwenError } from "@gwenjs/schema";
import { KitErrorCodes } from "@gwenjs/kit";

/** Codes thrown by `@gwenjs/app`. `MODULE_INVALID` keeps the kit prefix from #64. */
export const AppErrorCodes = {
  MODULE_SETUP_FAILED: "APP:MODULE_SETUP_FAILED",
  MODULE_LOAD_FAILED: "APP:MODULE_LOAD_FAILED",
  CONFIG_LOAD_FAILED: "APP:CONFIG_LOAD_FAILED",
  MODULE_INVALID: KitErrorCodes.MODULE_INVALID,
} as const;

/** First line of a GwenError, leading tag removed, final period unless it already ends with `.`, `?` or `!`. */
export function causeText(cause: unknown): string {
  const raw =
    cause instanceof GwenError
      ? (cause.message.split("\n")[0] ?? cause.code).replace(/^\[[^\]]*\] /, "") || cause.code
      : cause instanceof Error
        ? cause.message
        : String(cause);
  return /[.?!]$/.test(raw) ? raw : `${raw}.`;
}
