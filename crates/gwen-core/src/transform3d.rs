//! Hierarchical 3D transforms, one store per engine.
//!
//! A child's world pose is TRS, with no shear:
//! `scale = parent.scale * local.scale` per axis,
//! `rotation = normalise(parent.rotation * local.rotation)`,
//! `position = parent.position + parent.rotation * (parent.scale * local.position)`.
//!
//! The history slot is [`TRANSFORM3D_STRIDE`] bytes: position xyz, quaternion xyzw,
//! scale xyz, then flags at [`FLAGS3D_OFFSET`].

use crate::ecs::error::CoreError;
use crate::entity::EntityId;
use crate::transform::{FLAGS3D_OFFSET, FLAG_HAS_TRANSFORM, FLAG_TELEPORT, TRANSFORM3D_STRIDE};
use bytemuck::{Pod, Zeroable};
use rustc_hash::{FxHashMap, FxHashSet};

/// Position or per-axis scale.
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct Vec3 {
    /// X component.
    pub x: f32,
    /// Y component.
    pub y: f32,
    /// Z component.
    pub z: f32,
}

impl Vec3 {
    /// Component constructor.
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    /// Origin.
    pub const ZERO: Self = Self::new(0.0, 0.0, 0.0);

    /// Scale of 1 on every axis.
    pub const ONE: Self = Self::new(1.0, 1.0, 1.0);
}

impl std::ops::Add for Vec3 {
    type Output = Self;

    fn add(self, other: Self) -> Self {
        Self::new(self.x + other.x, self.y + other.y, self.z + other.z)
    }
}

/// Unit quaternion, xyzw.
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct Quat {
    /// X component.
    pub x: f32,
    /// Y component.
    pub y: f32,
    /// Z component.
    pub z: f32,
    /// W component.
    pub w: f32,
}

impl Quat {
    /// Stores the four components as given.
    pub const fn new(x: f32, y: f32, z: f32, w: f32) -> Self {
        Self { x, y, z, w }
    }

    /// Identity rotation.
    pub const IDENTITY: Self = Self::new(0.0, 0.0, 0.0, 1.0);
}

impl std::ops::Mul for Quat {
    type Output = Self;

    /// Hamilton product `self * other`.
    fn mul(self, other: Self) -> Self {
        Self::new(
            self.w * other.x + self.x * other.w + self.y * other.z - self.z * other.y,
            self.w * other.y - self.x * other.z + self.y * other.w + self.z * other.x,
            self.w * other.z + self.x * other.y - self.y * other.x + self.z * other.w,
            self.w * other.w - self.x * other.x - self.y * other.y - self.z * other.z,
        )
    }
}

impl Quat {
    /// Rotates `value` by this quaternion.
    pub fn rotate(self, value: Vec3) -> Vec3 {
        let tx = 2.0 * (self.y * value.z - self.z * value.y);
        let ty = 2.0 * (self.z * value.x - self.x * value.z);
        let tz = 2.0 * (self.x * value.y - self.y * value.x);
        Vec3::new(
            value.x + self.w * tx + (self.y * tz - self.z * ty),
            value.y + self.w * ty + (self.z * tx - self.x * tz),
            value.z + self.w * tz + (self.x * ty - self.y * tx),
        )
    }

    /// Unit quaternion, or the identity when the input cannot be normalised.
    ///
    /// A non-finite component, a zero quaternion, and a finite quaternion whose
    /// squared length overflows or underflows all return the identity. Components
    /// near `1e20` overflow the square to infinity. Components near `1e-23`
    /// underflow it to zero.
    pub fn normalized_or_identity(x: f32, y: f32, z: f32, w: f32) -> Self {
        if !(x.is_finite() && y.is_finite() && z.is_finite() && w.is_finite()) {
            return Self::IDENTITY;
        }
        let len_sq = x * x + y * y + z * z + w * w;
        if len_sq == 0.0 {
            return Self::IDENTITY;
        }
        if !len_sq.is_finite() {
            return Self::IDENTITY;
        }
        let inv = 1.0 / len_sq.sqrt();
        Self::new(x * inv, y * inv, z * inv, w * inv)
    }

    fn unit(self) -> Self {
        Self::normalized_or_identity(self.x, self.y, self.z, self.w)
    }
}

/// Local TRS. The quaternion is stored normalised.
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct Transform3D {
    /// Local position.
    pub position: Vec3,
    /// Local rotation.
    pub rotation: Quat,
    /// Local scale.
    pub scale: Vec3,
}

impl Transform3D {
    /// Builds a local pose. A zero, non-finite, overflowing, or underflowing
    /// quaternion becomes the identity. See [`Quat::normalized_or_identity`].
    pub fn new(position: Vec3, rotation: Quat, scale: Vec3) -> Self {
        Self {
            position,
            rotation: Quat::normalized_or_identity(rotation.x, rotation.y, rotation.z, rotation.w),
            scale,
        }
    }
}

/// One entity in the 3D hierarchy, plus its cached world pose.
#[derive(Debug, Clone)]
pub struct TransformNode3D {
    local: Transform3D,
    world_position: Vec3,
    world_rotation: Quat,
    world_scale: Vec3,
    parent: Option<EntityId>,
    children: Vec<EntityId>,
    dirty: bool,
    pending_snap: bool,
    world_changed: bool,
    children_sync_pending: bool,
}

impl TransformNode3D {
    fn new(local: Transform3D) -> Self {
        Self {
            world_position: local.position,
            world_rotation: local.rotation,
            world_scale: local.scale,
            local,
            parent: None,
            children: Vec::new(),
            dirty: true,
            pending_snap: true,
            world_changed: false,
            children_sync_pending: false,
        }
    }

    /// Cached world position. [`TransformSystem3D::update`] refreshes it.
    pub fn world_position(&self) -> Vec3 {
        self.world_position
    }

    /// Cached world rotation.
    pub fn world_rotation(&self) -> Quat {
        self.world_rotation
    }

    /// Cached world scale.
    pub fn world_scale(&self) -> Vec3 {
        self.world_scale
    }

    /// Parent, when this node is not a root.
    pub fn parent(&self) -> Option<EntityId> {
        self.parent
    }

    fn children(&self) -> &[EntityId] {
        &self.children
    }

    /// Sets the local position and marks the node dirty. The world cache stays stale.
    pub fn set_position(&mut self, position: Vec3) {
        self.local.position = position;
        self.dirty = true;
    }

    /// Sets the local rotation. A zero, non-finite, overflowing, or underflowing
    /// quaternion becomes the identity. See [`Quat::normalized_or_identity`].
    pub fn set_rotation(&mut self, rotation: Quat) {
        self.local.rotation =
            Quat::normalized_or_identity(rotation.x, rotation.y, rotation.z, rotation.w);
        self.dirty = true;
    }

    /// Sets the local scale and marks the node dirty.
    pub fn set_scale(&mut self, scale: Vec3) {
        self.local.scale = scale;
        self.dirty = true;
    }

    fn set_parent(&mut self, parent: Option<EntityId>) {
        self.parent = parent;
        self.dirty = true;
    }

    fn add_child(&mut self, child: EntityId) {
        if !self.children.contains(&child) {
            self.children.push(child);
        }
    }

    fn remove_child(&mut self, child: EntityId) -> bool {
        if let Some(pos) = self.children.iter().position(|&id| id == child) {
            self.children.remove(pos);
            true
        } else {
            false
        }
    }

    fn world_changed(&self) -> bool {
        self.world_changed
    }

    /// Copies the local pose into the world cache when `dirty` is set.
    fn update_as_root(&mut self) -> bool {
        if !self.dirty {
            return false;
        }
        self.world_position = self.local.position;
        self.world_rotation = self.local.rotation;
        self.world_scale = self.local.scale;
        self.dirty = false;
        true
    }

    /// World pose from the parent TRS. See the module docs for the formula.
    fn compose(
        &mut self,
        parent_position: Vec3,
        parent_rotation: Quat,
        parent_scale: Vec3,
        parent_changed: bool,
    ) -> bool {
        if !(self.dirty || parent_changed) {
            return false;
        }
        let local_position = self.local.position;
        let scaled_local = Vec3::new(
            parent_scale.x * local_position.x,
            parent_scale.y * local_position.y,
            parent_scale.z * local_position.z,
        );
        let rotated = parent_rotation.rotate(scaled_local);
        self.world_position = parent_position + rotated;
        self.world_rotation = (parent_rotation * self.local.rotation).unit();
        self.world_scale = Vec3::new(
            parent_scale.x * self.local.scale.x,
            parent_scale.y * self.local.scale.y,
            parent_scale.z * self.local.scale.z,
        );
        self.dirty = false;
        true
    }
}

/// Per-engine 3D nodes. An existing node is kept: [`Self::add_transform`] returns false.
pub struct TransformSystem3D {
    transforms: FxHashMap<EntityId, TransformNode3D>,
    root_entities: Vec<EntityId>,
    update_order: Vec<EntityId>,
    order_dirty: bool,
}

impl TransformSystem3D {
    /// Empty store.
    pub fn new() -> Self {
        Self {
            transforms: FxHashMap::default(),
            root_entities: Vec::new(),
            update_order: Vec::new(),
            order_dirty: false,
        }
    }

    /// Inserts a root. Returns false when `entity` already has a node, and keeps that node.
    pub fn add_transform(&mut self, entity: EntityId, transform: Transform3D) -> bool {
        if self.transforms.contains_key(&entity) {
            return false;
        }
        self.transforms
            .insert(entity, TransformNode3D::new(transform));
        self.root_entities.push(entity);
        self.order_dirty = true;
        true
    }

    /// Removes `entity`.
    ///
    /// Each child becomes a root. Its local position and rotation are copied from
    /// the cached world pose. Its scale stays local.
    pub fn remove_transform(&mut self, entity: EntityId) -> Option<Transform3D> {
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

    /// Borrowed node, when present.
    pub fn get_transform(&self, entity: EntityId) -> Option<&TransformNode3D> {
        self.transforms.get(&entity)
    }

    /// Mutable node, when present.
    pub fn get_transform_mut(&mut self, entity: EntityId) -> Option<&mut TransformNode3D> {
        self.transforms.get_mut(&entity)
    }

    /// Parents `entity`, or detaches it when `parent` is `None`.
    ///
    /// A missing node on either side returns `Ok` and changes nothing.
    /// Self-parent and a cycle return [`CoreError::InvalidParent`] and change nothing.
    /// A change marks the child so the next history commit snaps.
    pub fn set_parent(
        &mut self,
        entity: EntityId,
        parent: Option<EntityId>,
    ) -> Result<(), CoreError> {
        if !self.transforms.contains_key(&entity) {
            return Ok(());
        }
        if let Some(parent_id) = parent {
            if !self.transforms.contains_key(&parent_id) {
                return Ok(());
            }
            if parent_id == entity || self.subtree_contains(entity, parent_id) {
                return Err(CoreError::InvalidParent {
                    child: entity.index(),
                    parent: parent_id.index(),
                });
            }
        }

        let old_parent = self.transforms.get(&entity).and_then(|node| node.parent());
        if let Some(old_p) = old_parent {
            if let Some(parent_node) = self.transforms.get_mut(&old_p) {
                parent_node.remove_child(entity);
            }
        }
        if let Some(node) = self.transforms.get_mut(&entity) {
            node.set_parent(parent);
        }
        if let Some(new_parent) = parent {
            self.root_entities.retain(|&id| id != entity);
            if let Some(parent_node) = self.transforms.get_mut(&new_parent) {
                parent_node.add_child(entity);
            }
        } else if !self.root_entities.contains(&entity) {
            self.root_entities.push(entity);
        }

        self.order_dirty = true;
        self.mark_pending_snap(entity);
        Ok(())
    }

    /// The next stored history slot sets [`FLAG_TELEPORT`]. A missing node changes nothing.
    pub fn mark_pending_snap(&mut self, entity: EntityId) {
        if let Some(node) = self.transforms.get_mut(&entity) {
            node.pending_snap = true;
        }
    }

    /// Clears the snap mark after the slot bytes are stored.
    pub fn clear_pending_snap(&mut self, entity: EntityId) {
        if let Some(node) = self.transforms.get_mut(&entity) {
            node.pending_snap = false;
        }
    }

    /// Writes the world pose of `entity` into one 48-byte slot.
    ///
    /// Bit 0 is set. Bit 2 is set while a snap is pending. The mark stays set;
    /// the caller clears it after the bytes are stored. Returns false when the
    /// node is missing or `out` is shorter than one slot, and then `out` is unchanged.
    pub fn pack_history_slot(&self, entity: EntityId, out: &mut [u8]) -> bool {
        let Some(node) = self.transforms.get(&entity) else {
            return false;
        };
        if out.len() < TRANSFORM3D_STRIDE {
            return false;
        }
        let mut flags = FLAG_HAS_TRANSFORM;
        if node.pending_snap {
            flags |= FLAG_TELEPORT;
        }
        let position = node.world_position();
        let rotation = node.world_rotation();
        let scale = node.world_scale();
        let mut packed = [0u8; TRANSFORM3D_STRIDE];
        let stored = store_f32(&mut packed, 0, position.x)
            && store_f32(&mut packed, 4, position.y)
            && store_f32(&mut packed, 8, position.z)
            && store_f32(&mut packed, 12, rotation.x)
            && store_f32(&mut packed, 16, rotation.y)
            && store_f32(&mut packed, 20, rotation.z)
            && store_f32(&mut packed, 24, rotation.w)
            && store_f32(&mut packed, 28, scale.x)
            && store_f32(&mut packed, 32, scale.y)
            && store_f32(&mut packed, 36, scale.z)
            && store_u32(&mut packed, FLAGS3D_OFFSET, flags);
        if !stored {
            return false;
        }
        let Some(dest) = out.get_mut(..TRANSFORM3D_STRIDE) else {
            return false;
        };
        dest.copy_from_slice(&packed);
        true
    }

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

    /// Propagates dirty nodes from roots to leaves.
    ///
    /// `update_order` is taken for the walk and put back, so a clean frame does not allocate.
    pub fn update(&mut self) {
        if self.order_dirty {
            self.rebuild_update_order();
            self.order_dirty = false;
        }
        let update_order = std::mem::take(&mut self.update_order);
        for entity in &update_order {
            let parent = self.transforms.get(entity).and_then(|node| node.parent());
            if let Some(parent) = parent {
                let parent_pose = self.transforms.get(&parent).map(|node| {
                    (
                        node.world_position(),
                        node.world_rotation(),
                        node.world_scale(),
                        node.world_changed(),
                    )
                });
                let (parent_position, parent_rotation, parent_scale, parent_changed) =
                    parent_pose.unwrap_or((Vec3::ZERO, Quat::IDENTITY, Vec3::ONE, false));
                if let Some(node) = self.transforms.get_mut(entity) {
                    let recomputed = node.compose(
                        parent_position,
                        parent_rotation,
                        parent_scale,
                        parent_changed,
                    );
                    node.world_changed = recomputed || node.children_sync_pending;
                    node.children_sync_pending = false;
                }
            } else if let Some(node) = self.transforms.get_mut(entity) {
                let recomputed = node.update_as_root();
                node.world_changed = recomputed || node.children_sync_pending;
                node.children_sync_pending = false;
            }
        }
        self.update_order = update_order;
    }

    /// Recomputes a root from its local pose.
    ///
    /// A node whose parent is `Some` is left unchanged. A recomputed root records
    /// `children_sync_pending` so the next [`Self::update`] moves its descendants.
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

    fn rebuild_update_order(&mut self) {
        self.update_order.clear();
        let roots = self.root_entities.clone();
        for root in roots {
            self.traverse_hierarchy(root);
        }
    }

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
                .map(|node| node.children().to_vec())
                .unwrap_or_default();
            for child in children.into_iter().rev() {
                stack.push(child);
            }
        }
    }
}

impl Default for TransformSystem3D {
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
