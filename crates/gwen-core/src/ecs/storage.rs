//! Archetype Storage
//!
//! Replaces ComponentStorage with an archetype-based implementation.

use crate::ecs::archetype::{Archetype, ArchetypeId};
use crate::ecs::archetype_graph::ArchetypeGraph;
use crate::ecs::bitset::BitSet128;
use crate::ecs::component::{ComponentRegistry, ComponentTypeId};
use crate::ecs::error::CoreError;
use crate::transform::TRANSFORM_SAB_TYPE_ID;
use std::collections::HashMap;

/// Outcome of one component write. `Rejected` means nothing was mutated.
#[derive(Debug)]
pub enum ColumnMove {
    /// The component was already present and its bytes were overwritten.
    InPlace,
    /// The entity moved to another archetype.
    Migrated(Migration),
    /// The row was inconsistent. No column was written.
    Rejected,
}

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
    pub fn register_raw(
        &mut self,
        id: ComponentTypeId,
        element_size: usize,
    ) -> Result<(), CoreError> {
        // We just need to ensure the registry knows about this type.
        // The graph will create archetypes with this size when needed.
        self.registry.register_raw(id, element_size)
    }

    /// Register a new component type
    pub fn register_component_type<T: 'static>(&mut self) -> ComponentTypeId {
        self.registry.register::<T>()
    }

    /// **JS bridge upsert**: add or update a component.
    ///
    /// A new type id past the 128 cap returns an error before any write.
    pub fn upsert_js(
        &mut self,
        entity_id: u32,
        type_id: ComponentTypeId,
        data: &[u8],
    ) -> Result<ColumnMove, CoreError> {
        // Ensure registry knows this type as variable size (0) if not already known
        if self.registry.size(type_id).is_none() {
            self.registry.register_raw(type_id, 0)?;
        }

        Ok(self.add_component(entity_id, type_id, data))
    }

    /// Add a component to an entity.
    pub fn add_component(
        &mut self,
        entity_id: u32,
        type_id: ComponentTypeId,
        data: &[u8],
    ) -> ColumnMove {
        let (current_archetype_id, current_row) = self.get_location_or_init(entity_id);

        let col_idx = {
            let current_archetype = &self.graph.archetypes[current_archetype_id.0 as usize];
            current_archetype
                .component_types
                .binary_search(&type_id)
                .ok()
        };

        if let Some(idx) = col_idx {
            let arch = &self.graph.archetypes[current_archetype_id.0 as usize];
            let Some(column) = arch.columns.get(idx) else {
                return ColumnMove::Rejected;
            };
            if !column.row_ok(current_row) {
                return ColumnMove::Rejected;
            }
            if column.element_size != 0 && data.len() != column.element_size {
                return ColumnMove::Rejected;
            }
            self.graph.archetypes[current_archetype_id.0 as usize].columns[idx]
                .set(current_row, data);
            return ColumnMove::InPlace;
        }

        let target_archetype_id = self.graph.get_add_target(
            current_archetype_id,
            type_id,
            self.registry.all_sizes(),
            self.registry.all_bit_indices(),
        );

        if self.move_row(
            entity_id,
            current_archetype_id,
            current_row,
            target_archetype_id,
            Some((type_id, data)),
        ) {
            ColumnMove::Migrated(Migration {
                from: Some(current_archetype_id),
                to: target_archetype_id,
            })
        } else {
            ColumnMove::Rejected
        }
    }

    /// Remove component from entity.
    pub fn remove_component(
        &mut self,
        entity_id: u32,
        type_id: ComponentTypeId,
    ) -> Option<Migration> {
        let (current_archetype_id, current_row) = self.get_location(entity_id)?;

        let current_archetype = &self.graph.archetypes[current_archetype_id.0 as usize];
        if !current_archetype.has_component(type_id) {
            return None;
        }

        let target_archetype_id = self.graph.get_remove_target(
            current_archetype_id,
            type_id,
            self.registry.all_sizes(),
            self.registry.all_bit_indices(),
        );

        if self.move_row(
            entity_id,
            current_archetype_id,
            current_row,
            target_archetype_id,
            None,
        ) {
            Some(Migration {
                from: Some(current_archetype_id),
                to: target_archetype_id,
            })
        } else {
            None
        }
    }

    /// Get component data from entity
    pub fn get_component(&self, entity_id: u32, type_id: ComponentTypeId) -> Option<&[u8]> {
        let (arch_id, row) = self.get_location(entity_id)?;
        self.graph.get(arch_id).get_component(row, type_id)
    }
    pub fn get_component_mut(
        &mut self,
        entity_id: u32,
        type_id: ComponentTypeId,
    ) -> Option<&mut [u8]> {
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
            if let Some(swapped) = self.graph.get_mut(arch_id).remove_entity(entity_id) {
                self.note_swap(arch_id, row, swapped);
            }
            self.entity_locations[entity_id as usize] = None;
            Some(arch_id)
        } else {
            None
        }
    }

    /// Helper to get entity location
    fn get_location(&self, entity_id: u32) -> Option<(ArchetypeId, usize)> {
        self.entity_locations
            .get(entity_id as usize)
            .and_then(|&loc| loc)
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
            let Some(row) = self
                .graph
                .get_mut(root_id)
                .add_entity(entity_id, &HashMap::new())
            else {
                return (root_id, 0);
            };
            self.entity_locations[idx] = Some((root_id, row));
            (root_id, row)
        }
    }

    /// Copy each kept column straight into the target archetype, then swap-remove the source row.
    fn move_row(
        &mut self,
        entity_id: u32,
        from: ArchetypeId,
        from_row: usize,
        to: ArchetypeId,
        added: Option<(ComponentTypeId, &[u8])>,
    ) -> bool {
        if from == to {
            return false;
        }
        let src_i = from.0 as usize;
        let dst_i = to.0 as usize;
        if src_i >= self.graph.archetypes.len() || dst_i >= self.graph.archetypes.len() {
            return false;
        }
        let added_id = added.map(|(id, _)| id);
        {
            let src = &self.graph.archetypes[src_i];
            let dst = &self.graph.archetypes[dst_i];
            if src.entity_row.get(&entity_id).copied() != Some(from_row)
                || !src.can_remove(entity_id)
            {
                return false;
            }
            if dst.entity_row.contains_key(&entity_id) {
                return false;
            }
            if dst.columns.len() != dst.component_types.len() {
                return false;
            }
            if let Some(id) = added_id {
                if dst.component_types.binary_search(&id).is_err() {
                    return false;
                }
            }
            for &tid in &dst.component_types {
                if Some(tid) == added_id {
                    continue;
                }
                let Ok(si) = src.component_types.binary_search(&tid) else {
                    return false;
                };
                let Some(column) = src.columns.get(si) else {
                    return false;
                };
                if !column.row_ok(from_row) {
                    return false;
                }
            }
        }

        let moved = {
            let Some((src, dst)) = split_pair(&mut self.graph.archetypes, src_i, dst_i) else {
                return false;
            };
            let new_row = dst.entities.len();
            dst.entities.push(entity_id);
            dst.entity_row.insert(entity_id, new_row);
            let ncols = dst.component_types.len();
            for i in 0..ncols {
                let tid = dst.component_types[i];
                if Some(tid) == added_id {
                    if let Some((_, bytes)) = added {
                        dst.columns[i].push(bytes);
                    }
                    continue;
                }
                let Ok(si) = src.component_types.binary_search(&tid) else {
                    continue;
                };
                dst.columns[i].push_copied(&src.columns[si], from_row);
            }
            (new_row, src.remove_entity(entity_id))
        };
        let (new_row, swapped) = moved;
        let Some(swapped) = swapped else {
            return false;
        };
        self.note_swap(from, from_row, swapped);
        if (entity_id as usize) < self.entity_locations.len() {
            self.entity_locations[entity_id as usize] = Some((to, new_row));
            true
        } else {
            false
        }
    }

    fn note_swap(&mut self, from: ArchetypeId, from_row: usize, swapped: Option<u32>) {
        let Some(swapped_entity) = swapped else {
            return;
        };
        if let Some(Some((arch_id, row))) = self.entity_locations.get_mut(swapped_entity as usize) {
            if *arch_id == from {
                *row = from_row;
            }
        }
    }

    /// Get registry reference
    pub fn registry(&self) -> &ComponentRegistry {
        &self.registry
    }

    /// Get all archetypes matching a query mask.
    pub fn archetypes_matching(&self, mask: BitSet128) -> Vec<ArchetypeId> {
        self.graph
            .archetypes
            .iter()
            .filter(|arch| arch.mask.contains_all(&mask))
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

    pub fn upsert_transform_raw(
        &mut self,
        entity_id: u32,
        data: &[u8],
    ) -> Result<ColumnMove, CoreError> {
        let type_id = ComponentTypeId::from_raw(TRANSFORM_SAB_TYPE_ID);
        self.upsert_js(entity_id, type_id, data)
    }
}

fn split_pair(
    arches: &mut [crate::ecs::archetype::Archetype],
    src: usize,
    dst: usize,
) -> Option<(
    &mut crate::ecs::archetype::Archetype,
    &mut crate::ecs::archetype::Archetype,
)> {
    if src == dst || src >= arches.len() || dst >= arches.len() {
        return None;
    }
    if src < dst {
        let (left, right) = arches.split_at_mut(dst);
        Some((&mut left[src], &mut right[0]))
    } else {
        let (left, right) = arches.split_at_mut(src);
        Some((&mut right[0], &mut left[dst]))
    }
}

impl Default for ArchetypeStorage {
    fn default() -> Self {
        Self::new()
    }
}
