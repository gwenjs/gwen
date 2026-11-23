import { defineSystem as ds } from "@gwenjs/core/system";

export const top = ds(1);

export function f() {
  ds();
  function ds() {
    return 1;
  }
  return ds;
}
