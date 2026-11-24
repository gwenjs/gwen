import "fixture-base/extension";
import type { GwenProvides, GwenRuntimeHooks, GwenPluginRegistry } from "@gwenjs/schema";

export type Service = GwenProvides["fixture-base:extension"];
export type ReadyHook = GwenRuntimeHooks["fixture-base:ready"];
export type BasePlugin = GwenPluginRegistry["fixture-base"];
