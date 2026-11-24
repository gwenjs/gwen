/**
 * `gwen:bvh-prebake` rewrites the arguments of `useMeshCollider` when arg 0 is a
 * relative `.glb` literal (`./` or `../`). The callee text stays. One bake per
 * distinct content and mesh name during a run.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Argument, CallExpression, Program, PropertyKey } from "oxc-parser";
import { walk, type WalkerThisContextEnter } from "../oxc/index.js";
import { ViteErrorCodes } from "../error-codes.js";
import type { GwenSourceTransform, TransformContext, TransformEdit } from "../pipeline/types.js";

export interface BvhPrebakeDeps {
  bake(glb: Uint8Array, mesh: string | undefined): Promise<Uint8Array>;
  assets: Map<string, Uint8Array>;
}

interface Candidate {
  readonly call: CallExpression;
  readonly rel: string;
  readonly mesh: string | undefined;
  readonly start: number;
  readonly end: number;
}

function isRelativeGlb(value: string): boolean {
  const nested = value.startsWith("../");
  const local = value.startsWith("./");
  if (!nested && !local) return false;
  return value.endsWith(".glb");
}

function staticKey(key: PropertyKey): string | null {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

/** `null` means the object is not a mesh option we can bake. `undefined` means no mesh name. */
function meshName(argument: Argument): string | undefined | null {
  if (argument.type !== "ObjectExpression") return null;
  let mesh: string | undefined;
  for (const property of argument.properties) {
    if (property.type !== "Property") return null;
    if (staticKey(property.key) !== "mesh") continue;
    if (property.computed) return null;
    if (property.value.type !== "Literal" || typeof property.value.value !== "string") return null;
    mesh = property.value.value;
  }
  return mesh;
}

function readCandidate(node: CallExpression, ctx: TransformContext): Candidate | undefined {
  const callee = ctx.resolveCallee(node);
  if (callee !== "useMeshCollider") return undefined;
  if (node.arguments.length === 0 || node.arguments.length > 2) return undefined;
  for (const argument of node.arguments) {
    if (argument.type === "SpreadElement") return undefined;
  }
  const first = node.arguments[0];
  if (first === undefined || first.type !== "Literal") return undefined;
  if (typeof first.value !== "string") return undefined;
  const literal = first.value;
  if (!isRelativeGlb(literal)) return undefined;
  const second = node.arguments[1];
  let mesh: string | undefined;
  if (second !== undefined) {
    const read = meshName(second);
    if (read === null) return undefined;
    mesh = read;
  }
  const last = second ?? first;
  return { call: node, rel: literal, mesh, start: first.start, end: last.end };
}

function assetFileName(bytes: Uint8Array): string {
  return `bvh-${createHash("md5").update(bytes).digest("hex").slice(0, 8)}.bin`;
}

function editFor(candidate: Candidate, name: string): TransformEdit {
  return {
    kind: "overwrite",
    start: candidate.start,
    end: candidate.end,
    text: `{ __bvhUrl: ${JSON.stringify(name)} }`,
  };
}

function readGlb(abs: string): Uint8Array {
  const data = readFileSync(abs);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function failBake(
  ctx: TransformContext,
  call: CallExpression,
  rel: string,
  caught: unknown,
): never {
  ctx.raise(
    ViteErrorCodes.BVH_PREBAKE_FAILED,
    call,
    `BVH pre-bake failed for ${rel}.`,
    "Export the mesh as triangles; see the physics3d docs.",
    caught,
  );
}

function collectCandidates(program: Program, ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];
  walk(program, {
    enter(this: WalkerThisContextEnter, node) {
      if (node.type !== "CallExpression") return;
      const found = readCandidate(node, ctx);
      if (found === undefined) return;
      candidates.push(found);
      this.skip();
    },
  });
  return candidates;
}

export function createBvhPrebakeTransform(deps: BvhPrebakeDeps): GwenSourceTransform {
  return {
    name: "gwen:bvh-prebake",
    async run(program, ctx) {
      const seen = new Map<string, string>();
      const edits: TransformEdit[] = [];
      for (const candidate of collectCandidates(program, ctx)) {
        const abs = resolve(dirname(ctx.id), candidate.rel);
        if (!existsSync(abs)) {
          ctx.raise(
            ViteErrorCodes.BVH_PREBAKE_FAILED,
            candidate.call,
            `useMeshCollider: ${abs} does not exist.`,
            "Check the path relative to the importing file.",
          );
        }
        let glb: Uint8Array;
        try {
          glb = readGlb(abs);
        } catch (caught) {
          failBake(ctx, candidate.call, candidate.rel, caught);
        }
        const digest = createHash("md5").update(glb).digest("hex");
        const meshKey = candidate.mesh === undefined ? "u" : `m${candidate.mesh}`;
        const key = `${digest}\0${meshKey}`;
        const cached = seen.get(key);
        if (cached !== undefined) {
          edits.push(editFor(candidate, cached));
          continue;
        }
        let bytes: Uint8Array;
        try {
          bytes = await deps.bake(glb, candidate.mesh);
        } catch (caught) {
          failBake(ctx, candidate.call, candidate.rel, caught);
        }
        const name = assetFileName(bytes);
        seen.set(key, name);
        deps.assets.set(name, bytes);
        ctx.emitFile?.({ type: "asset", fileName: name, source: bytes });
        edits.push(editFor(candidate, name));
      }
      return edits;
    },
  };
}
