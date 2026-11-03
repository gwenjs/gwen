import type { ConformanceFinding } from "./types.js";

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Order by file, line, code, then message. A finding without a file or line sorts first. */
export function compareFindings(left: ConformanceFinding, right: ConformanceFinding): number {
  const byFile = compareText(left.file ?? "", right.file ?? "");
  if (byFile !== 0) return byFile;
  const byLine = (left.line ?? 0) - (right.line ?? 0);
  if (byLine !== 0) return byLine;
  const byCode = compareText(left.code, right.code);
  if (byCode !== 0) return byCode;
  return compareText(left.message, right.message);
}
