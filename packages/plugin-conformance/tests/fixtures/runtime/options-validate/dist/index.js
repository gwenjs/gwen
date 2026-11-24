import { definePlugin } from "@gwenjs/kit/plugin";

export const OptionsPlugin = definePlugin(
  {
    options: {
      defaults: { speed: 1 },
      validate(options) {
        if (options.speed >= 0) return [];
        return [
          {
            path: "speed",
            expected: "a number greater than or equal to 0",
            received: String(options.speed),
            owner: "options-validate",
          },
        ];
      },
    },
  },
  () => ({
    name: "options-validate",
    setup() {},
  }),
);
