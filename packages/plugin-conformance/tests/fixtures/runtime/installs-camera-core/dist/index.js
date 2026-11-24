import { definePlugin } from "@gwenjs/kit/plugin";
import { CameraCorePlugin } from "@gwenjs/camera-core";

export const InstallsCameraCore = definePlugin(() => ({
  name: "installs-camera-core",
  requires: {
    services: ["cameraManager", "viewportManager"],
  },
  async setup(engine) {
    await engine.use(CameraCorePlugin());
  },
}));
