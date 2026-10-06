/// <reference types="vite/client" />
import { expectTypeOf } from "vitest";
import { useService } from "@gwenjs/core/system";
import type { ScreenService } from "../../src/screen-service.js";
import "../../src/get-or-create-screen-service.js";

expectTypeOf(useService("screenService")).toEqualTypeOf<ScreenService>();
