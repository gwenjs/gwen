//! Transform component - Hierarchical entity transforms

// ── Shared memory layout constants (single source of truth for TS ↔ Rust) ────
//
// These values MUST match the TypeScript constants in:
//   packages/@gwenjs/engine-core/src/wasm/shared-memory.ts
//
// Run `node scripts/verify-memory-layout.mjs` to verify consistency.

/// Bytes per entity slot in the shared 2D transform buffer.
///
/// Layout: pos_x(4) + pos_y(4) + rotation(4) + scale_x(4) + scale_y(4) + flags(4) + reserved(8) = 32
pub const TRANSFORM_STRIDE: usize = 32;

/// Bytes per entity slot in the shared 3D transform buffer.
///
/// Layout: pos(12) + quat(16) + scale(12) + flags(4) + reserved(4) = 48
pub const TRANSFORM3D_STRIDE: usize = 48;

/// Byte offset of the `flags` field within a 2D entity slot.
pub const FLAGS_OFFSET: usize = 20;

/// Byte offset of the `flags` field within a 3D entity slot.
pub const FLAGS3D_OFFSET: usize = 40;

/// Sentinel component type ID used to identify the transform SAB column.
///
/// This value is chosen to be far outside the normal type-ID range so it
/// never collides with a user-registered component type.
/// Must stay in sync with the TypeScript side: `TRANSFORM_SAB_TYPE_ID` in
/// `packages/core/src/engine/wasm-bridge.ts`.
pub const TRANSFORM_SAB_TYPE_ID: u32 = u32::MAX - 1;

use crate::entity::EntityId;
use crate::transform_math::{Mat3, Vec2};
use bytemuck::{Pod, Zeroable};
use std::collections::HashMap;

/// 2D Transform component for entities (Plain Old Data)
///
/// This struct contains only the local transform data (position, rotation, scale)
/// and is designed to be stored in the ECS component storage with zero-copy safety.
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct Transform {
    /// Local position relative to parent
    pub position: Vec2,
    /// Local rotation in radians
    pub rotation: f32,
    /// Local scale
    pub scale: Vec2,
}

impl Transform {
    /// Create new local transform
    pub const fn new(position: Vec2, rotation: f32, scale: Vec2) -> Self {
        Transform {
            position,
            rotation,
            scale,
        }
    }

    /// Default identity transform (origin, no rotation, scale 1)
    pub const fn identity() -> Self {
        Transform {
            position: Vec2::zero(),
            rotation: 0.0,
            scale: Vec2::one(),
        }
    }

    /// Alias for identity transform (for backward compatibility in tests)
    pub fn default_transform() -> Self {
        Self::identity()
    }

    /// Get local position
    pub fn position(&self) -> Vec2 {
        self.position
    }

    /// Set local position
    pub fn set_position(&mut self, position: Vec2) {
        self.position = position;
    }

    /// Get local rotation
    pub fn rotation(&self) -> f32 {
        self.rotation
    }

    /// Set local rotation
    pub fn set_rotation(&mut self, rotation: f32) {
        self.rotation = rotation;
    }

    /// Get local scale
    pub fn scale(&self) -> Vec2 {
        self.scale
    }

    /// Set local scale
    pub fn set_scale(&mut self, scale: Vec2) {
        self.scale = scale;
    }
}

impl Default for Transform {
    fn default() -> Self {
        Self::identity()
    }
}

/// Internal node for hierarchical transforms
///
/// This struct wraps a POD `Transform` and adds hierarchy metadata and cached world transforms.
/// It is managed by the `TransformSystem`.
#[derive(Debug, Clone)]
pub struct TransformNode {
    /// Local transform (relative to parent)
    pub local: Transform,

    // Cached world transform
    world_position: Vec2,
    world_rotation: f32,
    world_scale: Vec2,
    world_matrix: Mat3,

    // Hierarchy
    parent: Option<EntityId>,
    children: Vec<EntityId>,

    // Dirty flag
    dirty: bool,
}

impl TransformNode {
    /// Create new transform node from local transform data
    pub fn new(local: Transform) -> Self {
        TransformNode {
            local,
            world_position: local.position,
            world_rotation: local.rotation,
            world_scale: local.scale,
            world_matrix: Mat3::transform(local.position, local.rotation, local.scale),
            parent: None,
            children: Vec::new(),
            dirty: true,
        }
    }

    /// Get local position
    pub fn position(&self) -> Vec2 {
        self.local.position
    }

    /// Set local position
    pub fn set_position(&mut self, position: Vec2) {
        self.local.position = position;
        self.dirty = true;
    }

    /// Get local rotation
    pub fn rotation(&self) -> f32 {
        self.local.rotation
    }

    /// Set local rotation
    pub fn set_rotation(&mut self, rotation: f32) {
        self.local.rotation = rotation;
        self.dirty = true;
    }

    /// Get local scale
    pub fn scale(&self) -> Vec2 {
        self.local.scale
    }

    /// Set local scale
    pub fn set_scale(&mut self, scale: Vec2) {
        self.local.scale = scale;
        self.dirty = true;
    }

    /// Get world position
    pub fn world_position(&self) -> Vec2 {
        self.world_position
    }

    /// Get world rotation
    pub fn world_rotation(&self) -> f32 {
        self.world_rotation
    }

    /// Get world scale
    pub fn world_scale(&self) -> Vec2 {
        self.world_scale
    }

    /// Get world matrix
    pub fn world_matrix(&self) -> &Mat3 {
        &self.world_matrix
    }

    /// Get parent
    pub fn parent(&self) -> Option<EntityId> {
        self.parent
    }

    /// Get children
    pub fn children(&self) -> &[EntityId] {
        &self.children
    }

    /// Is dirty (needs recalculation)?
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Mark dirty
    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    /// Set parent
    pub fn set_parent(&mut self, parent: Option<EntityId>) {
        self.parent = parent;
        self.dirty = true;
    }

    /// Add child
    pub fn add_child(&mut self, child: EntityId) {
        if !self.children.contains(&child) {
            self.children.push(child);
        }
    }

    /// Remove child
    pub fn remove_child(&mut self, child: EntityId) -> bool {
        if let Some(pos) = self.children.iter().position(|&id| id == child) {
            self.children.remove(pos);
            true
        } else {
            false
        }
    }

    /// Update world transform from parent
    pub(crate) fn update_from_parent(&mut self, parent_matrix: &Mat3) {
        if !self.dirty {
            return;
        }

        // Calculate local matrix
        let local_matrix = Mat3::transform(self.local.position, self.local.rotation, self.local.scale);

        // Calculate world matrix
        self.world_matrix = parent_matrix.multiply(local_matrix);

        // Extract world position from matrix
        self.world_position = Vec2::new(
            self.world_matrix.as_array()[2],
            self.world_matrix.as_array()[5],
        );

        // Extract world rotation and scale
        let m = self.world_matrix.as_array();
        self.world_rotation = (m[3]).atan2(m[0]);
        self.world_scale = Vec2::new(
            (m[0] * m[0] + m[3] * m[3]).sqrt(),
            (m[1] * m[1] + m[4] * m[4]).sqrt(),
        );

        self.dirty = false;
    }

    /// Update as root transform
    pub(crate) fn update_as_root(&mut self) {
        if !self.dirty {
            return;
        }

        self.world_matrix = Mat3::transform(self.local.position, self.local.rotation, self.local.scale);
        self.world_position = self.local.position;
        self.world_rotation = self.local.rotation;
        self.world_scale = self.local.scale;
        self.dirty = false;
    }
}

/// Transform system - manages hierarchical transforms
pub struct TransformSystem {
    transforms: HashMap<EntityId, TransformNode>,
    root_entities: Vec<EntityId>,
    #[allow(dead_code)] // Reserved for future O(1) index lookup
    entity_to_index: HashMap<EntityId, usize>,
    update_order: Vec<EntityId>,
}

impl TransformSystem {
    /// Create new transform system
    pub fn new() -> Self {
        TransformSystem {
            transforms: HashMap::new(),
            root_entities: Vec::new(),
            entity_to_index: HashMap::new(),
            update_order: Vec::new(),
        }
    }

    /// Add transform for entity
    pub fn add_transform(&mut self, entity: EntityId, transform: Transform) {
        let node = TransformNode::new(transform);
        self.transforms.insert(entity, node);
        if self.transforms[&entity].parent().is_none() {
            self.root_entities.push(entity);
        }
        self.rebuild_update_order();
    }

    /// Remove transform for entity
    pub fn remove_transform(&mut self, entity: EntityId) -> Option<Transform> {
        if let Some(node) = self.transforms.remove(&entity) {
            self.root_entities.retain(|&id| id != entity);
            self.rebuild_update_order();
            Some(node.local)
        } else {
            None
        }
    }

    /// Get transform node reference
    pub fn get_transform(&self, entity: EntityId) -> Option<&TransformNode> {
        self.transforms.get(&entity)
    }

    /// Get mutable transform node reference
    pub fn get_transform_mut(&mut self, entity: EntityId) -> Option<&mut TransformNode> {
        self.transforms.get_mut(&entity)
    }

    /// Set parent of entity
    pub fn set_parent(&mut self, entity: EntityId, parent: Option<EntityId>) {
        let old_parent = self.transforms.get(&entity).and_then(|t| t.parent());

        // Remove from old parent
        if let Some(old_p) = old_parent {
            if let Some(parent_transform) = self.transforms.get_mut(&old_p) {
                parent_transform.remove_child(entity);
            }
        }

        // Set new parent
        if let Some(transform) = self.transforms.get_mut(&entity) {
            transform.set_parent(parent);
        }

        // Add to new parent
        if let Some(new_parent) = parent {
            if let Some(parent_transform) = self.transforms.get_mut(&new_parent) {
                parent_transform.add_child(entity);
            }
        } else {
            // Entity is now root
            if !self.root_entities.contains(&entity) {
                self.root_entities.push(entity);
            }
        }

        self.rebuild_update_order();
    }

    /// Update all transforms
    pub fn update(&mut self) {
        let update_order = self.update_order.clone();

        for entity in update_order {
            let (parent, _should_update_as_root) = {
                if let Some(transform) = self.transforms.get(&entity) {
                    (transform.parent(), false)
                } else {
                    (None, false)
                }
            };

            if let Some(parent) = parent {
                // Get parent's world matrix
                let parent_matrix = {
                    if let Some(parent_transform) = self.transforms.get(&parent) {
                        *parent_transform.world_matrix()
                    } else {
                        Mat3::identity()
                    }
                };

                // Update child from parent
                if let Some(transform) = self.transforms.get_mut(&entity) {
                    transform.update_from_parent(&parent_matrix);
                }
            } else {
                // Update as root
                if let Some(transform) = self.transforms.get_mut(&entity) {
                    transform.update_as_root();
                }
            }
        }
    }

    /// Get count of transforms
    pub fn count(&self) -> usize {
        self.transforms.len()
    }

    /// Rebuild update order (depth-first traversal)
    fn rebuild_update_order(&mut self) {
        self.update_order.clear();

        let roots = self.root_entities.clone();
        for root in roots {
            self.traverse_hierarchy(root);
        }
    }

    /// Traverse hierarchy recursively
    fn traverse_hierarchy(&mut self, entity: EntityId) {
        self.update_order.push(entity);

        if let Some(transform) = self.transforms.get(&entity) {
            let children = transform.children().to_vec();
            for child in children {
                self.traverse_hierarchy(child);
            }
        }
    }
}

impl Default for TransformSystem {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entity(id: u32) -> EntityId {
        EntityId::from_parts(id, 0)
    }

    #[test]
    fn test_transform_creation() {
        let t = Transform::default_transform();
        assert_eq!(t.position(), Vec2::zero());
        assert_eq!(t.rotation(), 0.0);
        assert_eq!(t.scale(), Vec2::one());
    }

    #[test]
    fn test_transform_set_position() {
        let mut t = Transform::default_transform();
        t.set_position(Vec2::new(5.0, 10.0));
        assert_eq!(t.position(), Vec2::new(5.0, 10.0));
    }

    #[test]
    fn test_transform_set_rotation() {
        let mut t = Transform::default_transform();
        t.set_rotation(1.57);
        assert!((t.rotation() - 1.57).abs() < 0.01);
    }

    #[test]
    fn test_transform_node_dirty() {
        let mut t = TransformNode::new(Transform::default());
        t.set_position(Vec2::new(5.0, 10.0));
        assert!(t.is_dirty());
    }

    #[test]
    fn test_transform_world_as_root() {
        let mut t = TransformNode::new(Transform::new(Vec2::new(5.0, 10.0), 0.0, Vec2::one()));
        t.update_as_root();

        assert_eq!(t.world_position(), Vec2::new(5.0, 10.0));
        assert_eq!(t.world_rotation(), 0.0);
        assert_eq!(t.world_scale(), Vec2::one());
    }

    #[test]
    fn test_transform_hierarchy_parent_child() {
        let mut ts = TransformSystem::new();

        let parent = entity(1);
        let child = entity(2);

        ts.add_transform(
            parent,
            Transform::new(Vec2::new(10.0, 10.0), 0.0, Vec2::one()),
        );
        ts.add_transform(child, Transform::new(Vec2::new(5.0, 5.0), 0.0, Vec2::one()));

        ts.set_parent(child, Some(parent));
        ts.update();

        if let Some(child_t) = ts.get_transform(child) {
            assert_eq!(child_t.parent(), Some(parent));
        }
    }

    #[test]
    fn test_transform_system_multiple_roots() {
        let mut ts = TransformSystem::new();

        let root1 = entity(1);
        let root2 = entity(2);

        ts.add_transform(root1, Transform::default_transform());
        ts.add_transform(root2, Transform::default_transform());

        assert_eq!(ts.count(), 2);
    }

    #[test]
    fn test_transform_performance_update_100() {
        let mut ts = TransformSystem::new();

        for i in 0..100 {
            let id = entity(i);
            ts.add_transform(id, Transform::default_transform());
        }

        let start = std::time::Instant::now();
        ts.update();
        let elapsed = start.elapsed();

        assert!(elapsed.as_millis() < 10);
    }

    #[test]
    fn test_transform_deep_hierarchy() {
        let mut ts = TransformSystem::new();

        // Create chain: 1 -> 2 -> 3 -> 4 -> 5
        for i in 1..=5 {
            let id = entity(i);
            ts.add_transform(id, Transform::new(Vec2::new(1.0, 1.0), 0.0, Vec2::one()));

            if i > 1 {
                ts.set_parent(id, Some(entity(i - 1)));
            }
        }

        ts.update();

        if let Some(t5) = ts.get_transform(entity(5)) {
            // Should be (5, 5) = 1+1+1+1+1
            assert!((t5.world_position().x - 5.0).abs() < 0.1);
            assert!((t5.world_position().y - 5.0).abs() < 0.1);
        }
    }
}
