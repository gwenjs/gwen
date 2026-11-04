/**
 * Scene discovery for `@gwenjs/vite/scanners`.
 * No Vite import: `GwenApp` and the CLI can call this without a Vite peer.
 */
import fs from "node:fs";
import * as path from "node:path";
import { walk } from "oxc-walker";
import { GwenError } from "@gwenjs/schema";
import { getCallArgs, isCallTo, parseSource } from "../oxc/index.js";
import { ViteErrorCodes } from "../error-codes.js";

/** One file under `src/scenes/` that exports a scene. */
export interface SceneInfo {
  file: string;
  className: string;
  sceneName: string;
  isDefault: boolean;
  isFactory: boolean;
  isConst: boolean;
  relPath: string;
}

/**
 * Read one scene file.
 * `sceneName` is null when the file has no string literal name.
 * `className` is the export binding, or `fallbackName` when the file declares none.
 */
function scanSceneFile(
  source: string,
  filename: string,
  fallbackName: string,
): {
  className: string;
  sceneName: string | null;
  isDefault: boolean;
  isFactory: boolean;
  isConst: boolean;
} {
  const parsed = parseSource(filename, source);
  if (!parsed) {
    return {
      className: fallbackName,
      sceneName: null,
      isDefault: false,
      isConst: false,
      isFactory: false,
    };
  }

  let className = fallbackName;
  let isDefault = false;
  let isConst = false;
  let isFactory = false;
  let sceneName: string | null = null;

  walk(parsed.program, {
    enter(node) {
      if (node.type === "ExportDefaultDeclaration") {
        const { declaration } = node;
        if (declaration.type === "ClassDeclaration" || declaration.type === "ClassExpression") {
          if (declaration.id?.type === "Identifier") {
            className = declaration.id.name;
            isDefault = true;
          }
        }
        return;
      }

      if (node.type === "ExportNamedDeclaration") {
        const { declaration } = node;
        if (!declaration) return;

        if (declaration.type === "ClassDeclaration" || declaration.type === "ClassExpression") {
          if (declaration.id?.type === "Identifier") className = declaration.id.name;
          return;
        }

        if (declaration.type === "VariableDeclaration") {
          for (const { id, init } of declaration.declarations) {
            if (id.type !== "Identifier") continue;
            if (!init || init.type !== "CallExpression" || !isCallTo(init, "defineScene")) continue;
            className = id.name;
            isConst = true;
            const first = getCallArgs(init)[0];
            if (first && first.type === "Literal" && typeof first.value === "string") {
              sceneName = first.value;
              isFactory = true;
            }
          }
          return;
        }
      }

      if (node.type === "CallExpression" && isCallTo(node, "defineScene")) {
        if (!sceneName) {
          const first = getCallArgs(node)[0];
          if (first && first.type === "Literal" && typeof first.value === "string") {
            sceneName = first.value;
          }
        }
        return;
      }

      if (node.type === "PropertyDefinition") {
        if (node.key.type === "Identifier" && node.key.name === "name") {
          if (node.value && node.value.type === "Literal" && !sceneName) {
            if (typeof node.value.value === "string") sceneName = node.value.value;
          }
        }
      }
    },
  });

  return { className, sceneName, isDefault, isConst, isFactory };
}

/** Scan `src/scenes/*.ts`. Files whose names start with `_` or `.` are skipped. */
export function scanScenes(projectRoot: string): SceneInfo[] {
  const scenesDir = path.join(projectRoot, "src", "scenes");
  if (!fs.existsSync(scenesDir)) return [];

  const scenes: SceneInfo[] = [];
  const seen = new Map<string, string>();
  const files = fs
    .readdirSync(scenesDir)
    .filter((file) => file.endsWith(".ts") && !file.startsWith("_") && !file.startsWith("."))
    .sort();

  for (const file of files) {
    const rel = `src/scenes/${file}`;
    const base = file.replace(/\.ts$/, "");
    const fullPath = path.join(scenesDir, file);
    const source = fs.readFileSync(fullPath, "utf-8");
    const extracted = scanSceneFile(source, fullPath, base);
    if (extracted.sceneName === null) {
      throw new GwenError(
        ViteErrorCodes.SCENE_NAME_UNRESOLVED,
        `Scene file "${rel}" has no literal scene name.`,
        {
          composable: "scanScenes",
          hint:
            process.env["NODE_ENV"] !== "production"
              ? "Use defineScene('<name>', …) with a string literal, or prefix helper files with \"_\"."
              : undefined,
        },
      );
    }
    const sceneName = extracted.sceneName;
    const previous = seen.get(sceneName);
    if (previous !== undefined) {
      throw new GwenError(
        ViteErrorCodes.SCENE_NAME_DUPLICATE,
        `Scene name "${sceneName}" is declared in "${previous}" and "${rel}".`,
        {
          composable: "scanScenes",
          hint:
            process.env["NODE_ENV"] !== "production"
              ? "Give each scene file its own string literal name."
              : undefined,
        },
      );
    }
    seen.set(sceneName, rel);
    scenes.push({
      file,
      className: extracted.className,
      sceneName,
      isDefault: extracted.isDefault,
      isFactory: extracted.isFactory,
      isConst: extracted.isConst,
      relPath: `/src/scenes/${base}.ts`,
    });
  }

  return scenes;
}

/**
 * Pick the initial scene.
 * A `fromConfig` that is not one of the discovered names throws.
 * With no `fromConfig`, the first discovered scene is used.
 */
export function resolveMainScene(
  scenes: readonly SceneInfo[],
  fromConfig?: string,
): string | undefined {
  if (fromConfig) {
    if (!scenes.some((scene) => scene.sceneName === fromConfig)) {
      const discovered = scenes.map((scene) => scene.sceneName).join(", ");
      throw new GwenError(
        ViteErrorCodes.MAIN_SCENE_UNKNOWN,
        `Main scene "${fromConfig}" is not a discovered scene (${discovered}).`,
        {
          composable: "resolveMainScene",
          hint:
            process.env["NODE_ENV"] !== "production"
              ? "Set mainScene to a name discovered under src/scenes/."
              : undefined,
        },
      );
    }
    return fromConfig;
  }
  return scenes[0]?.sceneName;
}
