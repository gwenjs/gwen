import { GwenContextErrorCodes } from "@gwenjs/kit";
import { contextRowNames } from "../composable-surface.js";
import { ConformanceErrorCodes } from "../error-codes.js";
import { isRecord } from "../json.js";
import type { ConformanceFinding } from "../types.js";
import { thrownCode } from "./call-factory.js";
import type { RuntimeCheckContext } from "./types.js";

const CONTEXT_CODES: ReadonlySet<string> = new Set(Object.values(GwenContextErrorCodes));

const COMPOSABLE_HINT = "Throw that error from the export, with composable set to its name.";

function composableFinding(message: string): ConformanceFinding {
  return {
    code: ConformanceErrorCodes.RUNTIME_COMPOSABLE_CONTEXT,
    message,
    hint: COMPOSABLE_HINT,
  };
}

/** `code` is one of `GwenContextErrorCodes` (`packages/kit/src/context-errors.ts:14`). */
function isContextError(error: unknown): boolean {
  const code = thrownCode(error);
  return code !== undefined && CONTEXT_CODES.has(code);
}

/** `composable` on the thrown value (`packages/kit/src/context-errors.ts:103`). */
function composableName(error: unknown): unknown {
  if (!isRecord(error)) return undefined;
  return error.composable;
}

/**
 * Call `fn` with no arguments.
 * A context error whose `composable` equals `name` passes.
 * Any other outcome is one finding.
 */
function outsideContext(name: string, fn: () => unknown): ConformanceFinding | undefined {
  try {
    fn();
  } catch (error: unknown) {
    if (isContextError(error)) {
      const composable = composableName(error);
      if (composable !== name) {
        return composableFinding(
          `export ${JSON.stringify(name)} threw a context error whose composable is ${JSON.stringify(composable)}`,
        );
      }
      return undefined;
    }
  }
  return composableFinding(`export ${JSON.stringify(name)} did not throw a context error`);
}

/** R12. Each `use*` / `on*` function export of the built root entry. Zero names passes. */
export async function checkComposable(context: RuntimeCheckContext): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  for (const name of contextRowNames(context.entry)) {
    const exported: unknown = context.entry[name];
    if (typeof exported !== "function") continue;
    const problem = outsideContext(name, () => {
      exported();
    });
    if (problem !== undefined) findings.push(problem);
  }
  return findings;
}
