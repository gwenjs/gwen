const name = "@gwenjs/physics3d";
const sub = "module";
export const lazy = import(name);
export const partial = import(`@gwenjs/physics3d/${sub}`);
export const eager = import("@gwenjs/physics3d"); // offender
