import { describe, it, expect, beforeEach } from 'vitest';
import { Types, defineComponent, computeSchemaLayout } from '../src/schema';
import { GlobalStringPoolManager } from '../src/utils/string-pool';
import type { InferComponent } from '../src/schema';

describe('Types.persistentString DSL', () => {
  beforeEach(() => {
    GlobalStringPoolManager.scene.clear();
    GlobalStringPoolManager.persistent.clear();
  });

  it('should define persistentString type correctly', () => {
    expect(Types.persistentString).toBeDefined();
    expect(Types.persistentString.type).toBe('string');
    expect(Types.persistentString.byteLength).toBe(4);
    expect((Types.persistentString as any).isPersistent).toBe(true);
  });

  it('should infer correct TypeScript type for persistentString', () => {
    const PlayerData = defineComponent({
      name: 'PlayerData',
      schema: {
        playerName: Types.persistentString,
        score: Types.i32,
      },
    });

    // Type inference test (compile-time)
    type PlayerDataType = InferComponent<typeof PlayerData>;
    const data: PlayerDataType = {
      playerName: 'Hero', // Should be string
      score: 100,
    };

    expect(data.playerName).toBe('Hero');
  });

  it('should serialize persistentString to persistent pool', () => {
    const schema = {
      name: Types.persistentString,
      score: Types.i32,
    };

    const layout = computeSchemaLayout(schema);
    const buffer = new ArrayBuffer(layout.byteLength);
    const view = new DataView(buffer);

    const data = { name: 'Alice', score: 999 };
    layout.serialize!(data, view);

    // Verify the string went to persistent pool, not scene pool
    expect(GlobalStringPoolManager.persistent.size).toBe(1);
    expect(GlobalStringPoolManager.scene.size).toBe(0);
  });

  it('should serialize regular string to scene pool', () => {
    const schema = {
      name: Types.string,
      score: Types.i32,
    };

    const layout = computeSchemaLayout(schema);
    const buffer = new ArrayBuffer(layout.byteLength);
    const view = new DataView(buffer);

    const data = { name: 'Bob', score: 500 };
    layout.serialize!(data, view);

    // Verify the string went to scene pool, not persistent pool
    expect(GlobalStringPoolManager.scene.size).toBe(1);
    expect(GlobalStringPoolManager.persistent.size).toBe(0);
  });

  it('should deserialize persistentString from persistent pool', () => {
    const schema = {
      name: Types.persistentString,
      health: Types.f32,
    };

    const layout = computeSchemaLayout(schema);
    const buffer = new ArrayBuffer(layout.byteLength);
    const view = new DataView(buffer);

    // Serialize
    const originalData = { name: 'Charlie', health: 75.5 };
    layout.serialize!(originalData, view);

    // Deserialize
    const deserialized = layout.deserialize!(view);
    expect(deserialized.name).toBe('Charlie');
    expect(deserialized.health).toBeCloseTo(75.5);
  });

  it('should preserve persistentString across scene transitions', () => {
    const schema = {
      playerName: Types.persistentString,
      level: Types.i32,
    };

    const layout = computeSchemaLayout(schema);
    const buffer = new ArrayBuffer(layout.byteLength);
    const view = new DataView(buffer);

    // Serialize data
    const data = { playerName: 'Hero', level: 5 };
    layout.serialize!(data, view);

    // Simulate scene transition (clear scene pool)
    GlobalStringPoolManager.clearScene();

    // Deserialize after transition — should still work
    const deserialized = layout.deserialize!(view);
    expect(deserialized.playerName).toBe('Hero');
    expect(deserialized.level).toBe(5);
  });

  it('should NOT preserve regular string across scene transitions', () => {
    const schema = {
      tempName: Types.string,
      id: Types.i32,
    };

    const layout = computeSchemaLayout(schema);
    const buffer = new ArrayBuffer(layout.byteLength);
    const view = new DataView(buffer);

    // Serialize data
    const data = { tempName: 'Temp', id: 123 };
    layout.serialize!(data, view);

    // Simulate scene transition (clear scene pool)
    GlobalStringPoolManager.clearScene();

    // Deserialize after transition — string ID is now invalid
    const deserialized = layout.deserialize!(view);
    expect(deserialized.tempName).toBe(''); // Empty string (ID not found)
    expect(deserialized.id).toBe(123); // Numeric data survives
  });

  it('should handle mixed string and persistentString in same component', () => {
    const schema = {
      persistentData: Types.persistentString,
      tempData: Types.string,
      value: Types.f32,
    };

    const layout = computeSchemaLayout(schema);
    const buffer = new ArrayBuffer(layout.byteLength);
    const view = new DataView(buffer);

    const data = {
      persistentData: 'KeepMe',
      tempData: 'DiscardMe',
      value: 42.0,
    };

    layout.serialize!(data, view);

    expect(GlobalStringPoolManager.persistent.size).toBe(1);
    expect(GlobalStringPoolManager.scene.size).toBe(1);

    // Clear scene
    GlobalStringPoolManager.clearScene();

    const deserialized = layout.deserialize!(view);
    expect(deserialized.persistentData).toBe('KeepMe'); // Survives
    expect(deserialized.tempData).toBe(''); // Lost
    expect(deserialized.value).toBeCloseTo(42.0); // Numeric survives
  });
});

describe('Schema layout with persistentString — integration', () => {
  beforeEach(() => {
    GlobalStringPoolManager.scene.clear();
    GlobalStringPoolManager.persistent.clear();
  });

  it('should correctly compute layout with persistentString', () => {
    const layout = computeSchemaLayout({
      id: Types.i32,
      name: Types.persistentString,
      score: Types.f32,
    });

    expect(layout.byteLength).toBe(4 + 4 + 4); // i32 + string ID + f32
    expect(layout.hasString).toBe(true);
  });

  it('should serialize and deserialize full component with persistentString', () => {
    const PlayerSave = defineComponent({
      name: 'PlayerSave',
      schema: {
        playerId: Types.i32,
        playerName: Types.persistentString,
        highScore: Types.i32,
        lastPlayed: Types.persistentString,
      },
    });

    const layout = computeSchemaLayout(PlayerSave.schema);
    const buffer = new ArrayBuffer(layout.byteLength);
    const view = new DataView(buffer);

    const saveData = {
      playerId: 42,
      playerName: 'Alice',
      highScore: 9999,
      lastPlayed: '2026-03-05',
    };

    // Serialize
    layout.serialize!(saveData, view);

    // Verify both strings went to persistent pool
    expect(GlobalStringPoolManager.persistent.size).toBe(2);
    expect(GlobalStringPoolManager.scene.size).toBe(0);

    // Simulate 10 scene transitions
    for (let i = 0; i < 10; i++) {
      GlobalStringPoolManager.scene.intern(`temp-${i}`);
      GlobalStringPoolManager.clearScene();
    }

    // Deserialize — should still work
    const loaded = layout.deserialize!(view);
    expect(loaded.playerId).toBe(42);
    expect(loaded.playerName).toBe('Alice');
    expect(loaded.highScore).toBe(9999);
    expect(loaded.lastPlayed).toBe('2026-03-05');
  });
});
