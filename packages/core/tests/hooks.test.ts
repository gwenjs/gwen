/**
 * Tests for the Hooks system
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createEntityId } from "@gwenjs/schema";
import type { GwenRuntimeHooks } from "../src/engine/runtime-hooks";
import { createGwenHooks } from "../src/hooks";
import type { GwenHookable } from "../src/hooks";

// Type-level pin: the default hook map of `createGwenHooks()` is `GwenRuntimeHooks`.
const defaultHooks = createGwenHooks();
const _defaultIsRuntimeHooks: GwenHookable<GwenRuntimeHooks> = defaultHooks;
// Type-level pin: a bare `GwenHookable` defaults to `GwenRuntimeHooks`.
const _bareIsRuntimeHooks: GwenHookable = createGwenHooks<GwenRuntimeHooks>();

// Hook map declared locally: these cases check hookable behaviour on names that are
// not keys of `GwenRuntimeHooks`, so they run on their own typed instance.
type LocalHooks = {
  "plugin:init": (plugin: { name: string }, api: object) => void;
  "plugin:beforeUpdate": (api: object, dt: number) => void;
  "plugin:update": (api: object, dt: number) => void;
  "plugin:render": (api: object) => void;
  "plugin:destroy": (plugin: { name: string }) => void;
  "entity:create": (id: number) => void;
  "entity:destroyed": (id: number) => void;
  "component:add": (id: number, type: string, data: Record<string, number>) => void;
  "component:remove": (id: number, type: string) => void;
  "component:removed": (id: number, type: string) => void;
  "component:update": (id: number, type: string, data: Record<string, number>) => void;
  "scene:load": (name: string) => void;
  "scene:unload": (name: string) => void;
  "physics:collision": (event: { bodyA: number; bodyB: number }) => void;
};

describe("GwenHooks", () => {
  const entityId = createEntityId(42, 0);
  let hooks: GwenHookable<GwenRuntimeHooks>;
  let localHooks: GwenHookable<LocalHooks>;

  beforeEach(() => {
    hooks = createGwenHooks();
    localHooks = createGwenHooks<LocalHooks>();
  });

  describe("Basic hook registration", () => {
    it("should register and call a simple hook", async () => {
      const callback = vi.fn();
      hooks.hook("engine:init", callback);

      await hooks.callHook("engine:init");

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should pass arguments to hook handlers", async () => {
      const callback = vi.fn();
      hooks.hook("entity:spawn", callback);

      await hooks.callHook("entity:spawn", entityId);

      expect(callback).toHaveBeenCalledWith(entityId);
    });

    it("should handle multiple hooks on same event", async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      hooks.hook("entity:spawn", callback1);
      hooks.hook("entity:spawn", callback2);

      await hooks.callHook("entity:spawn", entityId);

      expect(callback1).toHaveBeenCalledWith(entityId);
      expect(callback2).toHaveBeenCalledWith(entityId);
    });
  });

  describe("Plugin lifecycle hooks", () => {
    it("should call plugin:init hook", async () => {
      const callback = vi.fn();
      localHooks.hook("plugin:init", callback);

      const mockPlugin = { name: "TestPlugin" };
      const mockAPI = {};

      await localHooks.callHook("plugin:init", mockPlugin, mockAPI);

      expect(callback).toHaveBeenCalledWith(mockPlugin, mockAPI);
    });

    it("should call plugin:beforeUpdate hook with api and deltaTime", async () => {
      const callback = vi.fn();
      localHooks.hook("plugin:beforeUpdate", callback);

      const mockAPI = {};
      const dt = 0.016;

      await localHooks.callHook("plugin:beforeUpdate", mockAPI, dt);

      expect(callback).toHaveBeenCalledWith(mockAPI, dt);
    });

    it("should call plugin:update hook", async () => {
      const callback = vi.fn();
      localHooks.hook("plugin:update", callback);

      const mockAPI = {};
      const dt = 0.016;

      await localHooks.callHook("plugin:update", mockAPI, dt);

      expect(callback).toHaveBeenCalledWith(mockAPI, dt);
    });

    it("should call plugin:render hook", async () => {
      const callback = vi.fn();
      localHooks.hook("plugin:render", callback);

      const mockAPI = {};

      await localHooks.callHook("plugin:render", mockAPI);

      expect(callback).toHaveBeenCalledWith(mockAPI);
    });

    it("should call plugin:destroy hook", async () => {
      const callback = vi.fn();
      localHooks.hook("plugin:destroy", callback);

      const mockPlugin = { name: "TestPlugin" };

      await localHooks.callHook("plugin:destroy", mockPlugin);

      expect(callback).toHaveBeenCalledWith(mockPlugin);
    });
  });

  describe("Entity lifecycle hooks", () => {
    it("should call entity:create hook", async () => {
      const callback = vi.fn();
      localHooks.hook("entity:create", callback);

      const id = 123;
      await localHooks.callHook("entity:create", id);

      expect(callback).toHaveBeenCalledWith(id);
    });

    it("should call entity:destroy hook", async () => {
      const callback = vi.fn();
      hooks.hook("entity:destroy", callback);

      await hooks.callHook("entity:destroy", entityId);

      expect(callback).toHaveBeenCalledWith(entityId);
    });

    it("should call entity:destroyed hook", async () => {
      const callback = vi.fn();
      localHooks.hook("entity:destroyed", callback);

      const id = 123;
      await localHooks.callHook("entity:destroyed", id);

      expect(callback).toHaveBeenCalledWith(id);
    });
  });

  describe("Component lifecycle hooks", () => {
    it("should call component:add hook", async () => {
      const callback = vi.fn();
      localHooks.hook("component:add", callback);

      const id = 123;
      const type = "Position";
      const data = { x: 0, y: 0 };

      await localHooks.callHook("component:add", id, type, data);

      expect(callback).toHaveBeenCalledWith(id, type, data);
    });

    it("should call component:remove hook", async () => {
      const callback = vi.fn();
      localHooks.hook("component:remove", callback);

      const id = 123;
      const type = "Position";

      await localHooks.callHook("component:remove", id, type);

      expect(callback).toHaveBeenCalledWith(id, type);
    });

    it("should call component:removed hook", async () => {
      const callback = vi.fn();
      localHooks.hook("component:removed", callback);

      const id = 123;
      const type = "Position";

      await localHooks.callHook("component:removed", id, type);

      expect(callback).toHaveBeenCalledWith(id, type);
    });

    it("should call component:update hook", async () => {
      const callback = vi.fn();
      localHooks.hook("component:update", callback);

      const id = 123;
      const type = "Position";
      const data = { x: 10, y: 20 };

      await localHooks.callHook("component:update", id, type, data);

      expect(callback).toHaveBeenCalledWith(id, type, data);
    });
  });

  describe("Engine lifecycle hooks", () => {
    it("should call engine:start hook", async () => {
      const callback = vi.fn();
      hooks.hook("engine:start", callback);

      await hooks.callHook("engine:start");

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should call engine:stop hook", async () => {
      const callback = vi.fn();
      hooks.hook("engine:stop", callback);

      await hooks.callHook("engine:stop");

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should call engine:tick hook with deltaTime", async () => {
      const callback = vi.fn();
      hooks.hook("engine:tick", callback);

      const dt = 0.016;
      await hooks.callHook("engine:tick", dt);

      expect(callback).toHaveBeenCalledWith(dt);
    });
  });

  describe("Scene lifecycle hooks", () => {
    it("should call scene:load hook", async () => {
      const callback = vi.fn();
      localHooks.hook("scene:load", callback);

      const name = "MainMenu";
      await localHooks.callHook("scene:load", name);

      expect(callback).toHaveBeenCalledWith(name);
    });

    it("should call scene:unload hook", async () => {
      const callback = vi.fn();
      localHooks.hook("scene:unload", callback);

      const name = "MainMenu";
      await localHooks.callHook("scene:unload", name);

      expect(callback).toHaveBeenCalledWith(name);
    });
  });

  describe("Custom hooks", () => {
    it("should support custom hooks via index signature", async () => {
      const callback = vi.fn();
      localHooks.hook("physics:collision", callback);

      const eventData = { bodyA: 1, bodyB: 2 };
      await localHooks.callHook("physics:collision", eventData);

      expect(callback).toHaveBeenCalledWith(eventData);
    });
  });

  describe("Hook removal", () => {
    it("should remove a specific hook", async () => {
      const callback = vi.fn();
      const unregister = hooks.hook("entity:spawn", callback);

      unregister();
      await hooks.callHook("entity:spawn", entityId);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("Hook ordering", () => {
    it("should call hooks in registration order", async () => {
      const order: string[] = [];

      hooks.hook("entity:spawn", () => order.push("first"));
      hooks.hook("entity:spawn", () => order.push("second"));
      hooks.hook("entity:spawn", () => order.push("third"));

      await hooks.callHook("entity:spawn", entityId);

      expect(order).toEqual(["first", "second", "third"]);
    });
  });
});
