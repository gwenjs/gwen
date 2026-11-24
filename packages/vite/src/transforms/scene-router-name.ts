/** `gwen:scene-router-name` names `const AppRouter = defineSceneRouter(...)`. */

import { devNameUnit } from "./dev-name-statement.js";

export const sceneRouterName = devNameUnit(
  "gwen:scene-router-name",
  "defineSceneRouter",
  "__routerName__",
);
