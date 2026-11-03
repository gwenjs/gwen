import { GwenContextError, GwenContextErrorCodes } from "@gwenjs/kit";
import { describe, expect, it } from "vitest";
import { runComposableSurfaceSuite } from "@gwenjs/plugin-conformance";
import { contextRowNames, prefixViolations, thrownBy } from "../src/composable-surface.js";
import { registerComposableSurface } from "../src/run-composable-surface-suite.js";

function outside(composable: string): never {
  throw new GwenContextError(GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT, composable);
}

class Pool {}

const MIXED = {
  defineThing: () => undefined,
  useThing: () => undefined,
  onThing: () => undefined,
  createThing: () => undefined,
  fetchThing: () => undefined,
  add_x: () => undefined,
  usething: () => undefined,
  Pool,
  VERSION: "1.0.0",
  table: { useNotAFunction: 1 },
};

interface Row {
  name: string;
  body: () => void;
}

/** Runs the registration against a recording `describe`/`it` pair. */
function record(entry: Record<string, unknown>, options: { allow?: readonly string[] } = {}) {
  const suites: string[] = [];
  const rows: Row[] = [];
  registerComposableSurface(entry, options, {
    describe: (name, body) => {
      suites.push(name);
      body();
    },
    it: (name, body) => {
      rows.push({ name, body });
    },
  });
  return { suites, rows };
}

/** The message a row body throws, or `undefined` when the row passes. */
function failureOf(row: Row | undefined): string | undefined {
  if (row === undefined) return "row is not registered";
  try {
    row.body();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function rowNamed(rows: readonly Row[], name: string): Row | undefined {
  return rows.find((row) => row.name === name);
}

describe("prefixViolations", () => {
  it("lists fetchThing and add_x, skips classes and non-functions", () => {
    expect(prefixViolations(MIXED, [])).toEqual(["add_x", "fetchThing", "usething"]);
  });

  it("honours allow", () => {
    expect(prefixViolations(MIXED, ["fetchThing", "add_x"])).toEqual(["usething"]);
  });

  it("reports an allow entry that is not a function export as stale", () => {
    const violations = prefixViolations(MIXED, ["fetchThing", "add_x", "usething", "Pool", "gone"]);
    expect(violations).toEqual(['allow entry "Pool" is stale', 'allow entry "gone" is stale']);
  });
});

describe("contextRowNames", () => {
  it("returns only the use* and on* function exports", () => {
    expect(contextRowNames(MIXED)).toEqual(["onThing", "useThing"]);
  });
});

describe("thrownBy", () => {
  it("tells a return, a plain Error and a GwenContextError apart", () => {
    expect([
      thrownBy(() => null),
      thrownBy(() => {
        throw new Error("plain");
      }),
      thrownBy(() => outside("useThing")),
    ]).toEqual(["returned", "other", "context-error"]);
  });
});

describe("registerComposableSurface", () => {
  it("registers the prefix row and one throw row per use*/on* export, and they pass", () => {
    const { suites, rows } = record({
      defineThing: () => undefined,
      useThing: () => outside("useThing"),
      onThing: () => outside("onThing"),
    });
    expect(suites).toEqual(["composable surface"]);
    expect(rows.map((row) => row.name)).toEqual([
      "every function export matches a prefix rule",
      "onThing outside any context throws GwenContextError",
      "useThing outside any context throws GwenContextError",
    ]);
    expect(rows.map((row) => failureOf(row))).toEqual([undefined, undefined, undefined]);
  });

  it("fails the throw row of a useFoo that returns null outside a context", () => {
    const { rows } = record({ useFoo: () => null });
    const message = failureOf(rowNamed(rows, "useFoo outside any context throws GwenContextError"));
    expect(message).toContain("returned");
  });

  it("fails the throw row of a useFoo that throws a plain Error", () => {
    const { rows } = record({
      useFoo: () => {
        throw new Error("not a context error");
      },
    });
    const message = failureOf(rowNamed(rows, "useFoo outside any context throws GwenContextError"));
    expect(message).toContain("not a GwenContextError");
  });

  it("passes the throw row of a useFoo that throws a GwenContextError", () => {
    const { rows } = record({ useFoo: () => outside("useFoo") });
    expect(failureOf(rowNamed(rows, "useFoo outside any context throws GwenContextError"))).toBe(
      undefined,
    );
  });

  it("fails the prefix row on a fetchX export and names it", () => {
    const { rows } = record({ fetchX: () => undefined });
    const message = failureOf(rowNamed(rows, "every function export matches a prefix rule"));
    expect(message).toContain("fetchX");
  });

  it("lets allow exempt a name and fails the prefix row on a stale allow entry", () => {
    const exempt = record({ fetchX: () => undefined }, { allow: ["fetchX"] });
    expect(failureOf(rowNamed(exempt.rows, "every function export matches a prefix rule"))).toBe(
      undefined,
    );
    const stale = record({ useX: () => outside("useX") }, { allow: ["fetchX"] });
    expect(
      failureOf(rowNamed(stale.rows, "every function export matches a prefix rule")),
    ).toContain("fetchX");
  });
});

describe("runComposableSurfaceSuite", () => {
  runComposableSurfaceSuite(
    {
      defineThing: () => undefined,
      useThing: () => outside("useThing"),
      onThing: () => outside("onThing"),
      fetchThing: () => undefined,
      Pool,
    },
    { allow: ["fetchThing"] },
  );
});
