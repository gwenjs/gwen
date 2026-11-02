/** True for a plain object, not an array or `null`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Where each key and value of a JSON text starts, found by JSON path.
 * A path is the chain of object keys and array indices (as strings) from the root:
 * `["exports", "./module", "import"]`, `["exports", ".", "0"]`.
 * With a duplicate key, the last one wins, as in `JSON.parse`.
 */
export interface JsonIndex {
  /** 1-based line of the opening quote of the key at `path`, or `undefined` when there is none. */
  keyLine(path: readonly string[]): number | undefined;
  /** 1-based line where the value at `path` starts, or `undefined` when there is none. */
  valueLine(path: readonly string[]): number | undefined;
}

interface JsonNode {
  /** Offset of the opening quote of the key, or -1 for the root and for an array element. */
  keyOffset: number;
  /** Offset of the first character of the value. */
  valueOffset: number;
  children: Map<string, JsonNode> | undefined;
}

interface Frame {
  readonly node: JsonNode;
  readonly isArray: boolean;
  nextIndex: number;
}

interface StringToken {
  readonly value: string;
  readonly end: number;
}

const QUOTE = 34;
const BACKSLASH = 92;
const COMMA = 44;
const COLON = 58;
const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;

function isJsonSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function skipJsonSpace(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && isJsonSpace(text.charCodeAt(cursor))) cursor += 1;
  return cursor;
}

/** Offsets of the first character of every line. A line ends at `\n` only, so CRLF is one break. */
function lineStartsOf(text: string): number[] {
  const starts = [0];
  let cursor = text.indexOf("\n");
  while (cursor >= 0) {
    starts.push(cursor + 1);
    cursor = text.indexOf("\n", cursor + 1);
  }
  return starts;
}

/** 1-based line of `offset`: the number of line starts at or before it. */
function lineOfOffset(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    const start = starts[middle];
    if (start !== undefined && start <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

function decodeEscapes(raw: string): string {
  try {
    const decoded: unknown = JSON.parse(`"${raw}"`);
    return typeof decoded === "string" ? decoded : raw;
  } catch {
    return raw;
  }
}

/** The string token whose opening quote is at `quoteAt`, or `undefined` when it never closes. */
function readJsonString(text: string, quoteAt: number): StringToken | undefined {
  let escaped = false;
  let index = quoteAt + 1;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === BACKSLASH) {
      escaped = true;
      index += 2;
      continue;
    }
    if (code === QUOTE) {
      const raw = text.slice(quoteAt + 1, index);
      return { value: escaped ? decodeEscapes(raw) : raw, end: index + 1 };
    }
    index += 1;
  }
  return undefined;
}

/** End of a number, `true`, `false` or `null` that starts at `start`. */
function scalarEnd(text: string, start: number): number {
  let cursor = start;
  while (cursor < text.length) {
    const code = text.charCodeAt(cursor);
    if (isJsonSpace(code) || code === COMMA || code === CLOSE_BRACE || code === CLOSE_BRACKET) {
      break;
    }
    cursor += 1;
  }
  return cursor;
}

function addChild(parent: JsonNode, name: string, keyOffset: number): JsonNode {
  const child: JsonNode = { keyOffset, valueOffset: -1, children: undefined };
  if (parent.children === undefined) parent.children = new Map();
  parent.children.set(name, child);
  return child;
}

/**
 * Index `text` in one pass: O(n) time and memory, no recursion.
 * It assumes `JSON.parse` already accepted the text. On a malformed text it stops where the
 * syntax breaks and keeps what it found so far; it never throws.
 */
export function indexJson(text: string): JsonIndex {
  const starts = lineStartsOf(text);
  const root: JsonNode = { keyOffset: -1, valueOffset: -1, children: undefined };
  const stack: Frame[] = [];
  let at = skipJsonSpace(text, 0);
  let slot: JsonNode | undefined = root;

  /** Read `"key" :` at `at` and make the new child the slot. False when the syntax breaks. */
  function enterKey(frame: Frame): boolean {
    if (text.charCodeAt(at) !== QUOTE) return false;
    const key = readJsonString(text, at);
    if (key === undefined) return false;
    const colon = skipJsonSpace(text, key.end);
    if (text.charCodeAt(colon) !== COLON) return false;
    slot = addChild(frame.node, key.value, at);
    at = skipJsonSpace(text, colon + 1);
    return true;
  }

  function enterElement(frame: Frame): void {
    slot = addChild(frame.node, String(frame.nextIndex), -1);
    frame.nextIndex += 1;
  }

  /** Open an object or array at `at`; the slot is left empty when it has no member. */
  function open(node: JsonNode, isArray: boolean): boolean {
    const frame: Frame = { node, isArray, nextIndex: 0 };
    stack.push(frame);
    at = skipJsonSpace(text, at + 1);
    if (text.charCodeAt(at) === (isArray ? CLOSE_BRACKET : CLOSE_BRACE)) {
      stack.pop();
      at += 1;
      slot = undefined;
      return true;
    }
    if (isArray) {
      enterElement(frame);
      return true;
    }
    return enterKey(frame);
  }

  /** After a value: close containers and move to the next member. False when the syntax breaks. */
  function advance(): boolean {
    while (slot === undefined) {
      at = skipJsonSpace(text, at);
      const frame = stack[stack.length - 1];
      if (frame === undefined) return false;
      const code = text.charCodeAt(at);
      if (code === COMMA) {
        at = skipJsonSpace(text, at + 1);
        if (frame.isArray) enterElement(frame);
        else if (!enterKey(frame)) return false;
      } else if (code === (frame.isArray ? CLOSE_BRACKET : CLOSE_BRACE)) {
        stack.pop();
        at += 1;
      } else {
        return false;
      }
    }
    return true;
  }

  while (slot !== undefined && at < text.length) {
    const node: JsonNode = slot;
    node.valueOffset = at;
    const code = text.charCodeAt(at);
    if (code === OPEN_BRACE || code === OPEN_BRACKET) {
      if (!open(node, code === OPEN_BRACKET)) break;
      if (slot !== undefined) continue;
    } else if (code === QUOTE) {
      const token = readJsonString(text, at);
      if (token === undefined) break;
      at = token.end;
      slot = undefined;
    } else {
      at = scalarEnd(text, at);
      slot = undefined;
    }
    if (!advance()) break;
  }

  function find(path: readonly string[]): JsonNode | undefined {
    let node: JsonNode | undefined = root;
    for (const name of path) {
      node = node.children?.get(name);
      if (node === undefined) return undefined;
    }
    return node;
  }

  return {
    keyLine(path) {
      const node = find(path);
      if (node === undefined || node.keyOffset < 0) return undefined;
      return lineOfOffset(starts, node.keyOffset);
    },
    valueLine(path) {
      const node = find(path);
      if (node === undefined || node.valueOffset < 0) return undefined;
      return lineOfOffset(starts, node.valueOffset);
    },
  };
}
