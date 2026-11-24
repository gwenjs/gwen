import { definePlugin } from "@gwenjs/kit/plugin";

export const RequiresCameraServices = definePlugin(() => ({
  name: "requires-camera-services",
  requires: {
    plugins: ["camera-core"],
    services: ["cameraManager", "viewportManager"],
  },
  setup() {},
}));
