//! Archetype storage
//!
//! Stores entities with the same set of components in contiguous memory.

use crate::ecs::{ComponentTypeId, BitSet128};
use std::collections::HashMap;

/// Unique identifier for an archetype in the graph.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]
pub struct ArchetypeId(pub u32);

impl ArchetypeId {
    /// Get the raw ID value
    pub fn raw(self) -> u32 {
        self.0
    }
}

/// A single column of component data within an archetype.
pub struct ArchetypeColumn {
    /// Byte size per element (0 = variable-size / JS mode).
    pub(crate) element_size: usize,
    /// Dense byte buffer.
    /// In fixed-size mode, it's a packed array of `element_size` bytes.
    /// In variable-size mode, it's a packed array of arbitrary length blobs.
    pub(crate) data: Vec<u8>,
    /// Byte offsets per slot — only used in variable-size mode.
    pub(crate) offsets: Vec<(usize, usize)>, // (start, len) per slot
}

impl ArchetypeColumn {
    /// Create a new archetype column
    pub fn new(element_size: usize) -> Self {
        ArchetypeColumn {
            element_size,
            data: Vec::new(),
            offsets: Vec::new(),
        }
    }

    /// Add component data for a new entity row.
    pub fn push(&mut self, data: &[u8]) {
        if self.element_size == 0 {
            let start = self.data.len();
            self.data.extend_from_slice(data);
            self.offsets.push((start, data.len()));
        } else {
            debug_assert_eq!(data.len(), self.element_size);
            self.data.extend_from_slice(data);
        }
    }

    /// Update component data for an existing row.
    pub fn set(&mut self, row: usize, data: &[u8]) {
        if self.element_size == 0 {
            let (start, old_len) = self.offsets[row];
            let old_end = start + old_len;
            let new_len = data.len();

            if new_len == old_len {
                self.data[start..old_end].copy_from_slice(data);
            } else {
                self.data.splice(start..old_end, data.iter().copied());
                self.offsets[row] = (start, new_len);
                // Shift subsequent offsets
                for offset in &mut self.offsets[(row + 1)..] {
                    if new_len > old_len {
                        offset.0 += new_len - old_len;
                    } else {
                        offset.0 -= old_len - new_len;
                    }
                }
            }
        } else {
            debug_assert_eq!(data.len(), self.element_size);
            let start = row * self.element_size;
            self.data[start..start + self.element_size].copy_from_slice(data);
        }
    }

    /// Get component data for a row.
    pub fn get(&self, row: usize) -> &[u8] {
        if self.element_size == 0 {
            let (start, len) = self.offsets[row];
            &self.data[start..start + len]
        } else {
            let start = row * self.element_size;
            &self.data[start..start + self.element_size]
        }
    }

    /// Get mutable component data for a row.
    pub fn get_mut(&mut self, row: usize) -> &mut [u8] {
        if self.element_size == 0 {
            let (start, len) = self.offsets[row];
            &mut self.data[start..start + len]
        } else {
            let start = row * self.element_size;
            &mut self.data[start..start + self.element_size]
        }
    }

    /// Remove a row using swap-remove.
    pub fn swap_remove(&mut self, row: usize) {
        let last_row = if self.element_size == 0 {
            self.offsets.len() - 1
        } else {
            (self.data.len() / self.element_size) - 1
        };

        if self.element_size == 0 {
            if row == last_row {
                let (start, _len) = self.offsets.pop().unwrap();
                self.data.truncate(start);
            } else {
                let (rm_start, rm_len) = self.offsets[row];
                let (last_start, last_len) = self.offsets[last_row];

                // Replace data at `row` with data from `last_row`
                let last_data = self.data[last_start..last_start + last_len].to_vec();
                
                // This is slightly inefficient but safe for variable size swap-remove
                self.data.splice(rm_start..rm_start + rm_len, last_data);
                
                self.offsets[row] = (rm_start, last_len);
                self.offsets.pop();

                // Shift offsets between row and last_row
                let diff = last_len as i32 - rm_len as i32;
                if diff != 0 {
                    for offset in &mut self.offsets[(row + 1)..] {
                        if diff > 0 {
                            offset.0 += diff as usize;
                        } else {
                            offset.0 -= (-diff) as usize;
                        }
                    }
                }
                self.data.truncate(self.data.len() - rm_len);
            }
        } else if row == last_row {
            self.data.truncate(row * self.element_size);
        } else {
            let src = last_row * self.element_size;
            let dst = row * self.element_size;
            for i in 0..self.element_size {
                self.data[dst + i] = self.data[src + i];
            }
            self.data.truncate(last_row * self.element_size);
        }
    }
}

/// An archetype = a fixed set of components + dense SoA storage.
pub struct Archetype {
    pub(crate) id: ArchetypeId,
    /// Component matching mask.
    pub(crate) mask: BitSet128,
    /// Sorted list of component types in this archetype.
    pub(crate) component_types: Vec<ComponentTypeId>,
    /// Dense array of entity indices stored in this archetype.
    pub(crate) entities: Vec<u32>,
    /// One column per component type. Index matches `component_types`.
    pub(crate) columns: Vec<ArchetypeColumn>,
    /// Maps entity_index → row in `entities` and columns.
    pub(crate) entity_row: HashMap<u32, usize>,
}

impl Archetype {
    /// Create a new archetype
    pub fn new(
        id: ArchetypeId,
        mut component_types: Vec<ComponentTypeId>,
        element_sizes: &HashMap<ComponentTypeId, usize>,
        bit_indices: &HashMap<ComponentTypeId, u8>,
    ) -> Self {
        component_types.sort();
        let mut mask = BitSet128::new();
        for &type_id in &component_types {
            if let Some(&bit_idx) = bit_indices.get(&type_id) {
                mask.set(bit_idx);
            }
        }

        let columns = component_types
            .iter()
            .map(|&type_id| {
                let &size = element_sizes.get(&type_id).unwrap_or(&0);
                ArchetypeColumn::new(size)
            })
            .collect();

        Archetype {
            id,
            mask,
            component_types,
            entities: Vec::new(),
            columns,
            entity_row: HashMap::new(),
        }
    }

    /// Add an entity to this archetype.
    /// Caller must provide data for ALL components in the archetype.
    /// `data` map must contain all `self.component_types`.
    pub fn add_entity(&mut self, entity_id: u32, mut component_data: HashMap<ComponentTypeId, Vec<u8>>) -> usize {
        let row = self.entities.len();
        self.entities.push(entity_id);
        self.entity_row.insert(entity_id, row);

        for (i, type_id) in self.component_types.iter().enumerate() {
            let data = component_data.remove(type_id).expect("Missing component data for archetype");
            self.columns[i].push(&data);
        }
        row
    }

    /// Remove an entity from this archetype using swap-remove.
    /// Returns the swapped entity ID if any (the one that moved into the removed entity's row).
    pub fn remove_entity(&mut self, entity_id: u32) -> Option<u32> {
        let row = self.entity_row.remove(&entity_id)?;
        let last_row = self.entities.len() - 1;

        for column in &mut self.columns {
            column.swap_remove(row);
        }

        if row == last_row {
            self.entities.pop();
            None
        } else {
            let last_entity = self.entities.pop().unwrap();
            self.entities[row] = last_entity;
            self.entity_row.insert(last_entity, row);
            Some(last_entity)
        }
    }

    /// Get the row index for an entity.
    pub fn row(&self, entity_id: u32) -> Option<usize> {
        self.entity_row.get(&entity_id).copied()
    }

    /// Check if this archetype has a component type.
    pub fn has_component(&self, type_id: ComponentTypeId) -> bool {
        self.component_types.binary_search(&type_id).is_ok()
    }

    /// Get component data for an entity.
    pub fn get_component(&self, row: usize, type_id: ComponentTypeId) -> Option<&[u8]> {
        let col_idx = self.component_types.binary_search(&type_id).ok()?;
        Some(self.columns[col_idx].get(row))
    }

    /// Get mutable component data for an entity.
    pub fn get_component_mut(&mut self, row: usize, type_id: ComponentTypeId) -> Option<&mut [u8]> {
        let col_idx = self.component_types.binary_search(&type_id).ok()?;
        Some(self.columns[col_idx].get_mut(row))
    }

    /// Get all component types in this archetype.
    pub fn component_types(&self) -> &[ComponentTypeId] {
        &self.component_types
    }

    /// Get number of entities in this archetype.
    pub fn len(&self) -> usize {
        self.entities.len()
    }

    /// Check if archetype is empty.
    pub fn is_empty(&self) -> bool {
        self.entities.is_empty()
    }
}
