/**
 * @file Tests for SAFETY-01 Phase 1 — GwenConfigError and validateEngineConfig.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateEngineConfig } from '../../src/engine/engine-config-validator.js';
import { GwenConfigError } from '../../src/engine/config-error.js';

describe('GwenConfigError', () => {
  it('is an Error instance', () => {
    const err = new GwenConfigError('maxEntities', -1, 'Must be positive');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name property set to GwenConfigError', () => {
    const err = new GwenConfigError('maxEntities', -1, 'Must be positive');
    expect(err.name).toBe('GwenConfigError');
  });

  it('exposes field, value, and hint properties', () => {
    const err = new GwenConfigError('maxEntities', -1, 'Must be positive');
    expect(err.field).toBe('maxEntities');
    expect(err.value).toBe(-1);
    expect(err.hint).toBe('Must be positive');
  });

  it('formats message with field, value, and hint', () => {
    const err = new GwenConfigError('maxEntities', -1, 'Must be positive');
    expect(err.message).toContain('maxEntities');
    expect(err.message).toContain('-1');
    expect(err.message).toContain('Must be positive');
  });
});

describe('validateEngineConfig — maxEntities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('invalid values — must throw', () => {
    it('throws on maxEntities: 0', () => {
      expect(() => validateEngineConfig({ maxEntities: 0 })).toThrow(GwenConfigError);
      try {
        validateEngineConfig({ maxEntities: 0 });
      } catch (err) {
        const e = err as GwenConfigError;
        expect(e.field).toBe('maxEntities');
      }
    });

    it('throws on maxEntities: -1', () => {
      expect(() => validateEngineConfig({ maxEntities: -1 })).toThrow(GwenConfigError);
    });

    it('throws on maxEntities: 1.5 (not integer)', () => {
      expect(() => validateEngineConfig({ maxEntities: 1.5 })).toThrow(GwenConfigError);
    });

    it('throws on maxEntities: NaN', () => {
      expect(() => validateEngineConfig({ maxEntities: NaN })).toThrow(GwenConfigError);
    });

    it('throws on maxEntities: 2_000_001 (exceeds upper bound)', () => {
      expect(() => validateEngineConfig({ maxEntities: 2_000_001 })).toThrow(GwenConfigError);
    });
  });

  describe('unusual values — must warn only', () => {
    it('warns on maxEntities: 600_000 but does not throw', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => validateEngineConfig({ maxEntities: 600_000 })).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('valid values — must not throw', () => {
    it('accepts maxEntities: 1 (minimum valid)', () => {
      expect(() => validateEngineConfig({ maxEntities: 1 })).not.toThrow();
    });

    it('accepts maxEntities: 2_000_000 (maximum valid)', () => {
      expect(() => validateEngineConfig({ maxEntities: 2_000_000 })).not.toThrow();
    });

    it('accepts maxEntities: 10_000 (typical)', () => {
      expect(() => validateEngineConfig({ maxEntities: 10_000 })).not.toThrow();
    });
  });
});

describe('validateEngineConfig — targetFPS', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('invalid values — must throw', () => {
    it('throws on targetFPS: 0', () => {
      expect(() => validateEngineConfig({ targetFPS: 0 })).toThrow(GwenConfigError);
      try {
        validateEngineConfig({ targetFPS: 0 });
      } catch (err) {
        const e = err as GwenConfigError;
        expect(e.field).toBe('targetFPS');
      }
    });

    it('throws on targetFPS: 301 (exceeds upper bound)', () => {
      expect(() => validateEngineConfig({ targetFPS: 301 })).toThrow(GwenConfigError);
    });

    it('throws on targetFPS: Infinity', () => {
      expect(() => validateEngineConfig({ targetFPS: Infinity })).toThrow(GwenConfigError);
    });
  });

  describe('unusual values — must warn only', () => {
    it('warns on targetFPS: 200 but does not throw', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => validateEngineConfig({ targetFPS: 200 })).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('valid values — must not throw', () => {
    it('accepts targetFPS: 1 (minimum)', () => {
      expect(() => validateEngineConfig({ targetFPS: 1 })).not.toThrow();
    });

    it('accepts targetFPS: 300 (maximum)', () => {
      expect(() => validateEngineConfig({ targetFPS: 300 })).not.toThrow();
    });

    it('accepts targetFPS: 60 (typical)', () => {
      expect(() => validateEngineConfig({ targetFPS: 60 })).not.toThrow();
    });
  });
});

describe('validateEngineConfig — maxDeltaSeconds', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('invalid values — must throw', () => {
    it('throws on maxDeltaSeconds: 0 (must be > 0)', () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: 0 })).toThrow(GwenConfigError);
      try {
        validateEngineConfig({ maxDeltaSeconds: 0 });
      } catch (err) {
        const e = err as GwenConfigError;
        expect(e.field).toBe('maxDeltaSeconds');
      }
    });

    it('throws on maxDeltaSeconds: -1', () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: -1 })).toThrow(GwenConfigError);
    });

    it('throws on maxDeltaSeconds: 11 (exceeds upper bound)', () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: 11 })).toThrow(GwenConfigError);
    });

    it('throws on maxDeltaSeconds: Infinity', () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: Infinity })).toThrow(GwenConfigError);
    });

    it('throws on maxDeltaSeconds: NaN', () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: NaN })).toThrow(GwenConfigError);
    });
  });

  describe('valid values — must not throw', () => {
    it('accepts maxDeltaSeconds: 0.01 (minimum practical)', () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: 0.01 })).not.toThrow();
    });

    it('accepts maxDeltaSeconds: 10 (maximum)', () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: 10 })).not.toThrow();
    });

    it('accepts maxDeltaSeconds: 0.1 (default)', () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: 0.1 })).not.toThrow();
    });
  });
});

describe('validateEngineConfig — tweenPoolSize', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('invalid values — must throw', () => {
    it('throws on tweenPoolSize: 0', () => {
      expect(() => validateEngineConfig({ tweenPoolSize: 0 })).toThrow(GwenConfigError);
      try {
        validateEngineConfig({ tweenPoolSize: 0 });
      } catch (err) {
        const e = err as GwenConfigError;
        expect(e.field).toBe('tweenPoolSize');
      }
    });

    it('throws on tweenPoolSize: 1.5 (not integer)', () => {
      expect(() => validateEngineConfig({ tweenPoolSize: 1.5 })).toThrow(GwenConfigError);
    });
  });

  describe('unusual values — must warn only', () => {
    it('warns on tweenPoolSize: 5000 but does not throw', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => validateEngineConfig({ tweenPoolSize: 5000 })).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('valid values — must not throw', () => {
    it('accepts tweenPoolSize: 1 (minimum)', () => {
      expect(() => validateEngineConfig({ tweenPoolSize: 1 })).not.toThrow();
    });

    it('accepts tweenPoolSize: 4096 (maximum)', () => {
      expect(() => validateEngineConfig({ tweenPoolSize: 4096 })).not.toThrow();
    });

    it('accepts tweenPoolSize: 256 (default)', () => {
      expect(() => validateEngineConfig({ tweenPoolSize: 256 })).not.toThrow();
    });
  });

  it('does not validate tweenPoolSize if undefined', () => {
    expect(() => validateEngineConfig({})).not.toThrow();
    expect(() => validateEngineConfig({ tweenPoolSize: undefined })).not.toThrow();
  });
});

describe('validateEngineConfig — all fields optional', () => {
  it('accepts empty config object', () => {
    expect(() => validateEngineConfig({})).not.toThrow();
  });

  it('accepts partial config', () => {
    expect(() => validateEngineConfig({ maxEntities: 1000 })).not.toThrow();
  });

  it('accepts mixed valid fields', () => {
    expect(() =>
      validateEngineConfig({
        maxEntities: 10_000,
        targetFPS: 60,
        maxDeltaSeconds: 0.1,
        tweenPoolSize: 256,
      }),
    ).not.toThrow();
  });
});

describe('validateEngineConfig — multiple field validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws on first invalid field encountered', () => {
    expect(() =>
      validateEngineConfig({
        maxEntities: -1,
        targetFPS: 0,
      }),
    ).toThrow(GwenConfigError);
  });

  it('does not warn when field is invalid (only throws)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => validateEngineConfig({ maxEntities: -1 })).toThrow(GwenConfigError);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
