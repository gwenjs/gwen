/**
 * Apply ordered edits with one MagicString. Overlaps throw.
 * An insert exactly at another edit's start or end is not an overlap.
 * Two inserts at one offset keep registry order (`appendLeft`).
 */

import MagicString from "magic-string";
import { GwenError } from "@gwenjs/schema";
import { ViteErrorCodes } from "../error-codes.js";
import type { TransformEdit } from "./types.js";

type TaggedEdit = TransformEdit & { unit: string };

interface Planned {
  readonly unit: string;
  readonly order: number;
  readonly start: number;
  readonly end: number;
  readonly edit: TaggedEdit;
}

function spanOf(edit: TaggedEdit): { start: number; end: number } {
  if (edit.kind === "insert") return { start: edit.at, end: edit.at };
  return { start: edit.start, end: edit.end };
}

function plan(edits: readonly TaggedEdit[]): Planned[] {
  const planned: Planned[] = [];
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index];
    if (edit === undefined) continue;
    const span = spanOf(edit);
    planned.push({
      unit: edit.unit,
      order: index,
      start: span.start,
      end: span.end,
      edit,
    });
  }
  planned.sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    return left.order - right.order;
  });
  return planned;
}

/** A point strictly inside `(start, end)`. The endpoints are not inside. */
function pointInside(at: number, start: number, end: number): boolean {
  return at > start && at < end;
}

function rangesOverlap(left: Planned, right: Planned): boolean {
  const leftWide = left.end > left.start;
  const rightWide = right.end > right.start;
  if (leftWide && rightWide) return left.start < right.end && right.start < left.end;
  if (!leftWide && rightWide) return pointInside(left.start, right.start, right.end);
  if (leftWide && !rightWide) return pointInside(right.start, left.start, left.end);
  return false;
}

function rejectOverlaps(id: string, planned: readonly Planned[]): void {
  for (let leftIndex = 0; leftIndex < planned.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < planned.length; rightIndex += 1) {
      const left = planned[leftIndex];
      const right = planned[rightIndex];
      if (left === undefined || right === undefined) continue;
      if (!rangesOverlap(left, right)) continue;
      throw new GwenError(
        ViteErrorCodes.TRANSFORM_EDIT_CONFLICT,
        `${left.unit} [${left.start}-${left.end}] and ${right.unit} [${right.start}-${right.end}] edit the same range in ${id}.`,
        { composable: "gwen" },
      );
    }
  }
}

function applyOne(editor: MagicString, edit: TaggedEdit): void {
  if (edit.kind === "insert") {
    editor.appendLeft(edit.at, edit.text);
    return;
  }
  if (edit.kind === "overwrite") {
    editor.overwrite(edit.start, edit.end, edit.text);
    return;
  }
  editor.remove(edit.start, edit.end);
}

/** `null` when `edits` is empty. An overlap throws. */
export function applyEdits(
  id: string,
  code: string,
  edits: readonly TaggedEdit[],
): { code: string; s: MagicString } | null {
  if (edits.length === 0) return null;
  const planned = plan(edits);
  rejectOverlaps(id, planned);
  const editor = new MagicString(code);
  for (const item of planned) applyOne(editor, item.edit);
  return { code: editor.toString(), s: editor };
}
