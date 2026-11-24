export const layerInlineTransform: {
  readonly name: "gwen:layer-inline";
  run: (program: unknown, context: unknown) => readonly unknown[] | Promise<readonly unknown[]>;
};
export function evalConstInt(node: unknown): number | null;
export function createBvhPrebakeTransform(deps: {
  bake(glb: Uint8Array, mesh: string | undefined): Promise<Uint8Array>;
  assets: Map<string, Uint8Array>;
}): {
  readonly name: "gwen:bvh-prebake";
  run: (program: unknown, context: unknown) => readonly unknown[] | Promise<readonly unknown[]>;
};
