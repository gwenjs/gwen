import type { ComponentDefinition, ComponentSchema } from '../schema';
import type { ComponentType } from '../types/entity';

/**
 * Public component reference accepted by ECS APIs.
 */
export type ComponentTypeInput = ComponentType | ComponentDefinition<ComponentSchema>;

/**
 * Returns true when a runtime value looks like a component definition.
 */
export function isComponentDefinition(
  value: unknown,
): value is ComponentDefinition<ComponentSchema> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

/**
 * Converts a component input into its canonical string name.
 *
 * @param input - Component name string or component definition object.
 * @param strict - When true, throws on invalid input. When false, returns an empty string.
 */
export function normalizeComponentType(input: unknown, strict = true): string {
  if (typeof input === 'string') {
    const name = input.trim();
    if (name.length > 0) return name;
    if (strict) {
      throw new Error('[GWEN] Component type must not be an empty string.');
    }
    return '';
  }

  if (isComponentDefinition(input)) {
    const name = input.name.trim();
    if (name.length > 0) return name;
    if (strict) {
      throw new Error('[GWEN] ComponentDefinition.name must not be empty.');
    }
    return '';
  }

  if (strict) {
    throw new Error('[GWEN] Invalid component type. Expected string or ComponentDefinition.');
  }

  return '';
}

/**
 * Canonicalizes query inputs into stable component names.
 *
 * Behavior:
 * - normalizes every input to a string name
 * - optionally rejects invalid values
 * - removes duplicates
 * - sorts names for deterministic cache keys
 */
export function normalizeComponentTypesForQuery(
  inputs: readonly unknown[],
  strict = true,
): string[] {
  const names = new Set<string>();

  for (const input of inputs) {
    const normalized = normalizeComponentType(input, strict);
    if (normalized.length > 0) {
      names.add(normalized);
    }
  }

  return [...names].sort();
}

/**
 * Builds a deterministic cache key from normalized component names.
 */
export function buildQueryCacheKey(componentNames: readonly string[]): string {
  return componentNames.join('|');
}
