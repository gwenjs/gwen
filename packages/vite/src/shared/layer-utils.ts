/**
 * @file Shared helpers for physics Vite plugins — layer definition extraction and inlining.
 *
 * Used by both `@gwenjs/physics2d` and `@gwenjs/physics3d` Vite plugins to replace
 * `Layers.xyz` references with their literal bitmask values at build time.
 */

/**
 * Safely evaluate a bit-expression string without using `eval` or `Function`.
 *
 * Supports: decimal / hex / binary integer literals, unary `~`, binary operators
 * `<<`, `>>`, `|`, `&`, `^`, and parentheses.  Any token that does not match
 * this restricted grammar causes the function to return `null`.
 *
 * @param expr - The expression string to evaluate.
 * @returns The numeric result, or `null` if the expression is not supported.
 */
export function evalBitExpr(expr: string): number | null {
  // Allowed token pattern: integer literals, operators, parens, whitespace.
  const TOKEN_RE = /\s*(0x[\da-fA-F]+|0b[01]+|\d+|<<|>>|[|&^~()])\s*/g;

  const tokens: string[] = [];
  let lastIndex = 0;

  for (const m of expr.matchAll(TOKEN_RE)) {
    if (m.index !== lastIndex) return null; // gap → unexpected characters
    tokens.push(m[1]);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex !== expr.length) return null; // trailing garbage

  let pos = 0;

  function peek(): string | undefined {
    return tokens[pos];
  }

  function consume(): string {
    return tokens[pos++]!;
  }

  // Forward declarations for mutual recursion.
  function parseExpr(): number | null {
    return parseBitOr();
  }

  function parseBitOr(): number | null {
    let left = parseBitXor();
    if (left === null) return null;
    while (peek() === '|') {
      consume();
      const right = parseBitXor();
      if (right === null) return null;
      left = (left | right) >>> 0;
    }
    return left;
  }

  function parseBitXor(): number | null {
    let left = parseBitAnd();
    if (left === null) return null;
    while (peek() === '^') {
      consume();
      const right = parseBitAnd();
      if (right === null) return null;
      left = (left ^ right) >>> 0;
    }
    return left;
  }

  function parseBitAnd(): number | null {
    let left = parseShift();
    if (left === null) return null;
    while (peek() === '&') {
      consume();
      const right = parseShift();
      if (right === null) return null;
      left = (left & right) >>> 0;
    }
    return left;
  }

  function parseShift(): number | null {
    let left = parseUnary();
    if (left === null) return null;
    while (peek() === '<<' || peek() === '>>') {
      const op = consume();
      const right = parseUnary();
      if (right === null) return null;
      left = op === '<<' ? (left << right) >>> 0 : (left >>> right);
    }
    return left;
  }

  function parseUnary(): number | null {
    if (peek() === '~') {
      consume();
      const v = parseUnary();
      return v === null ? null : (~v) >>> 0;
    }
    return parsePrimary();
  }

  function parsePrimary(): number | null {
    const tok = peek();
    if (tok === undefined) return null;

    if (tok === '(') {
      consume();
      const v = parseExpr();
      if (v === null || consume() !== ')') return null;
      return v;
    }

    // Integer literal (decimal, hex, binary)
    if (/^(0x[\da-fA-F]+|0b[01]+|\d+)$/.test(tok)) {
      consume();
      return parseInt(tok, tok.startsWith('0x') ? 16 : tok.startsWith('0b') ? 2 : 10);
    }

    return null; // unexpected token
  }

  const result = parseExpr();
  if (result === null || pos !== tokens.length) return null;
  return result;
}

/**
 * Extract layer name-to-value entries from a `defineLayers({...})` call in source code.
 *
 * Only handles simple numeric literal expressions (integers, hex literals, binary literals,
 * and shift expressions). Complex runtime expressions are skipped silently.
 *
 * @param code - The TypeScript/JavaScript source file contents.
 * @returns A `Map<string, number>` when at least one entry was parsed, or `null`.
 */
export function extractLayerDefinitions(code: string): Map<string, number> | null {
  const match = code.match(/defineLayers\s*\(\s*\{([^}]+)\}\s*\)/);
  if (!match) return null;

  const layerMap = new Map<string, number>();
  const entries = match[1].matchAll(/(\w+)\s*:\s*(.+?)(?:,|\s*$)/gm);

  for (const entry of entries) {
    const value = evalBitExpr(entry[2].trim());
    if (value !== null) {
      layerMap.set(entry[1].trim(), value);
    }
  }

  return layerMap.size > 0 ? layerMap : null;
}

/**
 * Replace `VarName.layerName` references with their literal numeric values.
 *
 * Only replaces whole-word identifier references (uses `\b` word boundaries) to
 * avoid accidentally replacing identifiers that merely contain the layer name.
 *
 * @param code - Source code to transform.
 * @param variableName - The variable name of the `defineLayers` result (e.g., `'Layers'`).
 * @param layerMap - Map of layer name to numeric value from {@link extractLayerDefinitions}.
 * @returns Transformed source code with layer references replaced by numeric literals.
 */
export function inlineLayerReferences(
  code: string,
  variableName: string,
  layerMap: Map<string, number>,
): string {
  let result = code;
  for (const [name, value] of layerMap) {
    const pattern = new RegExp(`\\b${variableName}\\.${name}\\b`, 'g');
    result = result.replace(pattern, String(value));
  }
  return result;
}
