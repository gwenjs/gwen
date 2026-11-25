import { gwen } from "@gwenjs/vite";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The dev entry tag that Vite needs in the source HTML to emit the entry chunk. */
const ENTRY_TAG = '<script type="module" src="/@gwenjs/gwen-entry"></script>';
const HTML = `<!doctype html>\n<html>\n  <body>\n    ${ENTRY_TAG}\n  </body>\n</html>\n`;

/**
 * Vite config of one example. It mirrors the external CLI: no config file, the root is the
 * example directory, the input is the generated `.gwen/index.html`, and there is no COOP/COEP.
 *
 * @param {string} exampleDir Absolute path of the example directory.
 */
export function harnessConfig(exampleDir) {
  const html = path.join(exampleDir, ".gwen", "index.html");
  mkdirSync(path.dirname(html), { recursive: true });
  writeFileSync(html, HTML);
  return {
    root: exampleDir,
    configFile: false,
    logLevel: "info",
    plugins: [
      gwen({ optimizer: true }),
      {
        // The entry chunk is injected into <head>: the source tag is left behind in <body>
        // and would 404 in the browser, so the build output drops it.
        name: "example-harness:strip-entry-tag",
        apply: "build",
        transformIndexHtml: {
          order: "post",
          handler: (/** @type {string} */ output) => output.replace(ENTRY_TAG, ""),
        },
      },
    ],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: { input: { index: html } },
    },
  };
}
