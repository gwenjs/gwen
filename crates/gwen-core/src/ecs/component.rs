//! Component storage
//!
//! Stores and retrieves component data using Structure of Arrays (SoA) layout for cache efficiency.

use bytemuck::{Pod, Zeroable};
use std::any::TypeId;
use std::collections::HashMap;

/// Unique identifier for a component type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ComponentTypeId(u32);

impl ComponentTypeId {
    /// Get the raw ID value
    pub fn raw(self) -> u32 {
        self.0
    }

    /// Create from raw ID (for testing)
    pub fn from_raw(raw: u32) -> Self {
        ComponentTypeId(raw)
    }
}

/// Registry for component types
pub struct ComponentRegistry {
    next_id: u32,
    type_sizes: HashMap<ComponentTypeId, usize>,
    type_names: HashMap<ComponentTypeId, String>,
    rust_type_ids: HashMap<TypeId, ComponentTypeId>,
    bit_indices: HashMap<ComponentTypeId, u8>,
    next_bit_index: u8,
}

impl ComponentRegistry {
    /// Create a new component registry
    pub fn new() -> Self {
        ComponentRegistry {
            next_id: 0,
            type_sizes: HashMap::new(),
            type_names: HashMap::new(),
            rust_type_ids: HashMap::new(),
            bit_indices: HashMap::new(),
            next_bit_index: 0,
        }
    }

    /// Register a new component type
    pub fn register<T: 'static>(&mut self) -> ComponentTypeId {
        let rust_type_id = TypeId::of::<T>();

        if let Some(&id) = self.rust_type_ids.get(&rust_type_id) {
            return id;
        }

        let id = ComponentTypeId(self.next_id);
        self.next_id += 1;

        self.type_sizes.insert(id, std::mem::size_of::<T>());
        self.type_names
            .insert(id, std::any::type_name::<T>().to_string());
        self.rust_type_ids.insert(rust_type_id, id);

        self.assign_bit_index(id);

        id
    }

    /// Get size of component type
    pub fn size(&self, type_id: ComponentTypeId) -> Option<usize> {
        self.type_sizes.get(&type_id).copied()
    }

    /// Get bit index of component type
    pub fn bit_index(&self, type_id: ComponentTypeId) -> Option<u8> {
        self.bit_indices.get(&type_id).copied()
    }

    /// Get name of component type
    pub fn name(&self, type_id: ComponentTypeId) -> Option<&str> {
        self.type_names.get(&type_id).map(|s| s.as_str())
    }

    /// Register a raw component type by numeric ID and element size.
    pub fn register_raw(&mut self, id: ComponentTypeId, element_size: usize) {
        self.type_sizes.insert(id, element_size);
        if id.raw() >= self.next_id {
            self.next_id = id.raw() + 1;
        }
        self.assign_bit_index(id);
    }

    /// Get all registered component sizes.
    pub fn all_sizes(&self) -> &HashMap<ComponentTypeId, usize> {
        &self.type_sizes
    }

    /// Get all registered bit indices.
    pub fn all_bit_indices(&self) -> &HashMap<ComponentTypeId, u8> {
        &self.bit_indices
    }

    fn assign_bit_index(&mut self, id: ComponentTypeId) {
        if !self.bit_indices.contains_key(&id) {
            assert!(self.next_bit_index < 128, "Maximum of 128 component types exceeded");
            self.bit_indices.insert(id, self.next_bit_index);
            self.next_bit_index += 1;
        }
    }
}

impl Default for ComponentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

use crate::ecs::storage::ArchetypeStorage;

/// Type-safe component handle
pub struct ComponentHandle<T> {
    type_id: ComponentTypeId,
    _marker: std::marker::PhantomData<T>,
}

impl<T: Pod + Zeroable + Copy + 'static> ComponentHandle<T> {
    /// Create a new component handle and register the type
    pub fn new(storage: &mut ArchetypeStorage) -> Self {
        let type_id = storage.register_component_type::<T>();
        ComponentHandle {
            type_id,
            _marker: std::marker::PhantomData,
        }
    }

    /// Get the component type ID
    pub fn type_id(&self) -> ComponentTypeId {
        self.type_id
    }

    /// Add component to entity
    pub fn add(&self, storage: &mut ArchetypeStorage, entity_id: u32, component: T) -> bool {
        let bytes = bytemuck::bytes_of(&component);
        storage.add_component(entity_id, self.type_id, bytes).is_some()
    }

    /// Get component from entity
    pub fn get<'a>(&self, storage: &'a ArchetypeStorage, entity_id: u32) -> Option<&'a T> {
        storage
            .get_component(entity_id, self.type_id)
            .map(|bytes| bytemuck::from_bytes(bytes))
    }

    /// Get mutable component from entity
    pub fn get_mut<'a>(
        &self,
        storage: &'a mut ArchetypeStorage,
        entity_id: u32,
    ) -> Option<&'a mut T> {
        storage
            .get_component_mut(entity_id, self.type_id)
            .map(|bytes| bytemuck::from_bytes_mut(bytes))
    }

    /// Remove component from entity
    pub fn remove(&self, storage: &mut ArchetypeStorage, entity_id: u32) -> bool {
        storage.remove_component(entity_id, self.type_id).is_some()
    }

    /// Check if entity has component
    pub fn has(&self, storage: &ArchetypeStorage, entity_id: u32) -> bool {
        storage.has_component(entity_id, self.type_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transform::Transform;
    use crate::ecs::storage::ArchetypeStorage;
    use bytemuck::{Pod, Zeroable};

    #[repr(C)]
    #[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
    struct TestVec2 {
        x: f32,
        y: f32,
    }

    #[test]
    fn test_component_handle_roundtrip() {
        let mut storage = ArchetypeStorage::new();
        let handle = ComponentHandle::<TestVec2>::new(&mut storage);
        let entity_id = 42u32;
        let original = TestVec2 { x: 1.5, y: -3.0 };
        handle.add(&mut storage, entity_id, original);
        let retrieved = handle.get(&storage, entity_id).unwrap();
        assert_eq!(*retrieved, original);
    }

    #[test]
    fn test_component_handle_mutation() {
        let mut storage = ArchetypeStorage::new();
        let handle = ComponentHandle::<TestVec2>::new(&mut storage);
        handle.add(&mut storage, 0, TestVec2 { x: 0.0, y: 0.0 });
        let v = handle.get_mut(&mut storage, 0).unwrap();
        v.x = 42.0;
        assert_eq!(handle.get(&storage, 0).unwrap().x, 42.0);
    }

    #[test]
    fn test_transform_is_pod() {
        // Compile-time check: Transform must be Pod + Zeroable
        fn assert_pod<T: Pod + Zeroable>() {}
        assert_pod::<Transform>();
    }

    #[test]
    #[should_panic]
    fn test_size_mismatch_panics() {
        // from_bytes should panic if slice length != size_of::<T>()
        let bytes = [0u8; 4]; // 4 bytes, but TestVec2 needs 8
        let _: &TestVec2 = bytemuck::from_bytes(&bytes);
    }
}
