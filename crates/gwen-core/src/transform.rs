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

/// Bit 0 of a 2D slot: the slot holds a live transform.
pub const FLAG_HAS_TRANSFORM: u32 = 0b001;

/// Bit 2 of a history slot: the next rendered sample snaps instead of lerping.
///
/// Written only into the two history buffers owned by the engine. Plugin
/// modules never receive those addresses, so the bit is outside the plugin
/// ABI and does not change the plugin ABI number.
pub const FLAG_TELEPORT: u32 = 0b100;

/// Byte offset of the `flags` field within a 3D entity slot.
pub const FLAGS3D_OFFSET: usize = 40;

use crate::ecs::error::CoreError;
use crate::entity::EntityId;
use crate::transform_math::{Mat3, Vec2};
use bytemuck::{Pod, Zeroable};
use rustc_hash::{FxHashMap, FxHashSet};

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
    /// The next stored history slot sets [`FLAG_TELEPORT`], then this clears.
    pending_snap: bool,
    /// This node's world matrix changed since its children last read it: it was
    /// recomputed in the current `update` pass, or by `refresh_root` before it.
    world_changed: bool,
    /// `refresh_root` recomputed this root outside `update`; its children must
    /// follow in the next `update`.
    children_sync_pending: bool,
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
            pending_snap: true,
            world_changed: false,
            children_sync_pending: false,
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

    /// True when this node's world matrix changed since its children last read it
    /// (recomputed in the current `update` pass, or by `refresh_root` before it).
    pub(crate) fn world_changed(&self) -> bool {
        self.world_changed
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

    /// Update world transform from parent.
    ///
    /// Returns `true` when the world matrix was recomputed. Returns `false` when
    /// the node was clean and `parent_changed` is false.
    pub(crate) fn update_from_parent(
        &mut self,
        parent_matrix: &Mat3,
        parent_changed: bool,
    ) -> bool {
        if !(self.dirty || parent_changed) {
            return false;
        }

        // Calculate local matrix
        let local_matrix =
            Mat3::transform(self.local.position, self.local.rotation, self.local.scale);

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
        true
    }

    /// Update as root transform.
    ///
    /// Returns `true` when the world matrix was recomputed, `false` when the node was clean.
    pub(crate) fn update_as_root(&mut self) -> bool {
        if !self.dirty {
            return false;
        }

        self.world_matrix =
            Mat3::transform(self.local.position, self.local.rotation, self.local.scale);
        self.world_position = self.local.position;
        self.world_rotation = self.local.rotation;
        self.world_scale = self.local.scale;
        self.dirty = false;
        true
    }
}

/// Transform system - manages hierarchical transforms
pub struct TransformSystem {
    transforms: FxHashMap<EntityId, TransformNode>,
    root_entities: Vec<EntityId>,
    #[allow(dead_code, reason = "reserved for a future O(1) index lookup")]
    entity_to_index: FxHashMap<EntityId, usize>,
    update_order: Vec<EntityId>,
    /// `update_order` is rebuilt on the next `update`, not on every link change.
    order_dirty: bool,
}

impl TransformSystem {
    /// Create new transform system
    pub fn new() -> Self {
        TransformSystem {
            transforms: FxHashMap::default(),
            root_entities: Vec::new(),
            entity_to_index: FxHashMap::default(),
            update_order: Vec::new(),
            order_dirty: false,
        }
    }

    /// Add transform for entity
    pub fn add_transform(&mut self, entity: EntityId, transform: Transform) {
        let node = TransformNode::new(transform);
        self.transforms.insert(entity, node);
        if self.transforms[&entity].parent().is_none() {
            self.root_entities.push(entity);
        }
        self.order_dirty = true;
    }

    /// Remove `entity`.
    ///
    /// Children become roots; local position and rotation are set from the last
    /// computed (cached) world pose, scale stays local.
    pub fn remove_transform(&mut self, entity: EntityId) -> Option<Transform> {
        let node = self.transforms.remove(&entity)?;
        if let Some(parent_id) = node.parent() {
            if let Some(parent) = self.transforms.get_mut(&parent_id) {
                parent.remove_child(entity);
            }
        }
        self.root_entities.retain(|&id| id != entity);

        for &child_id in node.children() {
            let mut detached = false;
            if let Some(child) = self.transforms.get_mut(&child_id) {
                let world_pos = child.world_position();
                let world_rot = child.world_rotation();
                child.set_parent(None);
                child.set_position(world_pos);
                child.set_rotation(world_rot);
                detached = true;
            }
            if detached && !self.root_entities.contains(&child_id) {
                self.root_entities.push(child_id);
            }
        }

        self.order_dirty = true;
        Some(node.local)
    }

    /// Get transform node reference
    pub fn get_transform(&self, entity: EntityId) -> Option<&TransformNode> {
        self.transforms.get(&entity)
    }

    /// Get mutable transform node reference
    pub fn get_transform_mut(&mut self, entity: EntityId) -> Option<&mut TransformNode> {
        self.transforms.get_mut(&entity)
    }

    /// Set parent of entity.
    ///
    /// Self-parent and cycles return [`CoreError::InvalidParent`] and leave
    /// the hierarchy unchanged. `parent == None` detaches.
    pub fn set_parent(
        &mut self,
        entity: EntityId,
        parent: Option<EntityId>,
    ) -> Result<(), CoreError> {
        if let Some(parent_id) = parent {
            if parent_id == entity || self.subtree_contains(entity, parent_id) {
                return Err(CoreError::InvalidParent {
                    child: entity.index(),
                    parent: parent_id.index(),
                });
            }
        }

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
            if self.transforms.contains_key(&new_parent) {
                self.root_entities.retain(|&id| id != entity);
                if let Some(parent_transform) = self.transforms.get_mut(&new_parent) {
                    parent_transform.add_child(entity);
                }
            }
        } else {
            // Entity is now root
            if !self.root_entities.contains(&entity) {
                self.root_entities.push(entity);
            }
        }

        self.order_dirty = true;
        self.mark_pending_snap(entity);
        Ok(())
    }

    /// The next history commit stores [`FLAG_TELEPORT`] for `entity`.
    ///
    /// Missing node: nothing changes.
    pub fn mark_pending_snap(&mut self, entity: EntityId) {
        if let Some(node) = self.transforms.get_mut(&entity) {
            node.pending_snap = true;
        }
    }

    /// Clears the snap mark after the caller has stored the packed slot.
    pub fn clear_pending_snap(&mut self, entity: EntityId) {
        if let Some(node) = self.transforms.get_mut(&entity) {
            node.pending_snap = false;
        }
    }

    /// Writes the world pose of `entity` into the first 32 bytes of `out`.
    ///
    /// Bit 0 is set. Bit 2 is set while a snap is pending. The mark is left
    /// set; the caller clears it after the bytes are stored. Returns false
    /// when the node is missing or `out` is shorter than one slot, and then
    /// `out` is unchanged.
    pub fn pack_history_slot(&self, entity: EntityId, out: &mut [u8]) -> bool {
        let Some(node) = self.transforms.get(&entity) else {
            return false;
        };
        if out.len() < TRANSFORM_STRIDE {
            return false;
        }
        let mut flags = FLAG_HAS_TRANSFORM;
        if node.pending_snap {
            flags |= FLAG_TELEPORT;
        }
        let position = node.world_position();
        let scale = node.world_scale();
        let mut packed = [0u8; TRANSFORM_STRIDE];
        let stored = store_f32(&mut packed, 0, position.x)
            && store_f32(&mut packed, 4, position.y)
            && store_f32(&mut packed, 8, node.world_rotation())
            && store_f32(&mut packed, 12, scale.x)
            && store_f32(&mut packed, 16, scale.y)
            && store_u32(&mut packed, FLAGS_OFFSET, flags);
        if !stored {
            return false;
        }
        let Some(dest) = out.get_mut(..TRANSFORM_STRIDE) else {
            return false;
        };
        dest.copy_from_slice(&packed);
        true
    }

    /// True when `target` is a strict descendant of `root`.
    fn subtree_contains(&self, root: EntityId, target: EntityId) -> bool {
        let mut stack = Vec::new();
        if let Some(node) = self.transforms.get(&root) {
            stack.extend(node.children().iter().copied());
        }
        let limit = self.transforms.len();
        let mut seen = 0usize;
        while let Some(id) = stack.pop() {
            if id == target {
                return true;
            }
            seen += 1;
            if seen > limit {
                return true;
            }
            if let Some(node) = self.transforms.get(&id) {
                stack.extend(node.children().iter().copied());
            }
        }
        false
    }

    /// Update all transforms.
    ///
    /// A node whose world matrix was recomputed in this pass, or by `refresh_root`
    /// before it, sets `world_changed`.
    /// `update_order` is preorder, so a child reads that flag from the parent
    /// lookup in the same pass. That reaches every depth. Children are not marked dirty.
    pub fn update(&mut self) {
        if self.order_dirty {
            self.rebuild_update_order();
            self.order_dirty = false;
        }
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
                // Parent world matrix and this pass's recompute flag, one lookup.
                let (parent_matrix, parent_changed) = {
                    if let Some(parent_transform) = self.transforms.get(&parent) {
                        (
                            *parent_transform.world_matrix(),
                            parent_transform.world_changed(),
                        )
                    } else {
                        (Mat3::identity(), false)
                    }
                };

                // Update child from parent
                if let Some(transform) = self.transforms.get_mut(&entity) {
                    let recomputed = transform.update_from_parent(&parent_matrix, parent_changed);
                    transform.world_changed = recomputed || transform.children_sync_pending;
                    transform.children_sync_pending = false;
                }
            } else {
                // Update as root
                if let Some(transform) = self.transforms.get_mut(&entity) {
                    let recomputed = transform.update_as_root();
                    transform.world_changed = recomputed || transform.children_sync_pending;
                    transform.children_sync_pending = false;
                }
            }
        }
    }

    /// Recompute `entity` from its local pose when `node.parent()` is `None`.
    ///
    /// When `node.parent().is_some()` the node is not recomputed: its world pose
    /// stays under the parent. When the world matrix was recomputed, the node
    /// records `children_sync_pending` so the next [`Self::update`] moves each
    /// descendant with this node. Children are not marked dirty.
    pub fn refresh_root(&mut self, entity: EntityId) {
        if let Some(node) = self.transforms.get_mut(&entity) {
            if node.parent().is_some() {
                return;
            }
            if node.update_as_root() {
                node.children_sync_pending = true;
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

    /// Traverse hierarchy iteratively so a chain of `max_entities` cannot overflow.
    fn traverse_hierarchy(&mut self, root: EntityId) {
        let mut stack = vec![root];
        let mut seen = FxHashSet::default();
        while let Some(entity) = stack.pop() {
            if !seen.insert(entity) {
                continue;
            }
            self.update_order.push(entity);
            let children = self
                .transforms
                .get(&entity)
                .map(|transform| transform.children().to_vec())
                .unwrap_or_default();
            for child in children.into_iter().rev() {
                stack.push(child);
            }
        }
    }
}

impl Default for TransformSystem {
    fn default() -> Self {
        Self::new()
    }
}

fn store_f32(slot: &mut [u8], offset: usize, value: f32) -> bool {
    let Some(end) = offset.checked_add(4) else {
        return false;
    };
    let Some(dest) = slot.get_mut(offset..end) else {
        return false;
    };
    dest.copy_from_slice(&value.to_le_bytes());
    true
}

fn store_u32(slot: &mut [u8], offset: usize, value: u32) -> bool {
    let Some(end) = offset.checked_add(4) else {
        return false;
    };
    let Some(dest) = slot.get_mut(offset..end) else {
        return false;
    };
    dest.copy_from_slice(&value.to_le_bytes());
    true
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::unreachable,
        clippy::todo,
        clippy::unimplemented,
        reason = "test-only code"
    )]
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

        ts.set_parent(child, Some(parent)).expect("parent");
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
    #[allow(
        clippy::disallowed_methods,
        reason = "wall-clock measurement in a test"
    )]
    #[cfg_attr(
        miri,
        ignore = "wall-clock bound; Miri interprets the update and 10 ms cannot hold"
    )]
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
                ts.set_parent(id, Some(entity(i - 1))).expect("parent");
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
