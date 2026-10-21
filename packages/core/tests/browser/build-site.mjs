// Bundle the fixture entries into tests/browser/site/<page>/entry.js (gitignored).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { gwenSourceAliases } from "../../../../vitest.aliases.ts";

const here = dirname(fileURLToPath(import.meta.url));

for (const page of ["csp", "quote"]) {
  await build({
    configFile: false,
    logLevel: "warn",
    resolve: { alias: gwenSourceAliases() },
    define: { __GWEN_DEV__: "true" },
    build: {
      outDir: resolve(here, "site", page),
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: resolve(here, "fixtures", `${page}-entry.ts`),
        formats: ["es"],
        fileName: () => "entry.js",
      },
      // The page has no import map. CSP would block one. Ship one file.
      rollupOptions: {
        external: [],
        output: { codeSplitting: false },
      },
    },
  });
}
