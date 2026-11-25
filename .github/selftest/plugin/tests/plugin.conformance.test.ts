import { describePluginConformance } from "@gwenjs/plugin-conformance/vitest";

describePluginConformance({ packageName: "@selftest/plugin", factories: [{ export: "SelftestPlugin" }] });
