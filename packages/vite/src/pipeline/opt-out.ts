/**
 * `@gwen-no-optimize`: one scan of the comments per module.
 * A directive is a line comment or a block comment whose text is exactly the token.
 * A JSDoc block is not one: its text starts with `*`.
 * Before the first statement it covers the whole module.
 * As the leading comment of a node it covers the node that starts there. Ancestors are
 * not consulted: a unit checks each enclosing node it cares about. Only the comment
 * right before the node counts: a later comment in between hides it.
 */

import type { Comment, Program } from "oxc-parser";

const DIRECTIVE = "@gwen-no-optimize";

function isBlank(char: string): boolean {
  return char.trim() === "";
}

/** Offset of the first character after `from` that is not whitespace. */
function nextToken(code: string, from: number): number {
  let at = from;
  while (at < code.length && isBlank(code.charAt(at))) at += 1;
  return at;
}

/** Answers "is this node opted out" for one module. */
export function createOptOut(
  code: string,
  comments: readonly Comment[],
  program: Program,
): (node: { start: number }) => boolean {
  const directives = comments.filter((comment) => comment.value.trim() === DIRECTIVE);
  if (directives.length === 0) return () => false;
  const first = program.body[0];
  const fileEnd = first === undefined ? code.length : first.start;
  const targets = new Set<number>();
  for (const directive of directives) {
    if (directive.end <= fileEnd) return () => true;
    targets.add(nextToken(code, directive.end));
  }
  return (node) => targets.has(node.start);
}
