import { onEnter } from "@gwenjs/core/scene";

export function inner(value: number) {
  const onEnter = (fn: () => Promise<void>) => fn();
  onEnter(async () => {
    await skipped();
  });
  return value;
}

onEnter(async () => {
  await load(/*@map*/ mark);
});
