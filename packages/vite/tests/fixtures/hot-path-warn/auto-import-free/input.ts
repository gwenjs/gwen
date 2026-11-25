export const Free = defineSystem("Free", () => {
  onUpdate(() => {
    useService("audio");
  });
});
