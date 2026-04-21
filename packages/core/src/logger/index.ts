// New logger implementation (Tasks 4-7)
export { GwenLogger } from "./gwen-logger";
export { consoleLogProvider } from "./console-log-provider";

// Legacy logger (backwards compat)
export { createLogger } from "./console-logger";
export type { GwenLogger as LegacyGwenLogger, LogLevel, LogEntry } from "./types";
export type { IGwenLogger } from "@gwenjs/schema";
