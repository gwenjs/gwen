/**
 * Scene discovery for `@gwenjs/vite/scanners`.
 * No Vite import: `GwenApp` and the CLI can call this without a Vite peer.
 */
import fs from "node:fs";
import * as path from "node:path";
import { walk } from "oxc-walker";
import type {
  CallExpression,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  PropertyDefinition,
  StringLiteral,
  VariableDeclaration,
  VariableDeclarator,
  Class as OxcClass,
} from "oxc-parser";
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
        const { declaration } = node as ExportDefaultDeclaration;
        if (declaration.type === "ClassDeclaration" || declaration.type === "ClassExpression") {
          const cls = declaration as OxcClass;
          if (cls.id?.type === "Identifier") {
            className = (cls.id as { name: string }).name;
            isDefault = true;
          }
        }
        return;
      }

      if (node.type === "ExportNamedDeclaration") {
        const { declaration } = node as ExportNamedDeclaration;
        if (!declaration) return;

        if (declaration.type === "ClassDeclaration" || declaration.type === "ClassExpression") {
          const cls = declaration as OxcClass;
          if (cls.id?.type === "Identifier") className = (cls.id as { name: string }).name;
          return;
        }

        if (declaration.type === "VariableDeclaration") {
          for (const declarator of (declaration as VariableDeclaration).declarations) {
            const { id, init } = declarator as VariableDeclarator;
            if (id.type !== "Identifier") continue;
            if (!init || !isCallTo(init, "defineScene")) continue;
            className = (id as { name: string }).name;
            isConst = true;
            const args = getCallArgs(init as CallExpression);
            if (args.length >= 1 && args[0]!.type === "Literal") {
              const val = (args[0] as StringLiteral).value;
              if (typeof val === "string") {
                sceneName = val;
                isFactory = true;
              }
            }
          }
          return;
        }
      }

      if (node.type === "CallExpression" && isCallTo(node as CallExpression, "defineScene")) {
        if (!sceneName) {
          const args = getCallArgs(node as CallExpression);
          if (args.length >= 1 && args[0]!.type === "Literal") {
            const val = (args[0] as StringLiteral).value;
            if (typeof val === "string") sceneName = val;
          }
        }
        return;
      }

      if (node.type === "PropertyDefinition") {
        const propDef = node as PropertyDefinition;
        if (
          propDef.key.type === "Identifier" &&
          (propDef.key as { name: string }).name === "name"
        ) {
          if (propDef.value && propDef.value.type === "Literal" && !sceneName) {
            const val = (propDef.value as StringLiteral).value;
            if (typeof val === "string") sceneName = val;
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
