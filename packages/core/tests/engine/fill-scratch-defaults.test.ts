import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createEngine, defineComponent, Types } from "../../src/index.js";

const entitiesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/engine/engine-entities.ts",
);

const CAST_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.TypeAssertionExpression,
  ts.SyntaxKind.NonNullExpression,
]);

function fillScratchBody(source: ts.SourceFile): ts.Node {
  const bodies: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "fillScratch" &&
      node.body !== undefined
    ) {
      bodies.push(node.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const body = bodies[0];
  if (bodies.length !== 1 || body === undefined) {
    throw new Error(`expected one fillScratch method, found ${bodies.length}`);
  }
  return body;
}

/** Line sites of `as`, `<T>expr`, and `expr!` inside the fillScratch body. */
function castSites(body: ts.Node, source: ts.SourceFile): string[] {
  const sites: string[] = [];
  const visit = (node: ts.Node): void => {
    if (CAST_KINDS.has(node.kind)) {
      const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
      sites.push(
        `${pos.line + 1}:${pos.character + 1} ${ts.SyntaxKind[node.kind]} ${node.getText(source)}`,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return sites;
}

/**
 * `exactOptionalPropertyTypes` rejects an explicit `undefined` field.
 * The own property is attached at runtime so `addComponent` still receives it.
 */
function withUndefined<T extends object>(base: T, key: string): T {
  Object.defineProperty(base, key, {
    value: undefined,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return base;
}

const Marker = defineComponent({
  name: "FillScratchMarker240",
  schema: { kept: Types.f32, missing: Types.f32, blank: Types.f32 },
  defaults: { kept: 1, missing: 9, blank: 4 },
});

describe("fillScratch", () => {
  it("applies schema defaults for a missing key and an undefined value", async () => {
    const engine = await createEngine({ maxEntities: 4 });
    try {
      const partial = engine.createEntity();
      const empty = engine.createEntity();
      const zero = engine.createEntity();
      engine.addComponent(partial, Marker, withUndefined({ kept: 77 }, "blank"));
      engine.addComponent(empty, Marker, {});
      engine.addComponent(zero, Marker, { kept: 0, missing: 0, blank: 0 });

      expect(engine.getComponent(partial, Marker)).toEqual({
        kept: 77,
        missing: 9,
        blank: 4,
      });
      expect(engine.getComponent(empty, Marker)).toEqual({
        kept: 1,
        missing: 9,
        blank: 4,
      });
      expect(engine.getComponent(zero, Marker)).toEqual({
        kept: 0,
        missing: 0,
        blank: 0,
      });
    } finally {
      await engine.stop();
    }
  });

  it("fillScratch contains no cast", () => {
    const source = ts.createSourceFile(
      entitiesPath,
      readFileSync(entitiesPath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(castSites(fillScratchBody(source), source)).toEqual([]);
  });
});
