/**
 * @file Module definition errors.
 *
 * Thrown by `defineGwenModule()` / `validateGwenModule()` when a definition
 * fails field checks. `fields` lists every failing path.
 */

import { GwenError } from "@gwenjs/schema";
import { KitErrorCodes } from "./error-codes.js";

/**
 * A module definition failed validation.
 *
 * `module` is `meta.name` when that is a non-empty string, otherwise the
 * caller's fallback or `"<anonymous>"`. `fields` keeps every failing path.
 */
export class GwenModuleDefinitionError extends GwenError {
  override readonly code: typeof KitErrorCodes.MODULE_INVALID;

  readonly module: string;

  readonly fields: readonly string[];

  constructor(module: string, fields: readonly string[]) {
    super(KitErrorCodes.MODULE_INVALID, `Module "${module}" is invalid: ${fields.join(", ")}.`, {
      composable: "defineGwenModule",
      hint: __GWEN_DEV__
        ? "Give the module a non-empty meta.name and a setup function, or build it with defineGwenModule from @gwenjs/kit."
        : undefined,
    });
    this.name = "GwenModuleDefinitionError";
    this.code = KitErrorCodes.MODULE_INVALID;
    this.module = module;
    this.fields = fields;
  }
}
