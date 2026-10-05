import { defineSystem } from "../../src/system/runtime/define-system";

const Combat = defineSystem((player: { hp: number }, bonus: number) => {
  void player;
  void bonus;
});

Combat({ hp: 1 }, 2);

// @ts-expect-error bonus is required
Combat({ hp: 1 });

const named = defineSystem("combat", (count: number) => {
  void count;
});

named(1);

// @ts-expect-error count is a number
named("1");
