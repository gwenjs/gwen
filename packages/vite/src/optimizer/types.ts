/**
 * Metadata for a single component field as stored in the WASM memory layout.
 */
export interface ComponentFieldMeta {
  readonly name: string;
  readonly type: string;
  readonly byteOffset: number;
}

/**
 * Build-time descriptor for a `defineComponent()` call.
 * Populated by the AST walker when it encounters a component definition.
 */
export interface ComponentEntry {
  /** Component name (matches `defineComponent({ name: '...' })`) */
  readonly name: string;
  /** Unique numeric ID (`_typeId` from defineComponent) */
  readonly typeId: number;
  /** Total byte size of one instance in WASM linear memory */
  readonly byteSize: number;
  /** `byteSize / 4` — Float32 slots per entity */
  readonly f32Stride: number;
  /** Ordered field descriptors */
  readonly fields: ReadonlyArray<ComponentFieldMeta>;
  /** Absolute or relative import path to the file that declares this component */
  readonly importPath: string;
  /** The exported identifier name for this component */
  readonly exportName: string;
}

/**
 * Source positions needed by BulkTransformer to rewrite an optimizable pattern.
 * All positions are byte offsets into the original source string.
 */
export interface PatternPositions {
  /** Start position of the `for` keyword in the for-of loop. */
  readonly forOfStart: number;
  /**
   * Start position of the opening `{` of the for-of loop body (BlockStatement.start).
   * Used to overwrite only the loop header when converting to a numeric for loop.
   */
  readonly forBodyStart: number;
  /** End position (exclusive) of the entire for-of statement including closing `}`. */
  readonly forOfEnd: number;
  /** The iteration variable name (e.g. `'e'` from `for (const e of entities)`). */
  readonly entityVar: string;
  /**
   * Each `const varName = useComponent(entity, ComponentName)` read declaration.
   * start/end cover the entire VariableDeclaration statement.
   */
  readonly readDecls: ReadonlyArray<{
    readonly varName: string;
    readonly component: string;
    readonly start: number;
    readonly end: number;
  }>;
  /**
   * Each `useComponent(entity, ComponentName, { ... })` write call.
   * start/end cover the entire ExpressionStatement.
   */
  readonly writeCalls: ReadonlyArray<{
    readonly component: string;
    readonly fields: ReadonlyArray<{
      readonly name: string;
      readonly valueStart: number;
      readonly valueEnd: number;
    }>;
    readonly start: number;
    readonly end: number;
  }>;
  /**
   * Each `varName.fieldName` MemberExpression inside the loop body where
   * `varName` maps to a read component. Used to rewrite `pos.x` → `_position[_i * 2 + 0]`.
   */
  readonly propAccesses: ReadonlyArray<{
    readonly varName: string;
    readonly fieldName: string;
    readonly start: number;
    readonly end: number;
  }>;
}

/**
 * A detected optimizable pattern — a `useQuery + onUpdate` block where
 * the optimizer can replace per-entity get/set calls with bulk WASM calls.
 */
export interface OptimizablePattern {
  /** Components queried by `useQuery([...])` */
  readonly queryComponents: string[];
  /** Which components are read inside the `onUpdate` body */
  readonly readComponents: string[];
  /** Which components are written inside the `onUpdate` body */
  readonly writeComponents: string[];
  /** Source location for error reporting and source map generation. */
  readonly loc: { line: number; column: number; file: string };
  /** Populated in Phase 2 by OXC walker with exact source positions. */
  readonly positions?: PatternPositions;
}

/**
 * Tier of WASM APIs available based on the user's installed packages.
 * Determines which bulk operations can be generated.
 */
export type WasmTier = 'core' | 'physics2d' | 'physics3d';

/**
 * Context passed to the code generator.
 */
export interface OptimizerContext {
  /** Component registry collected during buildStart */
  readonly manifest: import('./component-manifest').ComponentManifest;
  /** Which WASM tier is active */
  readonly tier: WasmTier;
  /** Enable verbose logging (set via `gwenOptimizerPlugin({ debug: true })`) */
  readonly debug: boolean;
}
