import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const PHRASES = [
  "zero-alloc",
  "zero allocation",
  "zero overhead",
  "no allocations",
  "near-zero cost",
  "allocation-free",
];

const ALWAYS = new Set([
  "ms",
  "µs",
  "μs",
  "us",
  "ns",
  "fps",
  "entities",
  "bodies",
  "calls",
  "bytes",
  "kb",
  "mb",
]);

const PERCENT_AFTER = new Set(["faster", "slower", "less", "more", "overhead", "saving"]);
const X_WITH = new Set(["faster", "slower", "speedup"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCiBench(entry: unknown): entry is { file: string } {
  if (!isRecord(entry)) return false;
  return typeof entry["file"] === "string";
}

function benchFiles(): readonly string[] {
  const file = path.join(repoRoot, "packages/docs-check/ci-benches.json");
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) return [];
  const files: string[] = [];
  for (const entry of parsed) {
    if (!isCiBench(entry)) continue;
    files.push(entry.file);
  }
  return files;
}

function walkMarkdown(dir: string, out: string[], skipFr: boolean): void {
  for (const name of readdirSync(dir)) {
    if (name === "superpowers" || name === "node_modules" || name === ".vitepress") continue;
    if (skipFr && name === "fr") continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkMarkdown(full, out, skipFr);
    else if (name.endsWith(".md")) out.push(full);
  }
}

function proseFiles(): string[] {
  const out: string[] = [];
  walkMarkdown(path.join(repoRoot, "docs"), out, true);
  const rootReadme = path.join(repoRoot, "README.md");
  if (existsSync(rootReadme)) out.push(rootReadme);
  out.push(path.join(repoRoot, "CLAUDE.md"));
  const packages = path.join(repoRoot, "packages");
  for (const name of readdirSync(packages)) {
    const readme = path.join(packages, name, "README.md");
    if (existsSync(readme)) out.push(readme);
  }
  return out;
}

function stripFences(markdown: string): string[] {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = /^([ ]*)(`{3,}|~{3,})(.*)$/.exec(lines[i] ?? "");
    if (!open) {
      out.push(lines[i] ?? "");
      i += 1;
      continue;
    }
    const indent = open[1] ?? "";
    const marker = open[2] ?? "";
    const tick = marker[0] ?? "`";
    out.push("");
    i += 1;
    while (i < lines.length) {
      const line = lines[i] ?? "";
      const close = /^([ ]*)(`+|~+)\s*$/.exec(line);
      if (
        close &&
        (close[1] ?? "").length <= indent.length &&
        (close[2] ?? "")[0] === tick &&
        (close[2] ?? "").length >= marker.length
      ) {
        out.push("");
        i += 1;
        break;
      }
      out.push("");
      i += 1;
    }
  }
  return out;
}

function stripInline(text: string): string {
  return text.replace(/``[^`]*``/g, " ").replace(/`[^`\n]*`/g, " ");
}

function linksOf(text: string): { visible: string; hrefs: string[] } {
  const hrefs: string[] = [];
  const visible = text.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_all, label: string, href: string) => {
    hrefs.push(href);
    return label;
  });
  return { visible, hrefs };
}

function linksBench(hrefs: readonly string[], files: readonly string[]): boolean {
  return hrefs.some((href) => {
    const clean = href.split("#")[0]?.split("?")[0] ?? "";
    return files.some((file) => {
      const parts = file.split("/").filter((part) => part.length > 0);
      return parts.some((_part, index) => clean.includes(parts.slice(index).join("/")));
    });
  });
}

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

function bare(word: string): string {
  return word.replace(/^[^\p{L}\p{N}µμ%×_]+|[^\p{L}\p{N}µμ%×_]+$/gu, "");
}

function numberClaims(text: string): string[] {
  const words = wordsOf(text);
  const hits: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const raw = words[i] ?? "";
    if (/^\d+\.$/.test(raw)) continue;
    const token = bare(raw);
    const match = /^(\d+(?:_\d+)*(?:[.,]\d+)?)(.*)$/.exec(token);
    if (!match) continue;
    const look: string[] = [];
    const glued = (match[2] ?? "").replace(/^[_.,:;]+/, "");
    if (glued.length > 0) look.push(glued);
    for (let k = 1; look.length < 3 && i + k < words.length; k += 1) {
      const next = bare(words[i + k] ?? "");
      if (next.length > 0) look.push(next);
    }
    for (let j = 0; j < look.length; j += 1) {
      const unit = (look[j] ?? "").toLowerCase();
      const head = unit.replace(/[.,:;].*$/, "");
      if (ALWAYS.has(head)) {
        hits.push(`${match[1] ?? ""} ${head}`);
        break;
      }
      if (head === "%" || head === "percent") {
        const after = look.slice(j + 1).map((item) => item.toLowerCase().replace(/[.,:;].*$/, ""));
        if (after.some((item) => PERCENT_AFTER.has(item))) hits.push(`${match[1] ?? ""} %`);
        break;
      }
      if (head === "x" || head === "×") {
        const around = look.map((item) => item.toLowerCase().replace(/[.,:;].*$/, ""));
        if (around.some((item) => X_WITH.has(item))) hits.push(`${match[1] ?? ""} ${head}`);
        break;
      }
    }
  }
  return hits;
}

function phraseClaims(text: string): string[] {
  const lower = text.toLowerCase();
  return PHRASES.filter((phrase) => lower.includes(phrase));
}

function isOptionTable(header: string): boolean {
  const cells = stripInline(header)
    .split("|")
    .map((cell) => cell.trim().toLowerCase());
  return cells.some((cell) =>
    /^(option|options|default|defaults|type|param|parameter|field|config|configuration)$/.test(
      cell,
    ),
  );
}

interface Unit {
  line: number;
  text: string;
}

function units(lines: readonly string[]): Unit[] {
  const blocks: Unit[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[] = [];
      const start = i;
      while (i < lines.length && /^\s*\|/.test(lines[i] ?? "")) {
        rows.push(lines[i] ?? "");
        i += 1;
      }
      if (!isOptionTable(rows[0] ?? "")) {
        for (let r = 0; r < rows.length; r += 1) {
          if (/^\s*\|?\s*:?-{3,}/.test(rows[r] ?? "")) continue;
          blocks.push({ line: start + r + 1, text: rows[r] ?? "" });
        }
      }
      continue;
    }
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      const start = i;
      const chunk = [line];
      i += 1;
      while (
        i < lines.length &&
        (lines[i] ?? "").trim() !== "" &&
        !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i] ?? "") &&
        !/^\s*\|/.test(lines[i] ?? "")
      ) {
        chunk.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push({ line: start + 1, text: chunk.join(" ") });
      continue;
    }
    const start = i;
    const chunk = [line];
    i += 1;
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i] ?? "") &&
      !/^\s*\|/.test(lines[i] ?? "") &&
      !/^#{1,6}\s/.test(lines[i] ?? "")
    ) {
      chunk.push(lines[i] ?? "");
      i += 1;
    }
    blocks.push({ line: start + 1, text: chunk.join(" ") });
  }
  return blocks;
}

/** Unlinked performance claims. One line is `file:line` plus the number or phrase. */
export function unlinkedPerformanceClaims(): string[] {
  const files = benchFiles();
  const hits: string[] = [];
  for (const file of proseFiles()) {
    const lines = stripFences(readFileSync(file, "utf8"));
    for (const block of units(lines)) {
      const { visible, hrefs } = linksOf(stripInline(block.text));
      const numbers = numberClaims(visible);
      const phrases = phraseClaims(visible);
      if (numbers.length === 0 && phrases.length === 0) continue;
      if (linksBench(hrefs, files)) continue;
      const detail = [...numbers, ...phrases].join(", ");
      hits.push(`${path.relative(repoRoot, file)}:${block.line} ${detail}`);
    }
  }
  return hits;
}

describe("performance claims", () => {
  it("every performance claim links a file in ci-benches.json", () => {
    expect(unlinkedPerformanceClaims()).toEqual([]);
  });
});
