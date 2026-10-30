import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REQUIRED_PAGES = ["csp", "quote", "light", "isolated"];

const browserDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "browser");

// Importing build-site.mjs runs the Vite build. Parse the page list as text.
function bundledPages(source: string): string[] {
  const match = /for \(const page of \[([^\]]*)\]\)/.exec(source);
  const body = match?.[1];
  if (body === undefined) return [];
  const names: string[] = [];
  for (const hit of body.matchAll(/"([^"]+)"/g)) {
    const name = hit[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

function sitePages(): string[] {
  const site = path.join(browserDir, "site");
  return readdirSync(site, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(site, name, "index.html")))
    .sort();
}

function hasInlineScript(html: string): boolean {
  const tags = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi);
  if (tags === null) return false;
  return tags.some((tag) => {
    const open = /^<script\b([^>]*)>/i.exec(tag);
    if (!/\bsrc\s*=/.test(open?.[1] ?? "")) return true;
    const start = open?.[0]?.length ?? 0;
    return tag.slice(start, tag.length - "</script>".length).trim() !== "";
  });
}

describe("browser fixture pages", () => {
  it("every site page is bundled by build-site.mjs and has a fixture entry", () => {
    const listed = bundledPages(readFileSync(path.join(browserDir, "build-site.mjs"), "utf8"));
    const problems: string[] = [];
    for (const page of REQUIRED_PAGES) {
      const htmlPath = path.join(browserDir, "site", page, "index.html");
      if (!existsSync(htmlPath)) problems.push(`${page}: required page has no index.html`);
    }
    for (const page of sitePages()) {
      if (!listed.includes(page)) problems.push(`${page}: not bundled by build-site.mjs`);
      const fixture = path.join(browserDir, "fixtures", `${page}-entry.ts`);
      if (!existsSync(fixture)) problems.push(`${page}: missing fixtures/${page}-entry.ts`);
      const html = readFileSync(path.join(browserDir, "site", page, "index.html"), "utf8");
      if (!html.includes('src="./entry.js"')) {
        problems.push(`${page}: index.html does not load ./entry.js`);
      }
      if (hasInlineScript(html)) problems.push(`${page}: index.html has an inline script`);
    }
    for (const page of listed) {
      const htmlPath = path.join(browserDir, "site", page, "index.html");
      if (!existsSync(htmlPath)) problems.push(`${page}: listed but has no index.html`);
    }
    problems.sort();
    expect(problems).toEqual([]);
  });

  it("the page list parser reads the real file", () => {
    const listed = bundledPages(readFileSync(path.join(browserDir, "build-site.mjs"), "utf8"));
    const missing = REQUIRED_PAGES.filter((page) => !listed.includes(page));
    expect(missing).toEqual([]);
  });
});
