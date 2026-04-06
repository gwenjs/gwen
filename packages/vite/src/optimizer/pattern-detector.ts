import type { OptimizablePattern } from './types';
import type { ComponentManifest } from './component-manifest';

/**
 * Classification result for a detected pattern.
 */
export interface ClassificationResult {
  /** Whether this pattern can be safely replaced with bulk WASM calls. */
  readonly optimizable: boolean;
  /** Human-readable reason when `optimizable` is false. */
  readonly reason?: string;
  /** Resolved component metadata for the query, read, and write components. */
  readonly components?: {
    query: string[];
    read: string[];
    write: string[];
  };
}

/**
 * Classifies `OptimizablePattern` candidates against the `ComponentManifest`.
 *
 * A pattern is optimizable when:
 * 1. All queried components are registered in the manifest.
 * 2. All read/write components are also registered.
 * 3. All fields in the read/write components are numeric (f32/i32/u32/bool etc).
 *
 * @example
 * ```ts
 * const detector = new PatternDetector(manifest)
 * const result = detector.classify(pattern)
 * if (result.optimizable) { ... }
 * ```
 */
export class PatternDetector {
  constructor(private readonly manifest: ComponentManifest) {}

  /**
   * Classify a single detected pattern.
   *
   * @param pattern - The optimizable pattern candidate to classify.
   * @returns A `ClassificationResult` indicating whether the pattern is optimizable.
   */
  classify(pattern: OptimizablePattern): ClassificationResult {
    const allComponents = [
      ...new Set([
        ...pattern.queryComponents,
        ...pattern.readComponents,
        ...pattern.writeComponents,
      ]),
    ];

    for (const name of allComponents) {
      if (!this.manifest.get(name)) {
        return {
          optimizable: false,
          reason: `Component '${name}' not found in manifest — cannot generate bulk call`,
        };
      }
    }

    const numericTypes = new Set(['f32', 'i32', 'u32', 'f64', 'i64', 'u64', 'bool']);
    for (const name of allComponents) {
      const entry = this.manifest.get(name)!;
      for (const field of entry.fields) {
        if (!numericTypes.has(field.type)) {
          return {
            optimizable: false,
            reason: `Component '${name}' field '${field.name}' is type '${field.type}' — only numeric types are bulk-compatible`,
          };
        }
      }
    }

    return {
      optimizable: true,
      components: {
        query: pattern.queryComponents,
        read: pattern.readComponents,
        write: pattern.writeComponents,
      },
    };
  }
}
