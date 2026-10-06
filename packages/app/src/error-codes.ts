/** Codes thrown by `@gwenjs/app`. `MODULE_INVALID` keeps the kit prefix from #64. */
export const AppErrorCodes = {
  MODULE_SETUP_FAILED: "APP:MODULE_SETUP_FAILED",
  MODULE_LOAD_FAILED: "APP:MODULE_LOAD_FAILED",
  CONFIG_LOAD_FAILED: "APP:CONFIG_LOAD_FAILED",
  MODULE_INVALID: "KIT:MODULE_INVALID",
} as const;
