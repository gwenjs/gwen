/**
 * Tests for the Hooks system
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGwenHooks } from '../src/hooks';

describe('GwenHooks', () => {
  let hooks: ReturnType<typeof createGwenHooks>;

  beforeEach(() => {
    hooks = createGwenHooks();
  });

  describe('Basic hook registration', () => {
    it('should register and call a simple hook', async () => {
      const callback = vi.fn();
      hooks.hook('engine:init', callback);

      await hooks.callHook('engine:init');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should pass arguments to hook handlers', async () => {
      const callback = vi.fn();
      hooks.hook('entity:create', callback);

      await hooks.callHook('entity:create', 42);

      expect(callback).toHaveBeenCalledWith(42);
    });

    it('should handle multiple hooks on same event', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      hooks.hook('entity:create', callback1);
      hooks.hook('entity:create', callback2);

      await hooks.callHook('entity:create', 42);

      expect(callback1).toHaveBeenCalledWith(42);
      expect(callback2).toHaveBeenCalledWith(42);
    });
  });

  describe('Plugin lifecycle hooks', () => {
    it('should call plugin:init hook', async () => {
      const callback = vi.fn();
      hooks.hook('plugin:init', callback);

      const mockPlugin = { name: 'TestPlugin' };
      const mockAPI = {};

      await hooks.callHook('plugin:init', mockPlugin, mockAPI);

      expect(callback).toHaveBeenCalledWith(mockPlugin, mockAPI);
    });

    it('should call plugin:beforeUpdate hook with api and deltaTime', async () => {
      const callback = vi.fn();
      hooks.hook('plugin:beforeUpdate', callback);

      const mockAPI = {};
      const dt = 0.016;

      await hooks.callHook('plugin:beforeUpdate', mockAPI, dt);

      expect(callback).toHaveBeenCalledWith(mockAPI, dt);
    });

    it('should call plugin:update hook', async () => {
      const callback = vi.fn();
      hooks.hook('plugin:update', callback);

      const mockAPI = {};
      const dt = 0.016;

      await hooks.callHook('plugin:update', mockAPI, dt);

      expect(callback).toHaveBeenCalledWith(mockAPI, dt);
    });

    it('should call plugin:render hook', async () => {
      const callback = vi.fn();
      hooks.hook('plugin:render', callback);

      const mockAPI = {};

      await hooks.callHook('plugin:render', mockAPI);

      expect(callback).toHaveBeenCalledWith(mockAPI);
    });

    it('should call plugin:destroy hook', async () => {
      const callback = vi.fn();
      hooks.hook('plugin:destroy', callback);

      const mockPlugin = { name: 'TestPlugin' };

      await hooks.callHook('plugin:destroy', mockPlugin);

      expect(callback).toHaveBeenCalledWith(mockPlugin);
    });
  });

  describe('Entity lifecycle hooks', () => {
    it('should call entity:create hook', async () => {
      const callback = vi.fn();
      hooks.hook('entity:create', callback);

      const id = 123;
      await hooks.callHook('entity:create', id);

      expect(callback).toHaveBeenCalledWith(id);
    });

    it('should call entity:destroy hook', async () => {
      const callback = vi.fn();
      hooks.hook('entity:destroy', callback);

      const id = 123;
      await hooks.callHook('entity:destroy', id);

      expect(callback).toHaveBeenCalledWith(id);
    });

    it('should call entity:destroyed hook', async () => {
      const callback = vi.fn();
      hooks.hook('entity:destroyed', callback);

      const id = 123;
      await hooks.callHook('entity:destroyed', id);

      expect(callback).toHaveBeenCalledWith(id);
    });
  });

  describe('Component lifecycle hooks', () => {
    it('should call component:add hook', async () => {
      const callback = vi.fn();
      hooks.hook('component:add', callback);

      const id = 123;
      const type = 'Position';
      const data = { x: 0, y: 0 };

      await hooks.callHook('component:add', id, type, data);

      expect(callback).toHaveBeenCalledWith(id, type, data);
    });

    it('should call component:remove hook', async () => {
      const callback = vi.fn();
      hooks.hook('component:remove', callback);

      const id = 123;
      const type = 'Position';

      await hooks.callHook('component:remove', id, type);

      expect(callback).toHaveBeenCalledWith(id, type);
    });

    it('should call component:removed hook', async () => {
      const callback = vi.fn();
      hooks.hook('component:removed', callback);

      const id = 123;
      const type = 'Position';

      await hooks.callHook('component:removed', id, type);

      expect(callback).toHaveBeenCalledWith(id, type);
    });

    it('should call component:update hook', async () => {
      const callback = vi.fn();
      hooks.hook('component:update', callback);

      const id = 123;
      const type = 'Position';
      const data = { x: 10, y: 20 };

      await hooks.callHook('component:update', id, type, data);

      expect(callback).toHaveBeenCalledWith(id, type, data);
    });
  });

  describe('Engine lifecycle hooks', () => {
    it('should call engine:start hook', async () => {
      const callback = vi.fn();
      hooks.hook('engine:start', callback);

      await hooks.callHook('engine:start');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should call engine:stop hook', async () => {
      const callback = vi.fn();
      hooks.hook('engine:stop', callback);

      await hooks.callHook('engine:stop');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should call engine:tick hook with deltaTime', async () => {
      const callback = vi.fn();
      hooks.hook('engine:tick', callback);

      const dt = 0.016;
      await hooks.callHook('engine:tick', dt);

      expect(callback).toHaveBeenCalledWith(dt);
    });
  });

  describe('Scene lifecycle hooks', () => {
    it('should call scene:load hook', async () => {
      const callback = vi.fn();
      hooks.hook('scene:load', callback);

      const name = 'MainMenu';
      await hooks.callHook('scene:load', name);

      expect(callback).toHaveBeenCalledWith(name);
    });

    it('should call scene:unload hook', async () => {
      const callback = vi.fn();
      hooks.hook('scene:unload', callback);

      const name = 'MainMenu';
      await hooks.callHook('scene:unload', name);

      expect(callback).toHaveBeenCalledWith(name);
    });
  });

  describe('Custom hooks', () => {
    it('should support custom hooks via index signature', async () => {
      const callback = vi.fn();
      hooks.hook('physics:collision' as any, callback);

      const eventData = { bodyA: 1, bodyB: 2 };
      await hooks.callHook('physics:collision' as any, eventData);

      expect(callback).toHaveBeenCalledWith(eventData);
    });
  });

  describe('Hook removal', () => {
    it('should remove a specific hook', async () => {
      const callback = vi.fn();
      const unregister = hooks.hook('entity:create', callback);

      unregister();
      await hooks.callHook('entity:create', 42);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Hook ordering', () => {
    it('should call hooks in registration order', async () => {
      const order: string[] = [];

      hooks.hook('entity:create', () => order.push('first'));
      hooks.hook('entity:create', () => order.push('second'));
      hooks.hook('entity:create', () => order.push('third'));

      await hooks.callHook('entity:create', 42);

      expect(order).toEqual(['first', 'second', 'third']);
    });
  });
});
