export function evalBitExpr(expr: string): number | null;
export function extractLayerDefinitions(code: string): Map<string, number> | null;
export function inlineLayerReferences(
  code: string,
  variableName: string,
  layerMap: Map<string, number>,
): string;
