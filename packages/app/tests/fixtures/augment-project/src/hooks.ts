import { defineHooks } from "@gwenjs/core";

export const fixtureHooks = defineHooks({
  "game:over": (_score: number) => {},
});

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "fixture:svc": { n: number };
  }
  interface GwenModuleOptions {
    fixture?: { level: number };
  }
}
