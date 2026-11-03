import { publint } from "publint";
import { formatMessage } from "publint/utils";
import { ConformanceErrorCodes } from "./error-codes.js";
import { indexJson, isRecord } from "./json.js";
import type { PackageContext } from "./package-context.js";
import type { ConformanceFinding } from "./types.js";

const OUTPUT_MARK = "Command output:";

function firstLine(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

/**
 * The reason of a publint failure. publint opens a pack failure with a header that carries a
 * random temp path (`Failed to find packed tarball file in <path>. Command output:`), then prints
 * the output of the pack command as JSON; the reason is the first line of its stderr.
 */
function failureReason(text: string): string {
  const mark = text.indexOf(OUTPUT_MARK);
  if (mark >= 0) {
    try {
      const output: unknown = JSON.parse(text.slice(mark + OUTPUT_MARK.length));
      const detail = isRecord(output)
        ? (firstLine(output.stderr) ?? firstLine(output.stdout))
        : undefined;
      if (detail !== undefined) return detail;
    } catch {
      // Not JSON: fall back to the header, without its path.
    }
  }
  const head = firstLine(text) ?? text;
  return head.replace(/ in \S+\. Command output:$/, "");
}

/** `publint --strict`: every message of `publint` with warnings raised to errors. */
export async function checkPublint(
  context: PackageContext,
): Promise<readonly ConformanceFinding[]> {
  const index = indexJson(context.text);
  let result: Awaited<ReturnType<typeof publint>>;
  try {
    result = await publint({ pkgDir: context.root, strict: true, level: "error", pack: "npm" });
  } catch (error) {
    // publint throws when it cannot pack or parse the package; that is a finding, not a crash.
    const text = error instanceof Error ? error.message : String(error);
    return [
      {
        code: ConformanceErrorCodes.PUBLINT,
        message: `publint failed: ${failureReason(text)}`,
        hint: "Run publint --strict in the package to see why.",
        file: "package.json",
        line: 1,
      },
    ];
  }
  return result.messages.map((message) => ({
    code: ConformanceErrorCodes.PUBLINT,
    message: formatMessage(message, result.pkg, { color: false }) ?? message.code,
    hint: "Fix the package.json field named in the message, then run publint --strict.",
    file: "package.json",
    line: index.keyLine(message.path) ?? index.valueLine(message.path) ?? 1,
  }));
}
