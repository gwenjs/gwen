//! Sparse Dirty Set for efficient tracking of modified entities.
//!
//! Provides O(1) add, O(1) check, and O(D) iteration where D is the number of dirty entities.

/// A sparse set tracking dirty entities.
pub struct DirtySet {
    /// Maps entity_index -> index in the dense array.
    /// If sparse[idx] < dense.len() and dense[sparse[idx]] == idx, the entity is dirty.
    sparse: Vec<u32>,
    /// List of dirty entity indices.
    dense: Vec<u32>,
}

impl DirtySet {
    /// Create a new DirtySet with the given initial capacity.
    pub fn new(capacity: u32) -> Self {
        DirtySet {
            sparse: vec![u32::MAX; capacity as usize],
            dense: Vec::with_capacity(64),
        }
    }

    /// Mark an entity as dirty.
    #[inline]
    pub fn mark_dirty(&mut self, entity_id: u32) {
        let idx = entity_id as usize;
        if idx >= self.sparse.len() {
            self.sparse.resize(idx + 1, u32::MAX);
        }

        let dense_idx = self.sparse[idx];
        if dense_idx < self.dense.len() as u32 && self.dense[dense_idx as usize] == entity_id {
            // Already in the set
            return;
        }

        // Add to dense array
        self.sparse[idx] = self.dense.len() as u32;
        self.dense.push(entity_id);
    }

    /// Check if an entity is marked as dirty.
    #[inline]
    pub fn is_dirty(&self, entity_id: u32) -> bool {
        let idx = entity_id as usize;
        if idx >= self.sparse.len() {
            return false;
        }
        let dense_idx = self.sparse[idx];
        dense_idx < self.dense.len() as u32 && self.dense[dense_idx as usize] == entity_id
    }

    /// Get all dirty entity indices.
    #[inline]
    pub fn dirty_entities(&self) -> &[u32] {
        &self.dense
    }

    /// Clear the dirty set.
    #[inline]
    pub fn clear(&mut self) {
        self.dense.clear();
    }

    /// Get number of dirty entities.
    #[inline]
    pub fn len(&self) -> usize {
        self.dense.len()
    }

    /// Check if the set is empty.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.dense.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dirty_set_basic() {
        let mut ds = DirtySet::new(10);
        assert!(!ds.is_dirty(5));
        
        ds.mark_dirty(5);
        assert!(ds.is_dirty(5));
        assert_eq!(ds.dirty_entities(), &[5]);

        ds.mark_dirty(5); // duplicate
        assert_eq!(ds.dirty_entities(), &[5]);

        ds.mark_dirty(100); // resize
        assert!(ds.is_dirty(100));
        assert_eq!(ds.dirty_entities(), &[5, 100]);

        ds.clear();
        assert!(!ds.is_dirty(5));
        assert!(!ds.is_dirty(100));
        assert!(ds.is_empty());
    }
}
