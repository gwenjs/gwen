import { describe, expect, it } from 'vitest';
import * as queries from '../src/helpers-queries';
import * as movement from '../src/helpers-movement';
import * as contact from '../src/helpers-contact';
import * as geometry from '../src/helpers-static-geometry';
import * as orchestration from '../src/helpers-orchestration';

describe('helpers domain entries', () => {
  it('should expose queries helpers', () => {
    expect(typeof queries.getBodySnapshot).toBe('function');
    expect(typeof queries.getSpeed).toBe('function');
    expect(typeof queries.isSensorActive).toBe('function');
  });

  it('should expose movement helpers', () => {
    expect(typeof movement.moveKinematicByVelocity).toBe('function');
    expect(typeof movement.applyDirectionalImpulse).toBe('function');
  });

  it('should expose contact helpers', () => {
    expect(typeof contact.selectContactsForEntityId).toBe('function');
    expect(typeof contact.selectResolvedContactsForEntityId).toBe('function');
    expect(typeof contact.getEntityCollisionContacts).toBe('function');
    expect(typeof contact.dedupeContactsByPair).toBe('function');
    expect(typeof contact.toResolvedContacts).toBe('function');
  });

  it('should expose static geometry helpers', () => {
    expect(typeof geometry.buildStaticGeometryChunk).toBe('function');
    expect(typeof geometry.loadStaticGeometryChunk).toBe('function');
  });

  it('should expose orchestration helpers', () => {
    expect(typeof orchestration.createTilemapChunkOrchestrator).toBe('function');
  });
});
