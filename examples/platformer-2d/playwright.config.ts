import { defineConfig, devices } from "@playwright/test";

const desktopChrome = devices["Desktop Chrome"];
if (desktopChrome === undefined) throw new Error("Desktop Chrome device is absent");

export default defineConfig({
  testDir: "e2e",
  testMatch: ["**/smoke.spec.ts", "**/frame-time.pw.ts"],
  globalSetup: "./e2e/global-setup.ts",
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4180", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...desktopChrome } }],
});
