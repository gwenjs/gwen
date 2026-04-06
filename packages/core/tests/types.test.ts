/**
 * Type Definitions and Validation Tests
 */

import { describe, it, expect } from 'vitest';
import type { EngineConfig, EntityId, Color, Vector2D } from '../src/types';
import { createEntityId } from '../src/types/entity';

describe('Types', () => {
  describe('EntityId', () => {
    it('should be a bigint', () => {
      const id: EntityId = createEntityId(0, 0);
      expect(typeof id).toBe('bigint');
    });
  });

  describe('Vector2D', () => {
    it('should have x and y', () => {
      const v: Vector2D = { x: 10, y: 20 };
      expect(v.x).toBe(10);
      expect(v.y).toBe(20);
    });

    it('should support arithmetic', () => {
      const v1: Vector2D = { x: 10, y: 20 };
      const v2: Vector2D = { x: 5, y: 10 };

      const result: Vector2D = {
        x: v1.x + v2.x,
        y: v1.y + v2.y,
      };

      expect(result.x).toBe(15);
      expect(result.y).toBe(30);
    });
  });

  describe('Color', () => {
    it('should have RGBA components', () => {
      const color: Color = { r: 1, g: 0.5, b: 0, a: 1 };
      expect(color.r).toBe(1);
      expect(color.g).toBe(0.5);
      expect(color.b).toBe(0);
      expect(color.a).toBe(1);
    });

    it('should support color constants', () => {
      const red: Color = { r: 1, g: 0, b: 0, a: 1 };
      const green: Color = { r: 0, g: 1, b: 0, a: 1 };
      const blue: Color = { r: 0, g: 0, b: 1, a: 1 };

      expect(red.r).toBe(1);
      expect(green.g).toBe(1);
      expect(blue.b).toBe(1);
    });
  });

  describe('EngineConfig', () => {
    it('should have engine config fields', () => {
      const config: EngineConfig = {
        maxEntities: 5000,
        targetFPS: 60,
      };

      expect(config.maxEntities).toBe(5000);
      expect(config.targetFPS).toBe(60);
    });

    it('should have optional debug and stats fields', () => {
      const config: EngineConfig = {
        maxEntities: 5000,
        targetFPS: 60,
        debug: true,
        enableStats: true,
      };

      expect(config.debug).toBe(true);
      expect(config.enableStats).toBe(true);
    });

    it('should accept minimal config', () => {
      const config: EngineConfig = {
        maxEntities: 1000,
        targetFPS: 60,
      };
      expect(config).toBeDefined();
    });
  });

  describe('Type Safety', () => {
    it('should enforce Color type constraints', () => {
      const color: Color = { r: 1, g: 0, b: 0, a: 1 };
      expect(color.r).toBe(1);
      expect(color.g).toBe(0);
      expect(color.b).toBe(0);
      expect(color.a).toBe(1);
    });

    it('should enforce Vector2D type constraints', () => {
      const vec: Vector2D = { x: 10, y: 20 };
      expect(vec.x).toBe(10);
      expect(vec.y).toBe(20);
    });
  });
});
