//! Entity management
//!
//! Handles entity spawning, deletion, and tracking using a sparse set with generation counter.

use bytemuck::{Pod, Zeroable};

/// Unique entity identifier with generation counter
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Pod, Zeroable)]
#[repr(C)]
pub struct EntityId {
    index: u32,
    generation: u32,
}

impl EntityId {
    /// Get the index part of the entity ID
    pub fn index(self) -> u32 {
        self.index
    }

    /// Get the generation part for stale ID detection
    pub fn generation(self) -> u32 {
        self.generation
    }

    /// Create an EntityId from index and generation
    pub fn from_parts(index: u32, generation: u32) -> Self {
        EntityId { index, generation }
    }
}

/// Individual entity record
struct EntityRecord {
    generation: u32,
    alive: bool,
}

/// Allocates and tracks entities
pub struct EntityAllocator {
    records: Vec<EntityRecord>,
    free_list: Vec<u32>,
    num_live: u32,
    max_entities: u32,
}

impl EntityAllocator {
    /// Create a new entity allocator with capacity
    pub fn new(max_entities: u32) -> Self {
        EntityAllocator {
            records: Vec::with_capacity(max_entities as usize),
            free_list: Vec::new(),
            num_live: 0,
            max_entities,
        }
    }

    /// Allocate a new entity
    pub fn allocate(&mut self) -> EntityId {
        if let Some(index) = self.free_list.pop() {
            // Reuse deleted entity slot
            let record = &mut self.records[index as usize];
            record.generation = record.generation.wrapping_add(1);
            record.alive = true;
            self.num_live += 1;

            EntityId {
                index,
                generation: record.generation,
            }
        } else if (self.records.len() as u32) < self.max_entities {
            // Allocate new slot
            let index = self.records.len() as u32;
            self.records.push(EntityRecord {
                generation: 0,
                alive: true,
            });
            self.num_live += 1;

            EntityId {
                index,
                generation: 0,
            }
        } else {
            panic!("Entity limit reached: {}", self.max_entities);
        }
    }

    /// Deallocate an entity
    pub fn deallocate(&mut self, id: EntityId) -> bool {
        if id.index >= self.records.len() as u32 {
            return false;
        }

        let record = &mut self.records[id.index as usize];

        // Check generation matches (stale ID detection)
        if record.generation != id.generation {
            return false;
        }

        if !record.alive {
            return false; // Already dead
        }

        record.alive = false;
        self.free_list.push(id.index);
        self.num_live -= 1;
        true
    }

    /// Check if an entity is alive
    pub fn is_alive(&self, id: EntityId) -> bool {
        if id.index >= self.records.len() as u32 {
            return false;
        }

        let record = &self.records[id.index as usize];
        record.alive && record.generation == id.generation
    }

    /// Get count of live entities
    pub fn count_live(&self) -> u32 {
        self.num_live
    }

    /// Get the generation for a slot index (None if out of bounds).
    pub fn get_generation(&self, index: u32) -> Option<u32> {
        self.records.get(index as usize).map(|r| r.generation)
    }

    /// Iterate all live entity IDs
    pub fn iter_live(&self) -> impl Iterator<Item = EntityId> + '_ {
        self.records
            .iter()
            .enumerate()
            .filter(|(_, r)| r.alive)
            .map(|(i, r)| EntityId {
                index: i as u32,
                generation: r.generation,
            })
    }
}

/// Entity manager - manages entity lifecycle
pub struct EntityManager {
    allocator: EntityAllocator,
}

impl EntityManager {
    /// Create a new entity manager
    pub fn new(max_entities: u32) -> Self {
        EntityManager {
            allocator: EntityAllocator::new(max_entities),
        }
    }

    /// Create a new entity
    pub fn create_entity(&mut self) -> EntityId {
        self.allocator.allocate()
    }

    /// Delete an entity
    pub fn delete_entity(&mut self, id: EntityId) -> bool {
        self.allocator.deallocate(id)
    }

    /// Check if entity is alive
    pub fn is_alive(&self, id: EntityId) -> bool {
        self.allocator.is_alive(id)
    }

    /// Get count of live entities
    pub fn count_entities(&self) -> u32 {
        self.allocator.count_live()
    }

    /// Get the generation for a slot index
    pub fn get_generation(&self, index: u32) -> Option<u32> {
        self.allocator.get_generation(index)
    }

    /// Iterate all live entities
    pub fn iter_entities(&self) -> impl Iterator<Item = EntityId> + '_ {
        self.allocator.iter_live()
    }
}
