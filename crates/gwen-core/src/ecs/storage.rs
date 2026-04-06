//! Archetype Storage
//!
//! Replaces ComponentStorage with an archetype-based implementation.

use crate::ecs::archetype::{Archetype, ArchetypeId};
use crate::ecs::archetype_graph::ArchetypeGraph;
use crate::ecs::component::{ComponentRegistry, ComponentTypeId};
use crate::ecs::bitset::BitSet128;
use crate::transform::TRANSFORM_SAB_TYPE_ID;
use std::collections::HashMap;

/// Result of a component modification that might cause archetype migration.
#[derive(Debug, Clone, Default)]
pub struct Migration {
    /// Archetype the entity was in before (if any).
    pub from: Option<ArchetypeId>,
    /// Archetype the entity is in now.
    pub to: ArchetypeId,
}

/// Stores all components for all entities using an Archetype Graph.
pub struct ArchetypeStorage {
    graph: ArchetypeGraph,
    /// Maps entity_index -> (archetype_id, row_in_archetype)
    entity_locations: Vec<Option<(ArchetypeId, usize)>>,
    /// ComponentRegistry for type sizes and names.
    registry: ComponentRegistry,
}

impl ArchetypeStorage {
    /// Create a new archetype storage
    pub fn new() -> Self {
        let registry = ComponentRegistry::new();
        let element_sizes = HashMap::new();
        let bit_indices = HashMap::new();
        ArchetypeStorage {
            graph: ArchetypeGraph::new(&element_sizes, &bit_indices),
            entity_locations: Vec::new(),
            registry,
        }
    }

    /// Register a raw component type by numeric ID and element size.
    pub fn register_raw(&mut self, id: ComponentTypeId, element_size: usize) {
        // We just need to ensure the registry knows about this type.
        // The graph will create archetypes with this size when needed.
        self.registry.register_raw(id, element_size);
    }

    /// Register a new component type
    pub fn register_component_type<T: 'static>(&mut self) -> ComponentTypeId {
        self.registry.register::<T>()
    }

    /// **JS bridge upsert**: add or update a component.
    pub fn upsert_js(&mut self, entity_id: u32, type_id: ComponentTypeId, data: &[u8]) -> Option<Migration> {
        // Ensure registry knows this type as variable size (0) if not already known
        if self.registry.size(type_id).is_none() {
            self.registry.register_raw(type_id, 0);
        }

        self.add_component(entity_id, type_id, data)
    }

    /// Add a component to an entity.
    pub fn add_component(&mut self, entity_id: u32, type_id: ComponentTypeId, data: &[u8]) -> Option<Migration> {
        let (current_archetype_id, current_row) = self.get_location_or_init(entity_id);

        let col_idx = {
            let current_archetype = &self.graph.archetypes[current_archetype_id.0 as usize];
            current_archetype.component_types.binary_search(&type_id).ok()
        };

        if let Some(idx) = col_idx {
            // Update in place — no migration, no allocation
            self.graph.archetypes[current_archetype_id.0 as usize].columns[idx].set(current_row, data);
            return None;
        }

        // Migrate to new archetype — pass registry references (no clone)
        let target_archetype_id = self.graph.get_add_target(
            current_archetype_id,
            type_id,
            self.registry.all_sizes(),
            self.registry.all_bit_indices(),
        );

        // Collect all current component data
        let mut component_data = HashMap::new();
        {
            let current_archetype = &self.graph.archetypes[current_archetype_id.0 as usize];
            for &t_id in &current_archetype.component_types {
                let bytes = current_archetype.get_component(current_row, t_id).unwrap().to_vec();
                component_data.insert(t_id, bytes);
            }
        }

        // Add the new component data
        component_data.insert(type_id, data.to_vec());

        // Remove from old archetype
        if let Some(swapped_entity) = self.graph.get_mut(current_archetype_id).remove_entity(entity_id) {
            // Update location of the entity that was swapped into our old row
            if let Some(Some((arch_id, row))) = self.entity_locations.get_mut(swapped_entity as usize) {
                if *arch_id == current_archetype_id {
                    *row = current_row;
                }
            }
        }

        // Add to new archetype
        let new_row = self.graph.get_mut(target_archetype_id).add_entity(entity_id, component_data);
        self.entity_locations[entity_id as usize] = Some((target_archetype_id, new_row));

        Some(Migration {
            from: Some(current_archetype_id),
            to: target_archetype_id,
        })
    }

    /// Remove component from entity.
    pub fn remove_component(&mut self, entity_id: u32, type_id: ComponentTypeId) -> Option<Migration> {
        let (current_archetype_id, current_row) = self.get_location(entity_id)?;

        let current_archetype = &self.graph.archetypes[current_archetype_id.0 as usize];
        if !current_archetype.has_component(type_id) {
            return None;
        }

        // Migrate to new archetype — pass registry references (no clone)
        let target_archetype_id = self.graph.get_remove_target(
            current_archetype_id,
            type_id,
            self.registry.all_sizes(),
            self.registry.all_bit_indices(),
        );

        // Collect all components except the one being removed
        let mut component_data = HashMap::new();
        {
            let current_archetype = &self.graph.archetypes[current_archetype_id.0 as usize];
            for &t_id in &current_archetype.component_types {
                if t_id != type_id {
                    let bytes = current_archetype.get_component(current_row, t_id).unwrap().to_vec();
                    component_data.insert(t_id, bytes);
                }
            }
        }

        // Remove from old archetype
        if let Some(swapped_entity) = self.graph.get_mut(current_archetype_id).remove_entity(entity_id) {
            if let Some(Some((arch_id, row))) = self.entity_locations.get_mut(swapped_entity as usize) {
                if *arch_id == current_archetype_id {
                    *row = current_row;
                }
            }
        }

        // Add to new archetype
        let new_row = self.graph.get_mut(target_archetype_id).add_entity(entity_id, component_data);
        self.entity_locations[entity_id as usize] = Some((target_archetype_id, new_row));

        Some(Migration {
            from: Some(current_archetype_id),
            to: target_archetype_id,
        })
    }

    /// Get component data from entity
    pub fn get_component(&self, entity_id: u32, type_id: ComponentTypeId) -> Option<&[u8]> {
        let (arch_id, row) = self.get_location(entity_id)?;
        self.graph.get(arch_id).get_component(row, type_id)
    }
    pub fn get_component_mut(&mut self, entity_id: u32, type_id: ComponentTypeId) -> Option<&mut [u8]> {
        let (arch_id, row) = self.get_location(entity_id)?;
        self.graph.get_mut(arch_id).get_component_mut(row, type_id)
    }

    /// Check if entity has component
    pub fn has_component(&self, entity_id: u32, type_id: ComponentTypeId) -> bool {
        let (arch_id, _) = match self.get_location(entity_id) {
            Some(loc) => loc,
            None => return false,
        };
        self.graph.get(arch_id).has_component(type_id)
    }

    /// Remove all components from entity (when entity is deleted).
    pub fn remove_entity(&mut self, entity_id: u32) -> Option<ArchetypeId> {
        if let Some((arch_id, row)) = self.get_location(entity_id) {
            if let Some(swapped_entity) = self.graph.get_mut(arch_id).remove_entity(entity_id) {
                if let Some(Some((a_id, r))) = self.entity_locations.get_mut(swapped_entity as usize) {
                    if *a_id == arch_id {
                        *r = row;
                    }
                }
            }
            self.entity_locations[entity_id as usize] = None;
            Some(arch_id)
        } else {
            None
        }
    }

    /// Helper to get entity location
    fn get_location(&self, entity_id: u32) -> Option<(ArchetypeId, usize)> {
        self.entity_locations.get(entity_id as usize).and_then(|&loc| loc)
    }

    /// Helper to get location or initialize to root archetype
    fn get_location_or_init(&mut self, entity_id: u32) -> (ArchetypeId, usize) {
        let idx = entity_id as usize;
        if idx >= self.entity_locations.len() {
            self.entity_locations.resize(idx + 1, None);
        }

        if let Some(loc) = self.entity_locations[idx] {
            loc
        } else {
            // Start at root archetype (empty)
            let root_id = ArchetypeId(0);
            let row = self.graph.get_mut(root_id).add_entity(entity_id, HashMap::new());
            self.entity_locations[idx] = Some((root_id, row));
            (root_id, row)
        }
    }

    /// Get registry reference
    pub fn registry(&self) -> &ComponentRegistry {
        &self.registry
    }

    /// Get all archetypes matching a query mask.
    pub fn archetypes_matching(&self, mask: BitSet128) -> Vec<ArchetypeId> {
        self.graph.archetypes
            .iter()
            .filter(|arch| {
                arch.mask.contains_all(&mask)
            })
            .map(|arch| arch.id)
            .collect()
    }

    /// Get an archetype by ID.
    pub fn archetype(&self, id: ArchetypeId) -> &Archetype {
        self.graph.get(id)
    }

    // ── Shared Buffer helpers ──────────────

    pub fn get_transform_raw(&self, entity_id: u32) -> Option<&[u8]> {
        let type_id = ComponentTypeId::from_raw(TRANSFORM_SAB_TYPE_ID);
        self.get_component(entity_id, type_id)
    }

    pub fn upsert_transform_raw(&mut self, entity_id: u32, data: &[u8]) {
        let type_id = ComponentTypeId::from_raw(TRANSFORM_SAB_TYPE_ID);
        self.upsert_js(entity_id, type_id, data);
    }
}

impl Default for ArchetypeStorage {
    fn default() -> Self {
        Self::new()
    }
}
