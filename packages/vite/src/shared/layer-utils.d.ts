export const layerInlineTransform: {
  readonly name: "gwen:layer-inline";
  run: (program: unknown, context: unknown) => readonly unknown[] | Promise<readonly unknown[]>;
};
export function evalConstInt(node: unknown): number | null;
