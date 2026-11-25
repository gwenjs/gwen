// @gwen-no-optimize
export const First = defineSystem("First", () => {
  onUpdate(() => {
    useService("first");
  });
});

export const Second = defineSystem("Second", () => {
  onUpdate(() => {
    useService("second");
  });
});
