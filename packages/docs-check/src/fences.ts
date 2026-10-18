export interface Fence {
  file: string;
  /** 1-based line of the opening fence. */
  line: number;
  language: string;
  tag: "check" | "run" | null;
  code: string;
}

const OPEN = /^([ ]*)(`{3,}|~{3,})(.*)$/;

/**
 * Pull every fenced block out of a markdown document.
 * The indent of a fence inside a list is kept, then stripped from the body.
 */
export function extractFences(markdown: string, file: string): Fence[] {
  const lines = markdown.split(/\r?\n/);
  const fences: Fence[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const open = OPEN.exec(line);
    if (!open) {
      index += 1;
      continue;
    }
    const indent = open[1] ?? "";
    const marker = open[2] ?? "";
    const info = (open[3] ?? "").trim();
    if (marker.startsWith("`") && info.includes("`")) {
      index += 1;
      continue;
    }
    const tick = marker[0] === "~" ? "~" : "`";
    const body: string[] = [];
    let closedAt = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor] ?? "";
      if (isClose(candidate, indent.length, tick, marker.length)) {
        closedAt = cursor;
        break;
      }
      body.push(candidate.startsWith(indent) ? candidate.slice(indent.length) : candidate);
    }
    if (closedAt === -1) {
      index += 1;
      continue;
    }
    const parts = info.split(/\s+/).filter((part) => part.length > 0);
    const language = parts[0] ?? "";
    const second = parts[1] ?? "";
    const tagged = language === "ts" || language === "typescript";
    const tag = tagged && (second === "check" || second === "run") ? second : null;
    fences.push({
      file,
      line: index + 1,
      language,
      tag,
      code: body.join("\n"),
    });
    index = closedAt + 1;
  }
  return fences;
}

function isClose(line: string, indent: number, tick: string, min: number): boolean {
  const match = /^([ ]*)(`+|~+)\s*$/.exec(line);
  if (!match) return false;
  const spaces = match[1] ?? "";
  const marker = match[2] ?? "";
  return spaces.length <= indent && marker[0] === tick && marker.length >= min;
}
