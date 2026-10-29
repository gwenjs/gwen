import { GwenError, type GwenConfigIssue } from "@gwenjs/schema";
import { AppErrorCodes } from "./error-codes";

/** Field-level config error. `code` is `APP:CONFIG_CONFLICT` when any issue sets `conflictsWith`. */
export class GwenAppConfigError extends GwenError {
  readonly configFile: string;
  readonly issues: readonly GwenConfigIssue[];
  declare readonly code: typeof AppErrorCodes.CONFIG_INVALID | typeof AppErrorCodes.CONFIG_CONFLICT;

  constructor(configFile: string, issues: readonly GwenConfigIssue[]) {
    const code = issues.some((issue) => issue.conflictsWith !== undefined)
      ? AppErrorCodes.CONFIG_CONFLICT
      : AppErrorCodes.CONFIG_INVALID;
    const lines = [`Invalid gwen.config (${configFile}):`];
    for (const issue of issues) {
      const conflict =
        issue.conflictsWith === undefined ? "" : ` (conflicts with ${issue.conflictsWith})`;
      lines.push(
        `"${issue.path}" expected ${issue.expected}, received ${issue.received}${conflict}`,
      );
    }
    super(code, lines.join("\n"));
    this.name = "GwenAppConfigError";
    this.configFile = configFile;
    this.issues = issues;
    this.code = code;
  }
}
