import { definePlugin } from "@gwenjs/kit/plugin";

export interface AudioApi {
  play(name: string): void;
}

declare module "@gwenjs/schema" {
  interface GwenProvides {
    audio: AudioApi;
  }
}

export const AudioPlugin = definePlugin({ provides: ["audio"] }, () => ({
  name: "audio",
  setup(engine) {
    const api: AudioApi = {
      play(_name: string): void {},
    };
    engine.provide("audio", api);
  },
}));
