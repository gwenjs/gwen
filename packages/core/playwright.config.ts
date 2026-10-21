import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests. They run the real WASM core in Chromium, Firefox and WebKit.
 * Files are named `*.pw.ts` so Vitest never collects them.
 * Run `pnpm test:browser`, which builds the fixture pages first.
 */
export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.pw.ts",
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4178" },
  webServer: {
    command: "node tests/browser/server.mjs",
    port: 4178,
    reuseExistingServer: false,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
