//! Archetype storage
//!
//! Stores entities with the same set of components in contiguous memory.

use crate::ecs::{BitSet128, ComponentTypeId};
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

    /// Append one row by copying `src_row` from `src`. No intermediate buffer.
    pub fn push_copied(&mut self, src: &ArchetypeColumn, src_row: usize) -> bool {
        if !src.row_ok(src_row) {
            return false;
        }
        if self.element_size == 0 {
            if src.element_size != 0 {
                return false;
            }
            let (start, len) = src.offsets[src_row];
            self.push(&src.data[start..start + len]);
            return true;
        }
        if src.element_size != self.element_size {
            return false;
        }
        let start = src_row * src.element_size;
        self.push(&src.data[start..start + self.element_size]);
        true
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
                // swap_remove copies the last offset into the hole, so later
                // rows are not later in the byte buffer. Shift every other
                // blob that starts at or after the edited end.
                for (index, offset) in self.offsets.iter_mut().enumerate() {
                    if index == row || offset.0 < old_end {
                        continue;
                    }
                    if new_len > old_len {
                        offset.0 += new_len - old_len;
                    } else if offset.0 >= old_len - new_len {
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

    /// True when `row` addresses a stored element.
    pub fn row_ok(&self, row: usize) -> bool {
        if self.element_size == 0 {
            if row >= self.offsets.len() {
                return false;
            }
            let (start, len) = self.offsets[row];
            start.saturating_add(len) <= self.data.len()
        } else {
            let end = row
                .saturating_mul(self.element_size)
                .saturating_add(self.element_size);
            end <= self.data.len()
        }
    }

    /// Remove a row using swap-remove. Returns false before any mutation when `row` is invalid.
    /// Variable-size rows close the hole with `copy_within`: every byte after the hole
    /// shifts down by the removed length. No intermediate buffer is allocated.
    pub fn swap_remove(&mut self, row: usize) -> bool {
        if self.element_size == 0 {
            if !self.row_ok(row) {
                return false;
            }
            let last_row = self.offsets.len() - 1;
            let (rm_start, rm_len) = self.offsets[row];
            let rm_end = rm_start + rm_len;
            self.data.copy_within(rm_end.., rm_start);
            self.data.truncate(self.data.len() - rm_len);
            for offset in &mut self.offsets {
                if offset.0 >= rm_end {
                    offset.0 -= rm_len;
                }
            }
            if row != last_row {
                self.offsets[row] = self.offsets[last_row];
            }
            self.offsets.pop();
            return true;
        }

        if !self.row_ok(row) {
            return false;
        }
        let count = self.data.len() / self.element_size;
        let last_row = count - 1;
        if row != last_row {
            let src = last_row * self.element_size;
            let dst = row * self.element_size;
            self.data.copy_within(src..src + self.element_size, dst);
        }
        self.data.truncate(last_row * self.element_size);
        true
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
    /// Returns `None` before any mutation when a column is missing.
    pub fn add_entity(
        &mut self,
        entity_id: u32,
        component_data: &HashMap<ComponentTypeId, Vec<u8>>,
    ) -> Option<usize> {
        if self.entity_row.contains_key(&entity_id) {
            return None;
        }
        if self.columns.len() != self.component_types.len() {
            return None;
        }
        for type_id in &self.component_types {
            if !component_data.contains_key(type_id) {
                return None;
            }
        }

        let row = self.entities.len();
        self.entities.push(entity_id);
        self.entity_row.insert(entity_id, row);

        for (i, type_id) in self.component_types.iter().enumerate() {
            if let Some(data) = component_data.get(type_id) {
                self.columns[i].push(data);
            }
        }
        Some(row)
    }

    /// True when `entity_id` can be removed without reading past a column.
    pub fn can_remove(&self, entity_id: u32) -> bool {
        let Some(&row) = self.entity_row.get(&entity_id) else {
            return false;
        };
        if row >= self.entities.len() || self.entities.is_empty() {
            return false;
        }
        self.columns.iter().all(|column| column.row_ok(row))
    }

    /// Remove an entity from this archetype using swap-remove.
    /// Returns the swapped entity ID if any (the one that moved into the removed entity's row).
    /// Returns `None` before any mutation when the entity is absent or a column is short.
    pub fn remove_entity(&mut self, entity_id: u32) -> Option<Option<u32>> {
        if !self.can_remove(entity_id) {
            return None;
        }
        let Some(&row) = self.entity_row.get(&entity_id) else {
            return None;
        };
        let last_row = self.entities.len() - 1;
        self.entity_row.remove(&entity_id);

        for column in &mut self.columns {
            column.swap_remove(row);
        }

        if row == last_row {
            self.entities.pop();
            Some(None)
        } else {
            let last_entity = match self.entities.pop() {
                Some(id) => id,
                None => return None,
            };
            self.entities[row] = last_entity;
            self.entity_row.insert(last_entity, row);
            Some(Some(last_entity))
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

#[cfg(test)]
mod tests {
    use super::ArchetypeColumn;

    #[test]
    fn set_after_swap_remove_keeps_the_other_row() {
        let mut column = ArchetypeColumn::new(0);
        column.push(b"aaaa");
        column.push(b"bb");
        column.push(b"cccc");
        assert_eq!(column.swap_remove(0), true);
        column.set(0, b"CCCCCC");
        assert_eq!(column.get(1), b"bb");
        assert_eq!(column.get(0), b"CCCCCC");
        column.set(1, b"b");
        assert_eq!(column.get(0), b"CCCCCC");
        assert_eq!(column.get(1), b"b");
    }
}
