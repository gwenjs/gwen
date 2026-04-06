//! Archetype Graph
//!
//! Manages transitions between archetypes.

use crate::ecs::archetype::{Archetype, ArchetypeId};
use crate::ecs::ComponentTypeId;
use std::collections::HashMap;

/// The graph of archetypes. Each node is an archetype.
/// The edges represent transitions when adding or removing a component.
pub struct ArchetypeGraph {
    pub(crate) archetypes: Vec<Archetype>,
    /// Cache: (archetype_id, component_to_add) -> target archetype_id
    add_edges: HashMap<(ArchetypeId, ComponentTypeId), ArchetypeId>,
    /// Cache: (archetype_id, component_to_remove) -> target archetype_id
    remove_edges: HashMap<(ArchetypeId, ComponentTypeId), ArchetypeId>,
    /// Maps sorted component set -> archetype_id
    signature_map: HashMap<Vec<ComponentTypeId>, ArchetypeId>,
}

impl ArchetypeGraph {
    /// Create a new archetype graph with an empty root archetype.
    pub fn new(element_sizes: &HashMap<ComponentTypeId, usize>, bit_indices: &HashMap<ComponentTypeId, u8>) -> Self {
        let mut graph = ArchetypeGraph {
            archetypes: Vec::new(),
            add_edges: HashMap::new(),
            remove_edges: HashMap::new(),
            signature_map: HashMap::new(),
        };

        // Create empty root archetype
        graph.get_or_create(&[], element_sizes, bit_indices);
        graph
    }

    /// Get or create an archetype for a given component set.
    pub fn get_or_create(
        &mut self,
        components: &[ComponentTypeId],
        element_sizes: &HashMap<ComponentTypeId, usize>,
        bit_indices: &HashMap<ComponentTypeId, u8>,
    ) -> ArchetypeId {
        let mut sig = components.to_vec();
        sig.sort();

        if let Some(&id) = self.signature_map.get(&sig) {
            return id;
        }

        let id = ArchetypeId(self.archetypes.len() as u32);
        let archetype = Archetype::new(id, sig.clone(), element_sizes, bit_indices);
        self.archetypes.push(archetype);
        self.signature_map.insert(sig, id);
        id
    }

    /// Get target archetype when adding a component.
    pub fn get_add_target(
        &mut self,
        current: ArchetypeId,
        component: ComponentTypeId,
        element_sizes: &HashMap<ComponentTypeId, usize>,
        bit_indices: &HashMap<ComponentTypeId, u8>,
    ) -> ArchetypeId {
        if let Some(&target) = self.add_edges.get(&(current, component)) {
            return target;
        }

        let current_archetype = &self.archetypes[current.0 as usize];
        let mut new_components = current_archetype.component_types.clone();
        if let Err(pos) = new_components.binary_search(&component) {
            new_components.insert(pos, component);
        }

        let target = self.get_or_create(&new_components, element_sizes, bit_indices);
        self.add_edges.insert((current, component), target);
        self.remove_edges.insert((target, component), current);
        target
    }

    /// Get target archetype when removing a component.
    pub fn get_remove_target(
        &mut self,
        current: ArchetypeId,
        component: ComponentTypeId,
        element_sizes: &HashMap<ComponentTypeId, usize>,
        bit_indices: &HashMap<ComponentTypeId, u8>,
    ) -> ArchetypeId {
        if let Some(&target) = self.remove_edges.get(&(current, component)) {
            return target;
        }

        let current_archetype = &self.archetypes[current.0 as usize];
        let mut new_components = current_archetype.component_types.clone();
        if let Ok(pos) = new_components.binary_search(&component) {
            new_components.remove(pos);
        }

        let target = self.get_or_create(&new_components, element_sizes, bit_indices);
        self.remove_edges.insert((current, component), target);
        self.add_edges.insert((target, component), current);
        target
    }

    /// Get an archetype by ID.
    pub fn get(&self, id: ArchetypeId) -> &Archetype {
        &self.archetypes[id.0 as usize]
    }

    /// Get a mutable archetype by ID.
    pub fn get_mut(&mut self, id: ArchetypeId) -> &mut Archetype {
        &mut self.archetypes[id.0 as usize]
    }
}
