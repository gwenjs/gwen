//! Query system
//!
//! Efficient archetype-based queries for entity iteration.

use crate::ecs::component::{ComponentTypeId, ComponentRegistry};
use crate::ecs::storage::ArchetypeStorage;
use crate::ecs::archetype::ArchetypeId;
use crate::ecs::bitset::BitSet128;
use std::collections::HashMap;

/// Query identifier - specifies which components we want
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct QueryId {
    required: Vec<ComponentTypeId>,
    mask: BitSet128,
}

impl QueryId {
    /// Create a query from required component types
    pub fn new(mut required: Vec<ComponentTypeId>, registry: &ComponentRegistry) -> Self {
        required.sort_by_key(|c| c.raw());
        required.dedup();
        
        let mut mask = BitSet128::new();
        for &type_id in &required {
            if let Some(bit_idx) = registry.bit_index(type_id) {
                mask.set(bit_idx);
            }
        }
        
        QueryId { required, mask }
    }

    /// Get the required component types
    pub fn required(&self) -> &[ComponentTypeId] {
        &self.required
    }

    /// Get the bitmask
    pub fn mask(&self) -> BitSet128 {
        self.mask
    }

    /// Check if an archetype matches this query
    pub fn matches(&self, storage: &ArchetypeStorage, archetype_id: ArchetypeId) -> bool {
        let archetype = storage.archetype(archetype_id);
        archetype.mask.contains_all(&self.mask)
    }

    /// Get count of required components
    pub fn len(&self) -> usize {
        self.required.len()
    }

    /// Check if query is empty
    pub fn is_empty(&self) -> bool {
        self.required.is_empty()
    }
}

/// Result of a query - matched entities
#[derive(Debug, Clone)]
pub struct QueryResult {
    entity_ids: Vec<u32>,
    query_id: QueryId,
}

impl QueryResult {
    /// Create empty query result
    pub fn new(query_id: QueryId) -> Self {
        QueryResult {
            entity_ids: Vec::new(),
            query_id,
        }
    }

    /// Add matched entity
    pub fn add_entity(&mut self, entity_id: u32) {
        self.entity_ids.push(entity_id);
    }

    /// Get entity IDs
    pub fn entities(&self) -> &[u32] {
        &self.entity_ids
    }

    /// Get count of matched entities
    pub fn len(&self) -> usize {
        self.entity_ids.len()
    }

    /// Check if result is empty
    pub fn is_empty(&self) -> bool {
        self.entity_ids.is_empty()
    }

    /// Iterate matched entities
    pub fn iter(&self) -> impl Iterator<Item = u32> + '_ {
        self.entity_ids.iter().copied()
    }

    /// Get the query ID
    pub fn query_id(&self) -> &QueryId {
        &self.query_id
    }
}

/// Query system - tracks entity archetypes and executes queries
pub struct QuerySystem {
    query_cache: HashMap<QueryId, QueryResult>,
    /// Maps ArchetypeId -> List of QueryIds that match it.
    /// Used for targeted cache invalidation.
    archetype_to_queries: HashMap<ArchetypeId, Vec<QueryId>>,
}

impl QuerySystem {
    /// Create a new query system
    pub fn new() -> Self {
        QuerySystem {
            query_cache: HashMap::new(),
            archetype_to_queries: HashMap::new(),
        }
    }

    /// Invalidate cache for queries matching the given archetype.
    pub fn on_archetype_change(&mut self, archetype_id: ArchetypeId) {
        if let Some(queries) = self.archetype_to_queries.remove(&archetype_id) {
            for q_id in queries {
                self.query_cache.remove(&q_id);
            }
        }
    }

    /// Invalidate cache when components change.
    pub fn update_entity_archetype(&mut self, _entity_id: u32, _components: Vec<ComponentTypeId>) {
        // Targeted invalidation is now handled via on_archetype_change.
    }

    /// Execute a query against storage
    pub fn query(&mut self, storage: &ArchetypeStorage, query_id: QueryId) -> QueryResult {
        // Check cache first
        if let Some(cached) = self.query_cache.get(&query_id) {
            return cached.clone();
        }

        // Build query result by iterating matching archetypes
        let mut result = QueryResult::new(query_id.clone());
        let matching_archetypes = storage.archetypes_matching(query_id.mask());
        
        for &arch_id in &matching_archetypes {
            let archetype = storage.archetype(arch_id);
            for &entity_id in &archetype.entities {
                result.add_entity(entity_id);
            }
            
            // Populate inverse index for invalidation
            self.archetype_to_queries
                .entry(arch_id)
                .or_default()
                .push(query_id.clone());
        }

        // Cache result
        self.query_cache.insert(query_id, result.clone());
        result
    }

    /// Remove entity from tracking (when deleted).
    pub fn remove_entity(&mut self, _entity_id: u32) {
        // Archetype change will trigger invalidation via on_archetype_change.
    }

    /// Get count of cached queries
    pub fn cache_size(&self) -> usize {
        self.query_cache.len()
    }
}

impl Default for QuerySystem {
    fn default() -> Self {
        Self::new()
    }
}
