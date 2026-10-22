//! wasm-bindgen exports
//!
//! Exports for JavaScript interop via wasm-bindgen.
//!
//! # Stale-ID safety
//! All entity operations take both `index` and `generation` so that JS
//! cannot accidentally use a recycled slot (the classic stale-ID bug).
//! `create_entity` returns a `JsEntityId` struct exposing both fields,
//! or an error when the entity limit is reached.

use std::collections::HashMap;

use crate::ecs::chunk_store::{ChunkStore, LAYOUT_REASON_UNREGISTERED_TYPE};
use crate::ecs::entity::{EntityId, EntityManager};
use crate::ecs::error::{CoreError, MAX_ENTITIES_LIMIT};
use crate::transform::{Transform, TransformSystem, FLAG_HAS_TRANSFORM};
use crate::transform_math::Vec2;
use wasm_bindgen::prelude::*;

#[cfg(feature = "physics2d")]
use crate::physics2d::{
    BodyOptions, BodyType, ColliderOptions, Physics2DError, PhysicsQualityPreset, PhysicsWorld,
};

#[cfg(feature = "physics3d")]
use crate::physics3d::{Physics3DError, PhysicsWorld3D};

use crate::transform::TRANSFORM_STRIDE;
/// Local alias so all buffer arithmetic below reads as `STRIDE` unchanged.
const STRIDE: usize = TRANSFORM_STRIDE;

/// Two fixed world-pose buffers. `current` is the index last written.
struct TransformHistory {
    buffers: [Vec<u8>; 2],
    current: Option<u32>,
}

impl TransformHistory {
    fn new() -> Self {
        Self {
            buffers: [Vec::new(), Vec::new()],
            current: None,
        }
    }
}

/// Byte length of both history buffers, or `None` when the product overflows.
fn history_pair_bytes(max_entities: u32) -> Option<usize> {
    let entities = usize::try_from(max_entities).ok()?;
    entities.checked_mul(2)?.checked_mul(TRANSFORM_STRIDE)
}

fn write_history_slot(buffer: &mut [u8], index: u32, packed: &[u8; TRANSFORM_STRIDE]) -> bool {
    let Ok(slot_index) = usize::try_from(index) else {
        return false;
    };
    let Some(offset) = slot_index.checked_mul(TRANSFORM_STRIDE) else {
        return false;
    };
    let Some(end) = offset.checked_add(TRANSFORM_STRIDE) else {
        return false;
    };
    let Some(dest) = buffer.get_mut(offset..end) else {
        return false;
    };
    dest.copy_from_slice(packed);
    true
}

fn write_f32(slot: &mut [u8; STRIDE], offset: usize, value: f32) {
    slot[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

/// Message when a query has more matches than this engine's result buffer.
#[cfg(test)]
const QUERY_EXCEEDED_BUFFER_CAPACITY: &str = "query exceeded the buffer capacity";

// ─── Opaque entity handle exposed to JS ──────────────────────────────────────

/// Entity handle returned to JavaScript.
/// Carries both `index` and `generation` so JS can pass them back and
/// the engine can detect stale (dangling) references.
#[wasm_bindgen]
pub struct JsEntityId {
    index: u32,
    generation: u32,
}

#[wasm_bindgen]
impl JsEntityId {
    /// Slot index (stable while entity lives and after slot is recycled)
    #[wasm_bindgen(getter)]
    pub fn index(&self) -> u32 {
        self.index
    }

    /// Generation counter – incremented every time the slot is reused.
    /// Use this to detect dangling references.
    #[wasm_bindgen(getter)]
    pub fn generation(&self) -> u32 {
        self.generation
    }
}

impl From<EntityId> for JsEntityId {
    fn from(id: EntityId) -> Self {
        JsEntityId {
            index: id.index(),
            generation: id.generation(),
        }
    }
}

// ─── Main Engine ─────────────────────────────────────────────────────────────

/// Main engine exported to JavaScript
#[wasm_bindgen]
pub struct Engine {
    pub(crate) entity_manager: EntityManager,
    pub(crate) storage: ChunkStore,
    /// Entity ids from the last successful `query_entities_to_buffer` call.
    /// Length is `max_entities` from construction and is never reallocated.
    query_result_buffer: Vec<u32>,
    /// Hierarchical transform system for managing entity transforms
    transform_system: TransformSystem,
    /// Two world-pose buffers. Empty until the first history commit.
    transform_history: TransformHistory,
    /// Live `alloc_shared_buffer` allocations: pointer → (byte length, alignment).
    shared_buffers: HashMap<usize, (usize, usize)>,
    #[cfg(feature = "physics2d")]
    physics_world: Option<PhysicsWorld>,
    #[cfg(feature = "physics3d")]
    physics3d_world: Option<PhysicsWorld3D>,
}

pub(crate) fn bulk_len_u32(len: usize) -> u32 {
    u32::try_from(len).unwrap_or(u32::MAX)
}

#[wasm_bindgen]
impl Engine {
    /// Create a new engine instance.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::InvalidMaxEntities`] when `max_entities` is outside
    /// `[1, 2_000_000]`. Nothing is allocated in that case.
    #[wasm_bindgen(constructor)]
    pub fn new(max_entities: u32) -> Result<Engine, CoreError> {
        if !(1..=MAX_ENTITIES_LIMIT).contains(&max_entities) {
            return Err(CoreError::InvalidMaxEntities {
                value: max_entities,
                max: MAX_ENTITIES_LIMIT,
            });
        }
        Ok(Engine {
            entity_manager: EntityManager::new(max_entities),
            storage: ChunkStore::new(max_entities)?,
            query_result_buffer: vec![0u32; max_entities as usize],
            transform_system: TransformSystem::new(),
            transform_history: TransformHistory::new(),
            shared_buffers: HashMap::new(),
            #[cfg(feature = "physics2d")]
            physics_world: None,
            #[cfg(feature = "physics3d")]
            physics3d_world: None,
        })
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    // ─── Entity lifecycle ─────────────────────────────────────────────────────

    /// Create a new entity. Returns a `JsEntityId` with both `index` and
    /// `generation` – keep the whole object, not just the index.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::EntityLimitReached`] when the entity limit is reached.
    /// No entity is created.
    pub fn create_entity(&mut self) -> Result<JsEntityId, CoreError> {
        self.entity_manager
            .create_entity()
            .map(Into::into)
            .map_err(CoreError::from)
    }

    /// Delete an entity. Requires the full `{index, generation}` pair so
    /// that stale handles are correctly rejected.
    pub fn delete_entity(&mut self, index: u32, generation: u32) -> Result<bool, CoreError> {
        let id = EntityId::from_parts(index, generation);
        if !self.entity_manager.is_alive(id) {
            return Ok(false);
        }
        // The store bumps its slot generation here. The entity manager bumps
        // the same slot on the next reuse, so the two counters meet again.
        if !self.storage.delete_entity(index, generation)? {
            return Ok(false);
        }
        let deleted = self.entity_manager.delete_entity(id);
        if deleted {
            self.transform_system.remove_transform(id);
        }
        Ok(deleted)
    }

    /// Get count of live entities
    pub fn count_entities(&self) -> u32 {
        self.entity_manager.count_entities()
    }

    /// Check if entity is alive. Requires `{index, generation}` – returns
    /// `false` for any stale handle whose generation no longer matches.
    pub fn is_alive(&self, index: u32, generation: u32) -> bool {
        self.entity_manager
            .is_alive(EntityId::from_parts(index, generation))
    }

    // ─── Component registry ───────────────────────────────────────────────────

    /// Register a component layout and return its type id.
    ///
    /// Lane bytes are the `LaneKind` discriminants, in schema field order.
    /// `data` passed to [`Self::add_component`] must be exactly `rowBytes` long.
    ///
    /// # Errors
    ///
    /// [`CoreError::ComponentTypeLimitReached`] on the 129th layout.
    /// [`CoreError::ComponentLayoutInvalid`] when a lane byte is unknown, the
    /// list is longer than 64, or the row is wider than 512 bytes. The table
    /// is unchanged.
    pub fn register_component(&mut self, lane_kinds: &[u8]) -> Result<u32, CoreError> {
        self.storage.register(lane_kinds)
    }

    /// Add or overwrite one component row.
    ///
    /// `false` is a dead or stale entity. A wrong length or an unregistered
    /// type is [`CoreError::ComponentLayoutInvalid`] and writes nothing.
    /// An in-place overwrite does not bump [`Self::storage_generation`].
    pub fn add_component(
        &mut self,
        index: u32,
        generation: u32,
        component_type_id: u32,
        data: &[u8],
    ) -> Result<bool, CoreError> {
        if !self
            .entity_manager
            .is_alive(EntityId::from_parts(index, generation))
        {
            return Ok(false);
        }
        self.storage.add(index, generation, component_type_id, data)
    }

    /// Remove a component from an entity.
    ///
    /// `false` is a dead entity, a stale generation, or a type the entity does
    /// not have. An archetype-table failure also returns `false` and leaves
    /// the row unchanged: the store checks the limit before it reserves a row.
    pub fn remove_component(
        &mut self,
        index: u32,
        generation: u32,
        component_type_id: u32,
    ) -> Result<bool, CoreError> {
        if !self
            .entity_manager
            .is_alive(EntityId::from_parts(index, generation))
        {
            return Ok(false);
        }
        self.storage.remove(index, generation, component_type_id)
    }

    /// Check if entity has component
    pub fn has_component(
        &self,
        index: u32,
        generation: u32,
        component_type_id: u32,
    ) -> Result<bool, CoreError> {
        if !self
            .entity_manager
            .is_alive(EntityId::from_parts(index, generation))
        {
            return Ok(false);
        }
        self.storage.has(index, generation, component_type_id)
    }

    /// Get raw component bytes for an entity (returns empty Vec if not found).
    /// On the TypeScript side, use a DataView over the returned Uint8Array.
    pub fn get_component_raw(
        &self,
        index: u32,
        generation: u32,
        component_type_id: u32,
    ) -> Result<Vec<u8>, CoreError> {
        if !self
            .entity_manager
            .is_alive(EntityId::from_parts(index, generation))
        {
            return Ok(Vec::new());
        }
        let width = self
            .storage
            .layout(component_type_id)
            .map(|layout| usize::from(layout.row_bytes))
            .unwrap_or(0);
        if width == 0 {
            return Ok(Vec::new());
        }
        let mut bytes = vec![0u8; width];
        if self
            .storage
            .copy_row(index, generation, component_type_id, &mut bytes)?
        {
            Ok(bytes)
        } else {
            Ok(Vec::new())
        }
    }

    /// Storage generation. A lane write does not change it.
    pub fn storage_generation(&self) -> u32 {
        self.storage.generation()
    }

    /// Address of the 512-byte staging buffer.
    ///
    /// wasm32 returns the real address. A 64-bit host returns 0 when the
    /// address does not fit in `u32`. The buffer itself stays inside the engine.
    pub fn component_staging_ptr(&self) -> u32 {
        u32::try_from(self.storage.staging().as_ptr() as usize).unwrap_or(0)
    }

    /// Upsert from `staging[0..rowBytes]`.
    ///
    /// `Ok(false)` is a dead or stale entity. The staging bytes stay as the
    /// caller left them.
    pub fn write_component_staged(
        &mut self,
        index: u32,
        generation: u32,
        type_id: u32,
    ) -> Result<bool, CoreError> {
        if !self
            .entity_manager
            .is_alive(EntityId::from_parts(index, generation))
        {
            return Ok(false);
        }
        self.storage.write_staged(index, generation, type_id)
    }

    /// Copy the row into the staging buffer.
    ///
    /// `false` is a dead entity, a stale generation, or a missing component.
    /// The staging bytes are then unchanged.
    pub fn read_component_staged(
        &mut self,
        index: u32,
        generation: u32,
        type_id: u32,
    ) -> Result<bool, CoreError> {
        if !self
            .entity_manager
            .is_alive(EntityId::from_parts(index, generation))
        {
            return Ok(false);
        }
        self.storage.read_staged(index, generation, type_id)
    }

    /// Swap the row across the awake boundary.
    ///
    /// `Ok(false)` is a dead or stale entity, or an entity with no component
    /// row. Dormancy lives on the row, so an entity with no components cannot
    /// be dormant and this call changes nothing. The same state again is
    /// `Ok(true)` and does not bump [`Self::storage_generation`].
    ///
    /// The return is `Result<bool, _>` rather than `Result<(), _>`: a stale
    /// entity has no `CoreError` of its own, and this call does not add one.
    pub fn set_entity_dormant(
        &mut self,
        index: u32,
        generation: u32,
        dormant: bool,
    ) -> Result<bool, CoreError> {
        if !self
            .entity_manager
            .is_alive(EntityId::from_parts(index, generation))
        {
            return Ok(false);
        }
        self.storage.set_dormant(index, generation, dormant)
    }

    /// `true` when the live row is dormant.
    ///
    /// A dead entity, a stale generation, or an entity with no row is `false`.
    pub fn is_entity_dormant(&self, index: u32, generation: u32) -> Result<bool, CoreError> {
        if !self
            .entity_manager
            .is_alive(EntityId::from_parts(index, generation))
        {
            return Ok(false);
        }
        match self.storage.is_dormant(index, generation)? {
            Some(dormant) => Ok(dormant),
            None => Ok(false),
        }
    }

    /// Record a chunk query. The handle is the index used by [`Self::query_chunks`].
    ///
    /// # Errors
    ///
    /// [`CoreError::QueryInvalid`] when `type_ids` is empty.
    /// [`CoreError::ComponentLayoutInvalid`] when a type id was never registered.
    /// Neither call stores a query.
    pub fn register_query(&mut self, type_ids: &[u32]) -> Result<u32, CoreError> {
        self.storage.register_query(type_ids)
    }

    /// Refresh the query table and return its byte address as `u32`.
    ///
    /// `count` in each entry is the chunk's awake prefix. Chunks with no awake
    /// row are omitted. A repeat call at the same storage generation rewrites
    /// those counts in the existing buffer.
    ///
    /// # Errors
    ///
    /// [`CoreError::QueryInvalid`] when `query` was never registered or was released.
    pub fn query_chunks(&mut self, query: u32) -> Result<u32, CoreError> {
        self.storage.query_chunks(query)
    }

    /// Drop a query. An unknown handle does nothing.
    pub fn release_query(&mut self, query: u32) {
        self.storage.release_query(query);
    }

    // ─── Bulk component operations ────────────────────────────────────────────

    /// Reads component data for multiple entities in a single JS→WASM call.
    ///
    /// # Description
    /// This function eliminates the *N JS→WASM boundary crossings* that occur
    /// when calling [`get_component_raw`] once per entity in a per-frame loop.
    /// Instead, the caller allocates a contiguous output buffer of
    /// `entity_count × component_size_bytes` and passes it in; this function
    /// fills every slot in a tight Rust loop (zero extra heap allocations).
    ///
    /// The output is tightly packed:
    /// ```text
    /// [ entity_0_bytes | entity_1_bytes | … | entity_N_bytes ]
    /// ```
    /// If an entity is dead or does not carry the requested component, its
    /// corresponding slot is left as zeros (the buffer is not resized).
    ///
    /// # Arguments
    /// * `slots` – Entity slot indices (must have the same length as `gens`).
    /// * `gens`  – Per-slot generation counters for stale-reference detection.
    /// * `component_type_id` – Numeric component type ID returned by
    ///   [`register_component`].
    /// * `out_buf` – Caller-allocated output buffer. A shorter buffer stops
    ///   the copy at the last component that fits.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::BufferLengthMismatch`] before any read or write
    /// when `gens` differs in length from `slots`. The buffer name is
    /// `"gens"`, `expected` is the `slots` length, and `actual` is the `gens`
    /// length.
    ///
    /// # Returns
    /// `Ok(bytes)` written (always `≤ out_buf.len()`). Returns `Ok(0)` when
    /// `slots` is empty or `out_buf` is empty. The length check runs before
    /// that early return.
    ///
    /// Equal-length slices with an `out_buf` shorter than
    /// `slots.len() × component_size_bytes` stop the copy once the next
    /// component would pass the end of `out_buf`. That stop is output
    /// capacity, not [`CoreError::BufferLengthMismatch`].
    pub fn get_components_bulk(
        &self,
        slots: &[u32],
        gens: &[u32],
        component_type_id: u32,
        out_buf: &mut [u8],
    ) -> Result<u32, CoreError> {
        if slots.len() != gens.len() {
            return Err(CoreError::BufferLengthMismatch {
                buffer: "gens",
                expected: bulk_len_u32(slots.len()),
                actual: bulk_len_u32(gens.len()),
            });
        }

        let n = slots.len();
        if n == 0 || out_buf.is_empty() {
            return Ok(0);
        }

        let width = self
            .storage
            .layout(component_type_id)
            .map(|layout| usize::from(layout.row_bytes))
            .unwrap_or(0);
        let mut bytes_written: usize = 0;

        for i in 0..n {
            let slot = slots[i];
            let gen = gens[i];

            let copied = if width > 0
                && self
                    .entity_manager
                    .is_alive(EntityId::from_parts(slot, gen))
            {
                let dst_start = bytes_written;
                let dst_end = dst_start + width;
                if dst_end > out_buf.len() {
                    break;
                }
                match out_buf.get_mut(dst_start..dst_end) {
                    Some(dst) => self.storage.copy_row(slot, gen, component_type_id, dst)?,
                    None => false,
                }
            } else {
                false
            };

            if copied {
                bytes_written += width;
            } else if width > 0 {
                // Dead or missing: leave the caller-zeroed slot and advance
                // by the registered row width so the next row stays aligned.
                let Some(next) = bytes_written.checked_add(width) else {
                    break;
                };
                if next > out_buf.len() {
                    break;
                }
                bytes_written = next;
            }
        }

        Ok(bytes_written as u32)
    }

    /// Writes component data for multiple entities in a single JS→WASM call.
    ///
    /// # Description
    /// The mirror of [`get_components_bulk`]: sends N entities' worth of
    /// component data across the boundary in one call, eliminating N separate
    /// [`add_component`] invocations.
    ///
    /// The input buffer must be packed:
    /// ```text
    /// [ entity_0_bytes | entity_1_bytes | … | entity_N_bytes ]
    /// ```
    /// `slots` and `gens` must have the same length. `data` must be exactly
    /// `slots.len() × row_bytes` for the registered layout.
    /// Dead or unknown entities are silently skipped.
    ///
    /// # Arguments
    /// * `slots` – Entity slot indices (same length as `gens`).
    /// * `gens`  – Per-slot generation counters for stale-reference detection.
    /// * `component_type_id` – Numeric component type ID returned by
    ///   [`register_component`].
    /// * `data` – Packed component data; total length must equal
    ///   `slots.len() × row_bytes`.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::BufferLengthMismatch`] before any write when
    /// `gens` differs in length from `slots`, or when `data` is not a whole
    /// number of rows and is not `slots.len() × row_bytes`. The message names
    /// the buffer, the expected length, and the actual length.
    /// Returns [`CoreError::ComponentLayoutInvalid`] with reason 3 before any
    /// write when the type was never registered.
    /// Returns [`CoreError::BufferLengthMismatch`] on `"data"` before any write
    /// when `data` is not `slots.len() × row_bytes`. No row changes.
    /// Dead entities are skipped.
    pub fn set_components_bulk(
        &mut self,
        slots: &[u32],
        gens: &[u32],
        component_type_id: u32,
        data: &[u8],
    ) -> Result<(), CoreError> {
        if slots.len() != gens.len() {
            return Err(CoreError::BufferLengthMismatch {
                buffer: "gens",
                expected: bulk_len_u32(slots.len()),
                actual: bulk_len_u32(gens.len()),
            });
        }

        let n = slots.len();
        if n == 0 {
            return Ok(());
        }

        let Some(layout) = self.storage.layout(component_type_id) else {
            return Err(CoreError::ComponentLayoutInvalid {
                type_id: component_type_id,
                reason: LAYOUT_REASON_UNREGISTERED_TYPE,
            });
        };
        let row_bytes = usize::from(layout.row_bytes);
        let Some(expected_len) = n.checked_mul(row_bytes) else {
            return Err(CoreError::BufferLengthMismatch {
                buffer: "data",
                expected: u32::MAX,
                actual: bulk_len_u32(data.len()),
            });
        };
        if data.len() != expected_len {
            return Err(CoreError::BufferLengthMismatch {
                buffer: "data",
                expected: bulk_len_u32(expected_len),
                actual: bulk_len_u32(data.len()),
            });
        }
        if row_bytes == 0 {
            for i in 0..n {
                let slot = slots[i];
                let gen = gens[i];
                if !self
                    .entity_manager
                    .is_alive(EntityId::from_parts(slot, gen))
                {
                    continue;
                }
                let _ = self.storage.add(slot, gen, component_type_id, &[])?;
            }
            return Ok(());
        }

        for i in 0..n {
            let slot = slots[i];
            let gen = gens[i];
            if !self
                .entity_manager
                .is_alive(EntityId::from_parts(slot, gen))
            {
                continue;
            }
            let src_start = i * row_bytes;
            let src_end = src_start + row_bytes;
            let Some(slice) = data.get(src_start..src_end) else {
                return Err(CoreError::BufferLengthMismatch {
                    buffer: "data",
                    expected: bulk_len_u32(expected_len),
                    actual: bulk_len_u32(data.len()),
                });
            };
            let _ = self.storage.add(slot, gen, component_type_id, slice)?;
        }
        Ok(())
    }

    // ─── Component queries ────────────────────────────────────────────────────
    // Note: query_entities(&mut self) and query_entities_to_buffer(&mut self)
    // take `&mut self` because filling a chunk query rewrites its table.

    /// Update the archetype of an entity after component changes.
    /// Pass the full list of component type IDs currently on the entity.
    pub fn update_entity_archetype(&mut self, _index: u32, _component_type_ids: &[u32]) {
        // No-op in archetype-based storage as it's handled automatically
        // in add_component/remove_component.
    }

    /// Remove an entity from the query system cache.
    /// Must be called after delete_entity so the query system stops returning
    /// the destroyed entity in subsequent queries.
    pub fn remove_entity_from_query(&mut self, _index: u32) {
        // Chunk queries read the store. Deleting the entity drops its row.
    }

    /// Get the current generation for a slot index.
    /// Returns u32::MAX if the index is out of bounds.
    /// Used by the TS bridge to reconstruct packed EntityIds from query results.
    pub fn get_entity_generation(&self, index: u32) -> u32 {
        self.entity_manager
            .get_generation(index)
            .unwrap_or(u32::MAX)
    }

    /// Query entities that have ALL the listed component types.
    /// Returns a flat `Uint32Array` of entity indices.
    pub fn query_entities(&mut self, component_type_ids: &[u32]) -> Result<Vec<u32>, CoreError> {
        let matches = self.storage.count_awake(component_type_ids)?;
        let mut slots = vec![0u32; matches];
        let mut gens = vec![0u32; matches];
        let written = self
            .storage
            .write_awake(component_type_ids, &mut slots, &mut gens)?;
        slots.truncate(written);
        Ok(slots)
    }

    /// Query entities and copy every match into this engine's result buffer.
    ///
    /// The buffer length is fixed at construction (`max_entities`). Read it
    /// with [`Self::get_query_result_capacity`] and the pointer with
    /// [`Self::get_query_result_ptr`]. This avoids allocating a new result `Vec`.
    ///
    /// # Errors
    ///
    /// Returns an error when the number of matches exceeds the buffer capacity.
    /// The buffer is left unchanged. The call does not report a truncated count.
    ///
    /// # Example
    /// ```rust
    /// # use gwen_core::bindings::Engine;
    /// # let mut engine = Engine::new(100).expect("max entities");
    /// let count = engine.query_entities_to_buffer(&[0, 1]).unwrap();
    /// let ptr = engine.get_query_result_ptr();
    /// // Read `count` entity ids from `ptr` in JS. The view length is
    /// // `engine.get_query_result_capacity()`, not a fixed 10_000.
    /// let _ = (count, ptr);
    /// ```
    pub fn query_entities_to_buffer(
        &mut self,
        component_type_ids: &[u32],
    ) -> Result<u32, CoreError> {
        let matches = self.storage.count_awake(component_type_ids)?;
        if matches > self.query_result_buffer.len() {
            return Err(CoreError::QueryCapacityExceeded {
                matches: matches as u32,
                capacity: self.query_result_buffer.len() as u32,
            });
        }
        let mut gens = vec![0u32; matches];
        let written = self.storage.write_awake(
            component_type_ids,
            &mut self.query_result_buffer[..matches],
            &mut gens,
        )?;
        Ok(written as u32)
    }

    /// Pointer to this engine's query result buffer.
    ///
    /// Use this to read the results of the last successful
    /// `query_entities_to_buffer` call from JavaScript without allocations.
    /// Each `Engine` owns its buffer. The pointer stays valid for the life of
    /// this engine because the buffer is never reallocated.
    pub fn get_query_result_ptr(&self) -> *const u32 {
        self.query_result_buffer.as_ptr()
    }

    /// Number of entity ids this engine's query result buffer can hold.
    ///
    /// This is the length allocated in [`Engine::new`] from `max_entities`.
    /// JavaScript must use this value as the view length. It does not change,
    /// and it is not inferred from the configured `maxEntities` on the JS side.
    pub fn get_query_result_capacity(&self) -> u32 {
        self.query_result_buffer.len() as u32
    }

    // ─── Transforms ───────────────────────────────────────────────────────────

    /// Register a transform for the given entity. Must be called after `create_entity`.
    ///
    /// # Arguments
    /// * `index` - Entity index returned by `create_entity`.
    /// * `x`, `y` - Initial local position.
    /// * `rotation` - Initial local rotation in radians.
    /// * `scale_x`, `scale_y` - Initial local scale.
    #[wasm_bindgen]
    pub fn add_entity_transform(
        &mut self,
        index: u32,
        x: f32,
        y: f32,
        rotation: f32,
        scale_x: f32,
        scale_y: f32,
    ) {
        let entity = EntityId::from_parts(index, self.get_entity_generation(index));
        self.transform_system.add_transform(
            entity,
            Transform {
                position: Vec2::new(x, y),
                rotation,
                scale: Vec2::new(scale_x, scale_y),
            },
        );
    }

    /// Set the parent of `child_index` to `parent_index`.
    /// Pass `parent_index = u32::MAX` to detach from any parent.
    ///
    /// # Arguments
    /// * `child_index` - Entity to re-parent.
    /// * `parent_index` - New parent entity index, or `u32::MAX` to detach.
    /// * `keep_world_pos` - If true, recalculate local transform so world position is preserved.
    #[wasm_bindgen]
    /// # Errors
    ///
    /// Returns [`CoreError::InvalidParent`] when `child_index == parent_index`
    /// or when the parent is a descendant of the child. The hierarchy is unchanged.
    /// `parent_index == u32::MAX` detaches.
    pub fn set_entity_parent(
        &mut self,
        child_index: u32,
        parent_index: u32,
        keep_world_pos: bool,
    ) -> Result<(), CoreError> {
        if parent_index != u32::MAX && child_index == parent_index {
            return Err(CoreError::InvalidParent {
                child: child_index,
                parent: parent_index,
            });
        }

        let child_gen = self.get_entity_generation(child_index);
        let child = EntityId::from_parts(child_index, child_gen);

        let parent = if parent_index == u32::MAX {
            None
        } else {
            let parent_gen = self.get_entity_generation(parent_index);
            Some(EntityId::from_parts(parent_index, parent_gen))
        };

        if keep_world_pos {
            let world_pos = self
                .transform_system
                .get_transform(child)
                .map(|t| t.world_position())
                .unwrap_or(Vec2::zero());
            let world_rot = self
                .transform_system
                .get_transform(child)
                .map(|t| t.world_rotation())
                .unwrap_or(0.0);

            self.transform_system.set_parent(child, parent)?;

            if let Some(node) = self.transform_system.get_transform_mut(child) {
                if parent.is_none() {
                    node.set_position(world_pos);
                    node.set_rotation(world_rot);
                }
            }
        } else {
            self.transform_system.set_parent(child, parent)?;
        }
        Ok(())
    }

    /// Translate entity's local position by (dx, dy). Marks transform dirty.
    #[wasm_bindgen]
    pub fn translate_entity(&mut self, index: u32, dx: f32, dy: f32) {
        let entity = EntityId::from_parts(index, self.get_entity_generation(index));
        if let Some(node) = self.transform_system.get_transform_mut(entity) {
            let pos = node.position();
            node.set_position(Vec2::new(pos.x + dx, pos.y + dy));
        }
    }

    /// Set entity local position.
    #[wasm_bindgen]
    pub fn set_entity_local_position(&mut self, index: u32, x: f32, y: f32) {
        let entity = EntityId::from_parts(index, self.get_entity_generation(index));
        if let Some(node) = self.transform_system.get_transform_mut(entity) {
            node.set_position(Vec2::new(x, y));
        }
    }

    /// Set entity local rotation in radians.
    #[wasm_bindgen]
    pub fn set_entity_local_rotation(&mut self, index: u32, rotation: f32) {
        let entity = EntityId::from_parts(index, self.get_entity_generation(index));
        if let Some(node) = self.transform_system.get_transform_mut(entity) {
            node.set_rotation(rotation);
        }
    }

    /// Set entity local scale.
    #[wasm_bindgen]
    pub fn set_entity_local_scale(&mut self, index: u32, scale_x: f32, scale_y: f32) {
        let entity = EntityId::from_parts(index, self.get_entity_generation(index));
        if let Some(node) = self.transform_system.get_transform_mut(entity) {
            node.set_scale(Vec2::new(scale_x, scale_y));
        }
    }

    /// Get entity local position x.
    #[wasm_bindgen]
    pub fn get_entity_local_x(&self, index: u32) -> f32 {
        let entity = EntityId::from_parts(index, self.get_entity_generation(index));
        self.transform_system
            .get_transform(entity)
            .map(|t| t.position().x)
            .unwrap_or(0.0)
    }

    /// Get entity local position y.
    #[wasm_bindgen]
    pub fn get_entity_local_y(&self, index: u32) -> f32 {
        let entity = EntityId::from_parts(index, self.get_entity_generation(index));
        self.transform_system
            .get_transform(entity)
            .map(|t| t.position().y)
            .unwrap_or(0.0)
    }

    /// Get entity world position x (requires `update_transforms` to have been called this frame).
    #[wasm_bindgen]
    pub fn get_entity_world_x(&self, index: u32) -> f32 {
        let entity = EntityId::from_parts(index, self.get_entity_generation(index));
        self.transform_system
            .get_transform(entity)
            .map(|t| t.world_position().x)
            .unwrap_or(0.0)
    }

    /// Get entity world position y.
    #[wasm_bindgen]
    pub fn get_entity_world_y(&self, index: u32) -> f32 {
        let entity = EntityId::from_parts(index, self.get_entity_generation(index));
        self.transform_system
            .get_transform(entity)
            .map(|t| t.world_position().y)
            .unwrap_or(0.0)
    }

    /// Get entity world rotation.
    #[wasm_bindgen]
    pub fn get_entity_world_rotation(&self, index: u32) -> f32 {
        let entity = EntityId::from_parts(index, self.get_entity_generation(index));
        self.transform_system
            .get_transform(entity)
            .map(|t| t.world_rotation())
            .unwrap_or(0.0)
    }

    /// Get entity local rotation in radians.
    #[wasm_bindgen]
    pub fn get_entity_local_rotation(&self, index: u32) -> f32 {
        let entity = EntityId::from_parts(index, self.get_entity_generation(index));
        self.transform_system
            .get_transform(entity)
            .map(|t| t.rotation())
            .unwrap_or(0.0)
    }

    /// Returns true if the entity has a parent in the TransformSystem.
    #[wasm_bindgen]
    pub fn has_entity_parent(&self, index: u32) -> bool {
        let entity = EntityId::from_parts(index, self.get_entity_generation(index));
        self.transform_system
            .get_transform(entity)
            .map(|t| t.parent().is_some())
            .unwrap_or(false)
    }

    /// Propagate dirty transforms from roots to leaves. Call once per frame before rendering.
    ///
    /// After this call, `get_entity_world_x/y/rotation` return up-to-date world values.
    #[wasm_bindgen]
    pub fn update_transforms(&mut self) {
        self.transform_system.update();
    }

    /// Packs every transform node whose key matches the slot's current generation.
    ///
    /// The first call allocates two zeroed buffers. The byte count is
    /// `2 * max_entities * 32`, computed with `checked_mul`. When that product
    /// overflows, or `try_reserve_exact` fails, this returns
    /// [`CoreError::HistoryBuffersUnavailable`]. Nothing is stored and the
    /// written-buffer index is left as it was.
    ///
    /// A successful call returns only `0` or `1`, the buffer just written.
    ///
    /// Each slot is 32 bytes: world x, y, rotation, scale x, scale y, flags,
    /// then 8 zero bytes. Bit 0 means the slot has a live transform. Bit 2
    /// ([`crate::transform::FLAG_TELEPORT`]) is set for a node created,
    /// re-parented, or marked since the previous commit, and that mark clears
    /// once the slot is stored. A slot with no transform node is 32 zero bytes.
    /// After `delete_entity`, the wasm record remains and the next commit writes
    /// zeros into that slot. A slot that was never created in the wasm entity
    /// manager has no record. `add_entity_transform` keys that node by
    /// `u32::MAX`, and the commit packs it.
    ///
    /// A TypeScript `createEntity` allocates a wasm entity. `destroyEntity`
    /// calls `delete_entity` and emits `entity:destroy`. It does not remove the
    /// transform node. The next commit skips the dead record, so a history
    /// read returns false. Renderers must drop an entity on `entity:destroy`.
    /// Issue #220 removes the node.
    ///
    /// Bit 2 exists only in these two buffers. No plugin module receives their
    /// address, so the bit is not part of the plugin ABI and the plugin ABI
    /// number stays unchanged.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::HistoryBuffersUnavailable`] when the buffers cannot
    /// be allocated. The history state is unchanged.
    #[wasm_bindgen]
    pub fn transform_history_commit(&mut self) -> Result<u32, CoreError> {
        let unallocated = self
            .transform_history
            .buffers
            .first()
            .is_none_or(|buffer| buffer.is_empty());
        if unallocated {
            let max_entities = self.entity_manager.max_entities();
            let unavailable = CoreError::HistoryBuffersUnavailable { max_entities };
            let Some(pair_bytes) = history_pair_bytes(max_entities) else {
                return Err(unavailable);
            };
            let Some(one) = pair_bytes.checked_div(2) else {
                return Err(unavailable);
            };
            let mut first = Vec::new();
            let mut second = Vec::new();
            if first.try_reserve_exact(one).is_err() || second.try_reserve_exact(one).is_err() {
                return Err(unavailable);
            }
            if first.capacity() < one || second.capacity() < one {
                return Err(unavailable);
            }
            first.resize(one, 0);
            second.resize(one, 0);
            self.transform_history.buffers = [first, second];
        }

        let write_at = match self.transform_history.current {
            Some(0) => 1u32,
            _ => 0,
        };
        let buffer_index = if write_at == 0 { 0usize } else { 1usize };
        let filled = self
            .transform_history
            .buffers
            .get_mut(buffer_index)
            .is_some_and(|buffer| {
                buffer.fill(0);
                true
            });
        if !filled {
            return Err(CoreError::HistoryBuffersUnavailable {
                max_entities: self.entity_manager.max_entities(),
            });
        }

        let max_entities = self.entity_manager.max_entities();
        for index in 0..max_entities {
            let generation = self.get_entity_generation(index);
            // A deleted wasm entity keeps its record and its transform node.
            // That slot stays zero. A missing record is packed: the node is
            // keyed by this generation, which is u32::MAX until the slot exists.
            let wasm_record = self.entity_manager.get_generation(index).is_some();
            if wasm_record && !self.is_alive(index, generation) {
                continue;
            }
            let entity = EntityId::from_parts(index, generation);
            let mut packed = [0u8; TRANSFORM_STRIDE];
            if !self.transform_system.pack_history_slot(entity, &mut packed) {
                continue;
            }
            let stored = self
                .transform_history
                .buffers
                .get_mut(buffer_index)
                .is_some_and(|buffer| write_history_slot(buffer, index, &packed));
            if stored {
                self.transform_system.clear_pending_snap(entity);
            }
        }
        self.transform_history.current = Some(write_at);
        Ok(write_at)
    }

    /// Byte address of history buffer `0` or `1`.
    ///
    /// Returns `0` before the first successful commit, and when `buffer` is
    /// greater than 1. The address stays valid until the engine is dropped.
    /// The buffers are not reallocated after the first successful commit.
    #[wasm_bindgen]
    pub fn transform_history_ptr(&self, buffer: u32) -> usize {
        if buffer > 1 {
            return 0;
        }
        let Ok(index) = usize::try_from(buffer) else {
            return 0;
        };
        let Some(bytes) = self.transform_history.buffers.get(index) else {
            return 0;
        };
        if bytes.is_empty() {
            return 0;
        }
        bytes.as_ptr() as usize
    }

    /// Marks the transform at `index` so the next history commit sets bit 2.
    ///
    /// No transform for the current generation: the call changes nothing.
    #[wasm_bindgen]
    pub fn mark_entity_teleport(&mut self, index: u32) {
        let entity = EntityId::from_parts(index, self.get_entity_generation(index));
        self.transform_system.mark_pending_snap(entity);
    }

    // ─── Shared memory buffers (plugin bridge) ────────────────────────────────

    /// Allocates `byte_length` bytes in the WASM linear memory and returns
    /// the raw pointer (as usize) to that region.
    ///
    /// Called once by `SharedMemoryManager.create()` in TypeScript.
    /// The host fills this buffer and copies it into community module regions.
    /// Those modules do not receive this address.
    ///
    /// Layout contract (stride = 32 bytes per entity slot):
    ///   offset +  0 : pos_x    (f32)
    ///   offset +  4 : pos_y    (f32)
    ///   offset +  8 : rotation (f32)
    ///   offset + 12 : scale_x  (f32)
    ///   offset + 16 : scale_y  (f32)
    ///   offset + 20 : flags    (u32)  — bit 0: slot has a transform; every other bit is 0
    ///   offset + 24 : reserved (8 bytes)
    ///
    /// # Safety
    /// The returned pointer is valid for the lifetime of the WASM module.
    /// TypeScript must not access it after the engine is destroyed.
    /// Allocates a zeroed buffer of `byte_length` bytes with 8-byte alignment.
    ///
    /// # Arguments
    /// * `byte_length` — number of bytes to allocate. Must be > 0.
    ///
    /// # Returns
    /// The pointer as `usize`, or **0** on failure (zero-size request or OOM).
    /// The TypeScript caller must check for 0 before using the pointer.
    ///
    /// # Safety & Error Handling
    /// - If `byte_length == 0`, returns 0 immediately without allocating.
    /// - If layout construction fails, returns 0.
    /// - If allocation fails (OOM), returns 0 instead of panicking.
    /// - Callers must check the return value for 0 and handle gracefully.
    pub fn alloc_shared_buffer(&mut self, byte_length: usize) -> usize {
        if byte_length == 0 {
            return 0;
        }
        let Ok(layout) = std::alloc::Layout::from_size_align(byte_length, 8) else {
            return 0;
        };
        // SAFETY: layout has non-zero size and valid alignment. [U-001]
        let ptr = unsafe { std::alloc::alloc_zeroed(layout) };
        if ptr.is_null() {
            return 0; // OOM — caller must handle gracefully
        }
        let addr = ptr as usize;
        self.shared_buffers
            .insert(addr, (byte_length, layout.align()));
        addr
    }

    /// Release a buffer previously allocated by `alloc_shared_buffer`.
    ///
    /// `ptr == 0` or `byte_length == 0` does nothing. Any other call must name
    /// a live allocation and the length recorded for it.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::InvalidSharedBuffer`] when `ptr` is unknown, already
    /// freed, or `byte_length` is not the recorded length. Those cases do not
    /// deallocate and leave the registry unchanged.
    pub fn free_shared_buffer(&mut self, ptr: usize, byte_length: usize) -> Result<(), CoreError> {
        if ptr == 0 || byte_length == 0 {
            return Ok(());
        }
        let Some((recorded, align)) = self.shared_buffers.get(&ptr).copied() else {
            return Err(CoreError::InvalidSharedBuffer { ptr, len: 0 });
        };
        if recorded != byte_length {
            return Err(CoreError::InvalidSharedBuffer { ptr, len: recorded });
        }
        let Ok(layout) = std::alloc::Layout::from_size_align(recorded, align) else {
            return Err(CoreError::InvalidSharedBuffer { ptr, len: recorded });
        };
        self.shared_buffers.remove(&ptr);
        // SAFETY: `ptr` is the address recorded for `recorded` bytes, and
        // `layout` uses that length and the alignment stored at allocation. [U-002]
        unsafe { std::alloc::dealloc(ptr as *mut u8, layout) };
        Ok(())
    }

    /// Copies world transforms from the hierarchy into a live shared buffer.
    ///
    /// `ptr` must be the start of a live [`Self::alloc_shared_buffer`] allocation
    /// whose length is at least `max_entities * 32`. Dirty transforms are
    /// propagated first. Each slot is 32 bytes: world x, y, rotation, scale x,
    /// scale y, then flags (bit 0 = the slot has a transform, every other bit 0)
    /// and 8 reserved zero bytes. A slot with no transform is 32 zero bytes.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::InvalidMaxEntities`] when `max_entities` is above
    /// this engine's capacity, or [`CoreError::InvalidSharedBuffer`] when `ptr`
    /// is unknown or the allocation is too short. Neither case writes a slot.
    pub fn sync_transforms_to_buffer(
        &mut self,
        ptr: usize,
        max_entities: u32,
    ) -> Result<(), CoreError> {
        let cap = self.entity_manager.max_entities();
        if max_entities > cap {
            return Err(CoreError::InvalidMaxEntities {
                value: max_entities,
                max: cap,
            });
        }
        let Some((len, _)) = self.shared_buffers.get(&ptr).copied() else {
            return Err(CoreError::InvalidSharedBuffer { ptr, len: 0 });
        };
        let needed = (max_entities as usize).saturating_mul(STRIDE);
        if len < needed {
            return Err(CoreError::InvalidSharedBuffer { ptr, len });
        }
        self.transform_system.update();
        for idx in 0..max_entities {
            let offset = idx as usize * STRIDE;
            let mut slot = [0u8; STRIDE];
            let entity = EntityId::from_parts(idx, self.get_entity_generation(idx));
            if let Some(node) = self.transform_system.get_transform(entity) {
                let position = node.world_position();
                let scale = node.world_scale();
                write_f32(&mut slot, 0, position.x);
                write_f32(&mut slot, 4, position.y);
                write_f32(&mut slot, 8, node.world_rotation());
                write_f32(&mut slot, 12, scale.x);
                write_f32(&mut slot, 16, scale.y);
                slot[20..24].copy_from_slice(&FLAG_HAS_TRANSFORM.to_le_bytes());
            }
            // SAFETY: `ptr` starts a live allocation of `len` bytes and
            // `offset + STRIDE <= needed <= len`, so `slot` fits in that allocation. [U-003]
            unsafe {
                std::ptr::copy_nonoverlapping(slot.as_ptr(), (ptr + offset) as *mut u8, STRIDE);
            }
        }
        Ok(())
    }

    // ─── Physics 2D — World lifecycle ─────────────────────────────────────────

    #[cfg(feature = "physics2d")]
    pub fn physics_init(&mut self, grav_x: f32, grav_y: f32, _max_entities: u32) {
        self.physics_world = Some(PhysicsWorld::new(grav_x, grav_y));
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_step(&mut self, delta: f32) -> Result<(), Physics2DError> {
        let poses = {
            let Some(world) = self.physics_world.as_mut() else {
                return Err(Physics2DError::WorldNotInitialized);
            };
            world.step(delta);
            world.take_filled_dynamic_poses()
        };
        // Root nodes take the pose so a later history commit can interpolate
        // the body. A child keeps its parent; only its local pose is updated.
        for (index, x, y, rotation) in &poses {
            let entity = EntityId::from_parts(*index, self.get_entity_generation(*index));
            let Some(node) = self.transform_system.get_transform_mut(entity) else {
                continue;
            };
            let rooted = node.parent().is_none();
            node.set_position(Vec2::new(*x, *y));
            node.set_rotation(*rotation);
            if rooted {
                self.transform_system.refresh_root(entity);
            }
        }
        if let Some(world) = self.physics_world.as_mut() {
            world.restore_dynamic_pose_scratch(poses);
        }
        Ok(())
    }

    /// Drains disabled-slot records as interleaved `[slot, code, ...]` pairs.
    ///
    /// Codes are `0` non-finite, `1` out-of-bounds, `2` velocity.
    /// `PhysicsWorld::take_disabled_slots` records nothing, so this is empty.
    #[cfg(feature = "physics2d")]
    pub fn physics_take_disabled_slots(&mut self) -> Vec<u32> {
        let Some(world) = self.physics_world.as_mut() else {
            return Vec::new();
        };
        world.take_disabled_slots()
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_set_quality(&mut self, preset: u8) -> Result<(), Physics2DError> {
        if let Some(ref mut world) = self.physics_world {
            world.set_quality_preset(PhysicsQualityPreset::from_u8(preset));
            Ok(())
        } else {
            Err(Physics2DError::WorldNotInitialized)
        }
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_set_event_coalescing(&mut self, _enabled: u32) {
        // Coalescing logic is handled in the event buffer or world
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_set_global_ccd_enabled(&mut self, _enabled: u32) {
        // CCD logic handled in the world
    }

    // ─── Physics 2D — Body management ─────────────────────────────────────────

    #[cfg(feature = "physics2d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics_add_rigid_body(
        &mut self,
        slot: u32,
        x: f32,
        y: f32,
        body_type: u8,
        mass: f32,
        gravity_scale: f32,
        linear_damping: f32,
        angular_damping: f32,
        vx: f32,
        vy: f32,
        ccd_enabled: Option<u32>,
        extra_solver_iters: Option<usize>,
    ) -> Result<u32, Physics2DError> {
        let Some(world) = self.physics_world.as_mut() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        let b_type = match body_type {
            0 => BodyType::Fixed,
            1 => BodyType::Dynamic,
            2 => BodyType::Kinematic,
            _ => return Err(Physics2DError::InvalidBodyKind { kind: body_type }),
        };
        let opts = BodyOptions {
            mass,
            gravity_scale,
            linear_damping,
            angular_damping,
            initial_velocity: (vx, vy),
            ccd_enabled: ccd_enabled.map(|v| v != 0),
            additional_solver_iterations: extra_solver_iters,
        };
        world.add_rigid_body(slot, x, y, b_type, opts)
    }

    /// Lock or unlock rotation for the body in `slot`.
    ///
    /// `WorldNotInitialized` when `physics_init` has not run.
    /// `BodyNotFound` when the slot has no rigid body.
    #[cfg(feature = "physics2d")]
    pub fn physics_set_fixed_rotation(
        &mut self,
        slot: u32,
        fixed: bool,
    ) -> Result<(), Physics2DError> {
        let Some(world) = self.physics_world.as_mut() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        world.lock_body_rotation(slot, fixed)
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_remove_rigid_body(&mut self, slot: u32) -> Result<(), Physics2DError> {
        let Some(world) = self.physics_world.as_mut() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        if !world.contains_body(slot) {
            return Err(Physics2DError::BodyNotFound { slot });
        }
        world.remove_rigid_body(slot);
        Ok(())
    }

    // ─── Physics 2D — Collider management ──────────────────────────────────────

    #[cfg(feature = "physics2d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics_add_box_collider(
        &mut self,
        handle: u32,
        hw: f32,
        hh: f32,
        restitution: f32,
        friction: f32,
        is_sensor: u32,
        density: f32,
        membership: u32,
        filter: u32,
        collider_id: Option<u32>,
        offset_x: Option<f32>,
        offset_y: Option<f32>,
        one_way: Option<u32>,
    ) -> Result<(), Physics2DError> {
        let Some(world) = self.physics_world.as_mut() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        let opts = ColliderOptions {
            material: crate::physics2d::components::PhysicsMaterial {
                restitution,
                friction,
            },
            is_sensor: is_sensor != 0,
            density,
            groups: crate::physics2d::components::CollisionGroups { membership, filter },
            collider_id: collider_id.unwrap_or(u32::MAX),
            offset_x: offset_x.unwrap_or(0.0),
            offset_y: offset_y.unwrap_or(0.0),
            is_one_way: one_way.unwrap_or(0) != 0,
        };
        world.add_box_collider(handle, hw, hh, opts)
    }

    #[cfg(feature = "physics2d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics_add_ball_collider(
        &mut self,
        handle: u32,
        radius: f32,
        restitution: f32,
        friction: f32,
        is_sensor: u32,
        density: f32,
        membership: u32,
        filter: u32,
        collider_id: Option<u32>,
        offset_x: Option<f32>,
        offset_y: Option<f32>,
    ) -> Result<(), Physics2DError> {
        let Some(world) = self.physics_world.as_mut() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        let opts = ColliderOptions {
            material: crate::physics2d::components::PhysicsMaterial {
                restitution,
                friction,
            },
            is_sensor: is_sensor != 0,
            density,
            groups: crate::physics2d::components::CollisionGroups { membership, filter },
            collider_id: collider_id.unwrap_or(u32::MAX),
            offset_x: offset_x.unwrap_or(0.0),
            offset_y: offset_y.unwrap_or(0.0),
            is_one_way: false,
        };
        world.add_ball_collider(handle, radius, opts)
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_get_position(&self, slot: u32) -> Result<Vec<f32>, Physics2DError> {
        let Some(world) = self.physics_world.as_ref() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        Ok(match world.get_position(slot) {
            Some((x, y, rot)) => vec![x, y, rot],
            None => Vec::new(),
        })
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_get_linear_velocity(&self, slot: u32) -> Result<Vec<f32>, Physics2DError> {
        let Some(world) = self.physics_world.as_ref() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        Ok(match world.get_linear_velocity(slot) {
            Some((vx, vy)) => vec![vx, vy],
            None => Vec::new(),
        })
    }

    /// Set the linear velocity of a 2D dynamic rigid body.
    ///
    /// Immediately overwrites the body's velocity and wakes it if sleeping.
    /// Use this for **dynamic** bodies only. For kinematic bodies, use
    /// [`physics_set_kinematic_position`] or [`physics_bulk_step_kinematics`]
    /// instead — setting velocity on a kinematic body has no effect on its motion.
    ///
    /// # Parameters
    /// * `slot`     — Entity slot index (packed entity id stripped of generation bits).
    /// * `vx`, `vy` — New linear velocity in metres per second.
    ///
    /// # Returns
    /// `Ok(1)` when the body was found and updated.
    /// `WorldNotInitialized` when `physics_init` has not run.
    /// `BodyNotFound` when the slot has no rigid body.
    #[cfg(feature = "physics2d")]
    pub fn physics_set_linear_velocity(
        &mut self,
        slot: u32,
        vx: f32,
        vy: f32,
    ) -> Result<u32, Physics2DError> {
        let Some(world) = self.physics_world.as_mut() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        if world.set_linear_velocity(slot, vx, vy) {
            Ok(1)
        } else {
            Err(Physics2DError::BodyNotFound { slot })
        }
    }

    /// Apply a linear impulse to a 2D dynamic rigid body.
    ///
    /// Instantly changes the body's velocity by `impulse / mass` and wakes it
    /// if sleeping. Use this for **dynamic** bodies only (e.g. explosions,
    /// jumps, knockback). Has no effect on kinematic or static bodies.
    ///
    /// # Parameters
    /// * `slot`     — Entity slot index (packed entity id stripped of generation bits).
    /// * `ix`, `iy` — Impulse vector in newton-seconds (kg·m/s).
    #[cfg(feature = "physics2d")]
    pub fn physics_apply_impulse(
        &mut self,
        slot: u32,
        ix: f32,
        iy: f32,
    ) -> Result<(), Physics2DError> {
        let Some(world) = self.physics_world.as_mut() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        if world.apply_impulse(slot, ix, iy) {
            Ok(())
        } else {
            Err(Physics2DError::BodyNotFound { slot })
        }
    }

    /// Create a static rigid body for a tilemap chunk at world position `(x, y)`.
    ///
    /// Tilemap chunks use a `pseudo_entity` index derived from `chunk_id` so they
    /// coexist with real entity slots without overlap. Colliders are attached
    /// separately with [`physics_add_box_collider`] using the returned handle.
    ///
    /// # Parameters
    /// * `chunk_id`      — Unique chunk identifier (fnv1a32 of the chunk key).
    /// * `pseudo_entity` — `(chunk_id | 0x80000000)` — prevents overlap with real entities.
    /// * `x`, `y`        — World-space origin of the chunk in metres.
    ///
    /// # Returns
    /// Raw body handle — pass to `physics_add_box_collider` to attach colliders.
    /// A chunk id that is already loaded is refused and the first body stays.
    #[cfg(feature = "physics2d")]
    pub fn physics_load_tilemap_chunk_body(
        &mut self,
        chunk_id: u32,
        pseudo_entity: u32,
        x: f32,
        y: f32,
    ) -> Result<u32, Physics2DError> {
        let Some(world) = self.physics_world.as_mut() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        world.load_tilemap_chunk_body(chunk_id, pseudo_entity, x, y)
    }

    /// Remove the static rigid body for a tilemap chunk and all its colliders.
    ///
    /// Refuses a chunk that was not loaded, or a world that is not initialised.
    ///
    /// # Parameters
    /// * `chunk_id` — The same identifier passed to [`physics_load_tilemap_chunk_body`].
    #[cfg(feature = "physics2d")]
    pub fn physics_unload_tilemap_chunk_body(
        &mut self,
        chunk_id: u32,
    ) -> Result<(), Physics2DError> {
        let Some(world) = self.physics_world.as_mut() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        world.unload_tilemap_chunk_body(chunk_id)
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_get_sensor_state(&self, slot: u32, collider_id: u32) -> Vec<u32> {
        if let Some(ref world) = self.physics_world {
            let (count, active) = world.get_sensor_state(slot, collider_id);
            return vec![count, if active { 1 } else { 0 }];
        }
        vec![0, 0]
    }

    // ─── Physics 2D — Events & state ──────────────────────────────────────────

    /// Set the next kinematic position (with angle) of a 2D body.
    ///
    /// # Parameters
    /// * `slot` — Entity index.
    /// * `x`, `y` — Target world-space position in metres.
    /// * `angle` — Target orientation in radians (`0.0` = no rotation, body is upright).
    ///
    /// # Returns
    /// `Ok(1)` when the body was found and updated.
    /// `WorldNotInitialized` when `physics_init` has not run.
    /// `BodyNotFound` when the slot has no rigid body.
    #[cfg(feature = "physics2d")]
    pub fn physics_set_kinematic_position(
        &mut self,
        slot: u32,
        x: f32,
        y: f32,
        angle: f32,
    ) -> Result<u32, Physics2DError> {
        let Some(world) = self.physics_world.as_mut() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        if world.set_kinematic_position(slot, x, y, angle) {
            Ok(1)
        } else {
            Err(Physics2DError::BodyNotFound { slot })
        }
    }

    /// Integrate N kinematic body positions in one WASM call.
    ///
    /// Each body `i` is moved by `(vx[i], vy[i]) * dt`.
    /// Preserves the current rotation angle of each body.
    ///
    /// # Returns
    /// Number of bodies updated.
    ///
    /// # Errors
    /// Returns [`Physics2DError::WorldNotInitialized`] when `physics_init` has
    /// not run, before any length check. Returns
    /// [`Physics2DError::BufferLengthMismatch`] when `vx` or `vy` differs in
    /// length from `slots`. `vx` is checked first. Nothing moves on either error.
    #[cfg(feature = "physics2d")]
    pub fn physics_bulk_step_kinematics(
        &mut self,
        slots: &[u32],
        vx: &[f32],
        vy: &[f32],
        dt: f32,
    ) -> Result<u32, Physics2DError> {
        let Some(world) = self.physics_world.as_mut() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        world.bulk_step_kinematics(slots, vx, vy, dt)
    }

    /// No-op stub — sensor contact state is tracked entirely in the JavaScript plugin layer
    /// via the `sensorContacts` Map. This function is exported for WASM ABI compatibility
    /// but is never called by the plugin.
    #[cfg(feature = "physics2d")]
    pub fn physics_update_sensor_state(&mut self, _slot: u32, _collider_id: u32, _active: u32) {}

    #[cfg(feature = "physics2d")]
    pub fn physics_set_linear_damping(
        &mut self,
        slot: u32,
        damping: f32,
    ) -> Result<(), Physics2DError> {
        let Some(world) = self.physics_world.as_mut() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        if !world.contains_body(slot) {
            return Err(Physics2DError::BodyNotFound { slot });
        }
        world.set_linear_damping(slot, damping);
        Ok(())
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_query_radius(
        &self,
        x: f32,
        y: f32,
        radius: f32,
        membership: u32,
        filter: u32,
    ) -> Result<Vec<u32>, Physics2DError> {
        let Some(world) = self.physics_world.as_ref() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        Ok(world.query_radius(x, y, radius, membership, filter))
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_query_rect(
        &self,
        x: f32,
        y: f32,
        hw: f32,
        hh: f32,
        membership: u32,
        filter: u32,
    ) -> Result<Vec<u32>, Physics2DError> {
        let Some(world) = self.physics_world.as_ref() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        Ok(world.query_rect(x, y, hw, hh, membership, filter))
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_point_query(
        &self,
        x: f32,
        y: f32,
        membership: u32,
        filter: u32,
    ) -> Result<Vec<u32>, Physics2DError> {
        let Some(world) = self.physics_world.as_ref() else {
            return Err(Physics2DError::WorldNotInitialized);
        };
        Ok(world.point_query(x, y, membership, filter))
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_consume_event_metrics(&mut self) -> Vec<u32> {
        vec![0, 0, 0, 0]
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_get_collision_events_ptr(&self) -> *const u8 {
        if let Some(world) = self.physics_world.as_ref() {
            world.collision_events_ptr() as *const u8
        } else {
            std::ptr::null()
        }
    }

    #[cfg(feature = "physics2d")]
    pub fn physics_get_collision_event_count(&self) -> u32 {
        if let Some(world) = self.physics_world.as_ref() {
            world.collision_event_count()
        } else {
            0
        }
    }

    // ─── Pathfinding (2D) ──────────────────────────────────────────────────────

    /// Find a 2D path. Same bounds as [`crate::physics2d::find_path_2d`].
    ///
    /// # Errors
    /// Returns [`Physics2DError::InvalidPathRequest`] when a coordinate is not
    /// finite, a rounded coordinate is outside the accepted bound, or the
    /// Manhattan distance is past the accepted bound. A refusal does not write
    /// the path buffer.
    #[cfg(feature = "physics2d")]
    pub fn path_find_2d(
        &mut self,
        from_x: f32,
        from_y: f32,
        to_x: f32,
        to_y: f32,
    ) -> Result<u32, Physics2DError> {
        crate::physics2d::pathfinding::find_path_2d(from_x, from_y, to_x, to_y)
            .map(|count| count as u32)
    }

    #[cfg(feature = "physics2d")]
    pub fn path_get_result_ptr(&self) -> *const f32 {
        crate::physics2d::pathfinding::get_path_buffer_ptr() as *const f32
    }

    // ─── Physics 3D — Pathfinding (RFC pathfinding-3d) ───────────────────────

    /// Upload a voxel navigation grid for 3D A* pathfinding.
    ///
    /// The grid memory at `ptr` is immediately copied into Rust-owned storage —
    /// the caller may free the source buffer after this returns.
    ///
    /// # Arguments
    /// * `ptr`       — WASM linear-memory pointer to the flat `u8` cell array.
    /// * `width`     — Cell count along X.
    /// * `height`    — Cell count along Y.
    /// * `depth`     — Cell count along Z.
    /// * `cell_size` — World-space size of one cubic cell in metres.
    /// * `origin_x`  — World-space X origin of the first cell.
    /// * `origin_y`  — World-space Y origin of the first cell.
    /// * `origin_z`  — World-space Z origin of the first cell.
    ///
    /// The cell count is validated and capped. The pointer is not: it comes from
    /// `__wbindgen_malloc`, which keeps no record this crate can read, so the export cannot tell
    /// whether `ptr` addresses `width * height * depth` readable bytes. The caller must
    /// guarantee it. A null pointer stores no grid.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `InvalidNavGrid` when a dimension is zero, the cell count overflows, or the cell count is
    /// above `MAX_NAVGRID_CELLS`. A refusal keeps the grid that was uploaded before.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_init_navgrid_3d(
        &mut self,
        ptr: usize,
        width: u32,
        height: u32,
        depth: u32,
        cell_size: f32,
        origin_x: f32,
        origin_y: f32,
        origin_z: f32,
    ) -> Result<(), Physics3DError> {
        let world = self.world3d_mut()?;
        // SAFETY: a null pointer stores no grid and does not read. Otherwise this reads
        // `width * height * depth` bytes, a count that is validated and capped first. The
        // pointer's origin cannot be checked: the caller must pass an address that holds that
        // many bytes. [U-004]
        unsafe {
            crate::physics3d::pathfinding::init_navgrid_3d(
                world.nav_grid_mut(),
                ptr as *const u8,
                width,
                height,
                depth,
                cell_size,
                origin_x,
                origin_y,
                origin_z,
            )
        }
    }

    /// Find a path in the uploaded 3D voxel grid using A*.
    ///
    /// Returns the number of waypoints written to the static path buffer.
    /// Read the results via [`physics3d_get_path_buffer_ptr_3d`].
    ///
    /// # Arguments
    /// * `from_x/from_y/from_z` — World-space start position.
    /// * `to_x/to_y/to_z`       — World-space goal position.
    ///
    /// # Returns
    /// Waypoint count.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `NavGridNotInitialized` when no grid has been uploaded.
    /// `InvalidPathRequest` when a rounded cell coordinate is not finite or is past
    /// `MAX_PATH_COORD`. A refusal does not write the path buffer.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_find_path_3d(
        &mut self,
        from_x: f32,
        from_y: f32,
        from_z: f32,
        to_x: f32,
        to_y: f32,
        to_z: f32,
    ) -> Result<u32, Physics3DError> {
        let world = self.world3d()?;
        crate::physics3d::pathfinding::find_path_checked(
            world.nav_grid(),
            (from_x, from_y, from_z),
            (to_x, to_y, to_z),
        )
        .map(|count| count as u32)
    }

    /// Returns the WASM linear-memory pointer to the 3D path waypoint buffer.
    ///
    /// Each waypoint is stored as three consecutive `f32` values `(x, y, z)`.
    /// Wrap the returned pointer in a `Float32Array` view over WASM linear memory.
    /// Valid until the next [`physics3d_find_path_3d`] call.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_get_path_buffer_ptr_3d(&mut self) -> u32 {
        crate::physics3d::pathfinding::get_path_buffer_ptr_3d() as u32
    }

    // ─── Physics 3D — World lifecycle ─────────────────────────────────────────

    #[cfg(feature = "physics3d")]
    pub fn physics3d_init(&mut self, gx: f32, gy: f32, gz: f32, _max_entities: u32) {
        self.physics3d_world = Some(PhysicsWorld3D::new(gx, gy, gz));
    }

    /// Advance the 3D simulation by `delta` seconds.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_step(&mut self, delta: f32) -> Result<(), Physics3DError> {
        let world = self.world3d_mut()?;
        world.step(delta);
        Ok(())
    }

    /// Register a new 3D rigid body for the given entity index.
    ///
    /// Returns `Ok(true)` once the body is registered.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `InvalidBodyKind` when `kind` is not 0, 1 or 2.
    /// `BodyAlreadyExists` when the slot already has a body; the first body is kept.
    ///
    /// # Arguments
    /// * `entity_index`    — ECS entity slot index.
    /// * `x`, `y`, `z`    — Initial world-space position.
    /// * `kind`            — `0` = Fixed, `1` = Dynamic, `2` = KinematicPositionBased.
    /// * `mass`            — Body mass in kg (dynamic bodies only).
    /// * `linear_damping`  — Linear velocity damping coefficient.
    /// * `angular_damping` — Angular velocity damping coefficient.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_body(
        &mut self,
        entity_index: u32,
        x: f32,
        y: f32,
        z: f32,
        kind: u8,
        mass: f32,
        linear_damping: f32,
        angular_damping: f32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        check_body_kind(kind)?;
        if world.has_body(entity_index) {
            return Err(Physics3DError::BodyAlreadyExists { slot: entity_index });
        }
        world.add_body(
            entity_index,
            x,
            y,
            z,
            kind,
            mass,
            linear_damping,
            angular_damping,
        );
        Ok(true)
    }

    // ─── Physics 3D — Body management ─────────────────────────────────────────

    /// Remove the 3D rigid body registered for the given entity index.
    ///
    /// Returns `Ok(true)` once the body is removed.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_remove_body(&mut self, entity_index: u32) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(world.remove_body(entity_index), entity_index)
    }

    /// Return `Ok(true)` if a 3D body is registered for the given entity index.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_has_body(&self, entity_index: u32) -> Result<bool, Physics3DError> {
        let world = self.world3d()?;
        Ok(world.has_body(entity_index))
    }

    /// Return the full body state as a flat `Float32Array` of 13 elements.
    ///
    /// Layout: `[px, py, pz, qx, qy, qz, qw, vx, vy, vz, ax, ay, az]`
    ///
    /// Returns an empty array if the entity has no body.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_get_body_state(&self, entity_index: u32) -> Result<Vec<f32>, Physics3DError> {
        let world = self.world3d()?;
        Ok(world.get_body_state(entity_index))
    }

    /// Overwrite all state fields of an existing 3D body in one call.
    ///
    /// Returns `Ok(true)` once the state is written.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    ///
    /// # Arguments
    /// * `entity_index`    — ECS entity slot index.
    /// * `px/py/pz`        — New world-space position.
    /// * `qx/qy/qz/qw`    — New orientation (unit quaternion).
    /// * `vx/vy/vz`        — New linear velocity.
    /// * `ax/ay/az`        — New angular velocity.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_set_body_state(
        &mut self,
        entity_index: u32,
        px: f32,
        py: f32,
        pz: f32,
        qx: f32,
        qy: f32,
        qz: f32,
        qw: f32,
        vx: f32,
        vy: f32,
        vz: f32,
        ax: f32,
        ay: f32,
        az: f32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(
            world.set_body_state(
                entity_index,
                px,
                py,
                pz,
                qx,
                qy,
                qz,
                qw,
                vx,
                vy,
                vz,
                ax,
                ay,
                az,
            ),
            entity_index,
        )
    }

    /// Return the linear velocity of a 3D body as `[vx, vy, vz]`.
    ///
    /// Returns an empty array if the entity has no body.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_get_linear_velocity(
        &self,
        entity_index: u32,
    ) -> Result<Vec<f32>, Physics3DError> {
        let world = self.world3d()?;
        Ok(world.get_linear_velocity(entity_index))
    }

    /// Set the linear velocity of a 3D body.
    ///
    /// Returns `Ok(true)` once the velocity is set.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_set_linear_velocity(
        &mut self,
        entity_index: u32,
        vx: f32,
        vy: f32,
        vz: f32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(
            world.set_linear_velocity(entity_index, vx, vy, vz),
            entity_index,
        )
    }

    /// Return the angular velocity of a 3D body as `[ax, ay, az]` (rad/s).
    ///
    /// Returns an empty array if the entity has no body.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_get_angular_velocity(
        &self,
        entity_index: u32,
    ) -> Result<Vec<f32>, Physics3DError> {
        let world = self.world3d()?;
        Ok(world.get_angular_velocity(entity_index))
    }

    /// Set the angular velocity of a 3D body.
    ///
    /// Returns `Ok(true)` once the velocity is set.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_set_angular_velocity(
        &mut self,
        entity_index: u32,
        ax: f32,
        ay: f32,
        az: f32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(
            world.set_angular_velocity(entity_index, ax, ay, az),
            entity_index,
        )
    }

    /// Apply a world-space linear impulse to a 3D body.
    ///
    /// Wakes the body if sleeping. Returns `Ok(true)` once applied.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `ix/iy/iz`     — Impulse vector (N·s).
    #[cfg(feature = "physics3d")]
    pub fn physics3d_apply_impulse(
        &mut self,
        entity_index: u32,
        ix: f32,
        iy: f32,
        iz: f32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(world.apply_impulse(entity_index, ix, iy, iz), entity_index)
    }

    /// Return the body kind discriminant for a 3D body.
    ///
    /// Returns `0` = Fixed, `1` = Dynamic, `2` = KinematicPositionBased.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    /// `InvalidBodyKind` when Rapier reports a body type this API never creates.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_get_body_kind(&self, entity_index: u32) -> Result<u8, Physics3DError> {
        let world = self.world3d()?;
        if !world.has_body(entity_index) {
            return Err(Physics3DError::BodyNotFound { slot: entity_index });
        }
        match world.get_body_kind(entity_index) {
            kind @ 0..=2 => Ok(kind),
            kind => Err(Physics3DError::InvalidBodyKind { kind }),
        }
    }

    /// Change the body kind of an existing 3D body at runtime.
    ///
    /// Returns `Ok(true)` once the kind is changed.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `InvalidBodyKind` when `kind` is not 0, 1 or 2; the body keeps its kind.
    /// `BodyNotFound` when the slot has no body.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `kind`         — `0` = Fixed, `1` = Dynamic, `2` = KinematicPositionBased.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_set_body_kind(
        &mut self,
        entity_index: u32,
        kind: u8,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        check_body_kind(kind)?;
        body_found(world.set_body_kind(entity_index, kind), entity_index)
    }

    // ─── Physics 3D — Collider management ──────────────────────────────────────

    /// Attach an axis-aligned box collider to a 3D body.
    ///
    /// # Arguments
    /// * `entity_index`    — ECS entity slot index.
    /// * `half_x/y/z`     — Box half-extents (metres).
    /// * `offset_x/y/z`   — Local-space offset from the body origin.
    /// * `is_sensor`       — If `true`, collision response is suppressed; only events fire.
    /// * `friction`        — Surface friction coefficient (≥ 0).
    /// * `restitution`     — Bounciness coefficient (\[0, 1\]).
    /// * `layer_bits`      — Collision layer membership bitmask.
    /// * `mask_bits`       — Collision filter bitmask (which layers this collider hits).
    /// * `collider_id`     — Stable application-defined ID stored in collision events.
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`] before `physics3d_init`,
    /// [`Physics3DError::BodyNotFound`] when the entity has no body, and typed shape errors:
    /// INVALID_COLLIDER for a size, offset or coefficient that is not finite, a negative size, or a value above `MAX_COLLIDER_MAGNITUDE`.
    /// COLLIDER_ALREADY_EXISTS when `(entity_index, collider_id)` is already registered; this is checked after the shape and values, and before anything is inserted.
    /// The world is unchanged on error. The success value is `true`.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_box_collider(
        &mut self,
        entity_index: u32,
        half_x: f32,
        half_y: f32,
        half_z: f32,
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.add_box_collider(
            entity_index,
            half_x,
            half_y,
            half_z,
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        )?;
        Ok(true)
    }

    /// Attach a sphere collider to a 3D body.
    ///
    /// # Arguments
    /// * `entity_index`    — ECS entity slot index.
    /// * `radius`          — Sphere radius (metres).
    /// * `offset_x/y/z`   — Local-space offset from the body origin.
    /// * `is_sensor`       — If `true`, collision response is suppressed; only events fire.
    /// * `friction`        — Surface friction coefficient (≥ 0).
    /// * `restitution`     — Bounciness coefficient (\[0, 1\]).
    /// * `layer_bits`      — Collision layer membership bitmask.
    /// * `mask_bits`       — Collision filter bitmask.
    /// * `collider_id`     — Stable application-defined ID stored in collision events.
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`] before `physics3d_init`,
    /// [`Physics3DError::BodyNotFound`] when the entity has no body, and typed shape errors:
    /// INVALID_COLLIDER as for the box.
    /// COLLIDER_ALREADY_EXISTS when `(entity_index, collider_id)` is already registered; this is checked after the shape and values, and before anything is inserted.
    /// The world is unchanged on error. The success value is `true`.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_sphere_collider(
        &mut self,
        entity_index: u32,
        radius: f32,
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.add_sphere_collider(
            entity_index,
            radius,
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        )?;
        Ok(true)
    }

    /// Attach a Y-axis capsule collider to a 3D body.
    ///
    /// The capsule extends `±half_height` metres along the Y axis, capped by
    /// hemispheres of `radius` metres.
    ///
    /// # Arguments
    /// * `entity_index`    — ECS entity slot index.
    /// * `radius`          — Hemisphere radius (metres).
    /// * `half_height`     — Half-length of the cylindrical shaft (metres).
    /// * `offset_x/y/z`   — Local-space offset from the body origin.
    /// * `is_sensor`       — If `true`, collision response is suppressed; only events fire.
    /// * `friction`        — Surface friction coefficient (≥ 0).
    /// * `restitution`     — Bounciness coefficient (\[0, 1\]).
    /// * `layer_bits`      — Collision layer membership bitmask.
    /// * `mask_bits`       — Collision filter bitmask.
    /// * `collider_id`     — Stable application-defined ID stored in collision events.
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`] before `physics3d_init`,
    /// [`Physics3DError::BodyNotFound`] when the entity has no body, and typed shape errors:
    /// INVALID_COLLIDER as for the box.
    /// COLLIDER_ALREADY_EXISTS when `(entity_index, collider_id)` is already registered; this is checked after the shape and values, and before anything is inserted.
    /// The world is unchanged on error. The success value is `true`.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_capsule_collider(
        &mut self,
        entity_index: u32,
        radius: f32,
        half_height: f32,
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.add_capsule_collider(
            entity_index,
            radius,
            half_height,
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        )?;
        Ok(true)
    }

    /// Attach a heightfield collider to a 3D fixed body.
    ///
    /// The heightfield is defined on a `rows × cols` grid. Pass a row-major
    /// `Float32Array` from JavaScript.
    ///
    /// # Arguments
    /// * `entity_index`  — ECS entity slot index.
    /// * `heights_flat`  — Row-major `Float32Array` of `rows × cols` heights.
    /// * `rows`          — Number of rows (Z axis).
    /// * `cols`          — Number of columns (X axis).
    /// * `scale_x`       — World-space width of the entire heightfield (metres).
    /// * `scale_y`       — World-space maximum height multiplier (metres).
    /// * `scale_z`       — World-space depth of the entire heightfield (metres).
    /// * `friction`      — Surface friction coefficient (≥ 0).
    /// * `restitution`   — Bounciness coefficient (\[0, 1\]).
    /// * `layer_bits`    — Collision layer membership bitmask.
    /// * `mask_bits`     — Collision filter bitmask.
    /// * `collider_id`   — Stable application-defined ID stored in collision events.
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`] before `physics3d_init`,
    /// [`Physics3DError::BodyNotFound`] when the entity has no body, and typed shape errors:
    /// INVALID_SHAPE for fewer than 2 rows or columns or a sample count that differs from `rows * cols`, and INVALID_COLLIDER.
    /// COLLIDER_ALREADY_EXISTS when `(entity_index, collider_id)` is already registered; this is checked after the shape and values, and before anything is inserted.
    /// The world is unchanged on error. The success value is `true`.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_heightfield_collider(
        &mut self,
        entity_index: u32,
        heights_flat: &[f32],
        rows: u32,
        cols: u32,
        scale_x: f32,
        scale_y: f32,
        scale_z: f32,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.add_heightfield_collider(
            entity_index,
            heights_flat,
            rows,
            cols,
            scale_x,
            scale_y,
            scale_z,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        )?;
        Ok(true)
    }

    /// Replace the height data of an existing heightfield collider.
    ///
    /// Atomically removes the old collider and inserts a new one with the
    /// provided height data. All other parameters (scale, friction, layers)
    /// must be re-supplied. The input is validated before the old collider is removed.
    ///
    /// # Arguments
    /// * `entity_index`  — ECS entity slot index.
    /// * `collider_id`   — Stable ID that was passed when the collider was created.
    /// * `heights_flat`  — Updated row-major `Float32Array` of `rows × cols` heights.
    /// * `rows`          — Number of rows (Z axis) — must match original.
    /// * `cols`          — Number of columns (X axis) — must match original.
    /// * `scale_x`       — World-space width (metres).
    /// * `scale_y`       — World-space height multiplier (metres).
    /// * `scale_z`       — World-space depth (metres).
    /// * `friction`      — Surface friction coefficient (≥ 0).
    /// * `restitution`   — Bounciness coefficient (\[0, 1\]).
    /// * `layer_bits`    — Collision layer membership bitmask.
    /// * `mask_bits`     — Collision filter bitmask.
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`] before `physics3d_init`,
    /// [`Physics3DError::BodyNotFound`] when the entity has no body, and typed shape errors:
    /// the same as `physics3d_add_heightfield_collider`; the old collider is kept on every error.
    /// The world is unchanged on error. The success value is `true`.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_update_heightfield_collider(
        &mut self,
        entity_index: u32,
        collider_id: u32,
        heights_flat: &[f32],
        rows: u32,
        cols: u32,
        scale_x: f32,
        scale_y: f32,
        scale_z: f32,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.update_heightfield_collider(
            entity_index,
            collider_id,
            heights_flat,
            rows,
            cols,
            scale_x,
            scale_y,
            scale_z,
            friction,
            restitution,
            layer_bits,
            mask_bits,
        )?;
        Ok(true)
    }

    /// Attach a triangle-mesh (trimesh) collider to a 3D body.
    ///
    /// # Arguments
    /// * `entity_index`    — ECS entity slot index.
    /// * `vertices`        — Flat vertex buffer `[x0,y0,z0, x1,y1,z1, ...]` (length multiple of 3).
    /// * `indices`         — Flat index buffer `[a0,b0,c0, ...]` (length multiple of 3).
    /// * `offset_x/y/z`   — Local-space offset from the body origin (metres).
    /// * `is_sensor`       — When `true`, collision response is suppressed; only events fire.
    /// * `friction`        — Surface friction coefficient (≥ 0).
    /// * `restitution`     — Bounciness coefficient (\[0, 1\]).
    /// * `layer_bits`      — Collision layer membership bitmask.
    /// * `mask_bits`       — Collision filter bitmask.
    /// * `collider_id`     — Stable application-defined ID stored in collision events.
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`] before `physics3d_init`,
    /// [`Physics3DError::BodyNotFound`] when the entity has no body, and typed shape errors:
    /// INVALID_MESH_BUFFER when `vertices` or `indices` is not a multiple of 3, INVALID_SHAPE for an empty mesh or an index past the vertex count, and INVALID_COLLIDER.
    /// COLLIDER_ALREADY_EXISTS when `(entity_index, collider_id)` is already registered; this is checked after the shape and values, and before anything is inserted.
    /// The world is unchanged on error. The success value is `true`.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_mesh_collider(
        &mut self,
        entity_index: u32,
        vertices: &[f32],
        indices: &[u32],
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.add_mesh_collider(
            entity_index,
            vertices,
            indices,
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        )?;
        Ok(true)
    }

    /// Rebuild a mesh collider with new geometry at runtime.
    ///
    /// Removes the collider identified by `(entity_index, collider_id)` from the Rapier3D
    /// world and re-inserts a new trimesh built from `vertices_flat` and `indices_flat`.
    /// If no matching collider exists, a new one is created (same result as calling
    /// `physics3d_add_mesh_collider`).
    ///
    /// The input is validated before the old collider is removed.
    ///
    /// # Arguments
    /// * `entity_index`  — ECS entity slot index.
    /// * `collider_id`   — Stable ID that was passed when the collider was created.
    /// * `vertices_flat` — New vertex positions `[x0,y0,z0, x1,y1,z1, ...]`.
    /// * `indices_flat`  — New triangle indices `[a0,b0,c0, ...]`.
    /// * `offset_x/y/z` — Local-space offset from the body origin.
    /// * `is_sensor`     — If `true`, collision response is suppressed; only events fire.
    /// * `friction`      — Surface friction coefficient (≥ 0).
    /// * `restitution`   — Bounciness coefficient (\[0, 1\]).
    /// * `layer_bits`    — Collision layer membership bitmask.
    /// * `mask_bits`     — Collision filter bitmask.
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`] before `physics3d_init`,
    /// [`Physics3DError::BodyNotFound`] when the entity has no body, and typed shape errors:
    /// the same as `physics3d_add_mesh_collider`; the old collider is kept on every error.
    /// The world is unchanged on error. The success value is `true`.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_rebuild_mesh_collider(
        &mut self,
        entity_index: u32,
        collider_id: u32,
        vertices_flat: &[f32],
        indices_flat: &[u32],
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.rebuild_mesh_collider(
            entity_index,
            collider_id,
            vertices_flat,
            indices_flat,
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            layer_bits,
            mask_bits,
        )?;
        Ok(true)
    }

    /// Attach a convex-hull collider to a 3D body.
    ///
    /// The hull is computed with the fallible `try_convex_hull`; a degenerate cloud is refused
    /// instead of falling back to a sphere.
    ///
    /// # Arguments
    /// * `entity_index`    — ECS entity slot index.
    /// * `vertices`        — Flat vertex buffer `[x0,y0,z0, x1,y1,z1, ...]` (length multiple of 3).
    /// * `offset_x/y/z`   — Local-space offset from the body origin (metres).
    /// * `is_sensor`       — When `true`, collision response is suppressed; only events fire.
    /// * `friction`        — Surface friction coefficient (≥ 0).
    /// * `restitution`     — Bounciness coefficient (\[0, 1\]).
    /// * `density`         — Collider density (kg/m³). Applied to dynamic bodies.
    /// * `layer_bits`      — Collision layer membership bitmask.
    /// * `mask_bits`       — Collision filter bitmask.
    /// * `collider_id`     — Stable application-defined ID stored in collision events.
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`] before `physics3d_init`,
    /// [`Physics3DError::BodyNotFound`] when the entity has no body, and typed shape errors:
    /// INVALID_SHAPE for fewer than 4 points or a cloud that `try_convex_hull` rejects, and INVALID_COLLIDER.
    /// COLLIDER_ALREADY_EXISTS when `(entity_index, collider_id)` is already registered; this is checked after the shape and values, and before anything is inserted.
    /// The world is unchanged on error. The success value is `true`.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_convex_collider(
        &mut self,
        entity_index: u32,
        vertices: &[f32],
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        density: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.add_convex_collider(
            entity_index,
            vertices,
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            density,
            layer_bits,
            mask_bits,
            collider_id,
        )?;
        Ok(true)
    }

    /// Load a pre-baked BVH buffer as a trimesh collider.
    ///
    /// The `bvh_bytes` must have been produced by `build_bvh_buffer()` or
    /// `build_bvh_from_glb()` (the `build-tools` feature). Deserialising the
    /// pre-baked [`rapier3d::geometry::TriMesh`] costs ~2 ms vs ~50 ms for a
    /// fresh `trimesh()` build on large meshes.
    ///
    /// # Arguments
    /// * `entity_index`  — ECS entity slot index.
    /// * `bvh_bytes`     — Pre-baked BVH buffer produced by `build_bvh_buffer` or
    ///                     `build_bvh_from_glb` (GBVH header + bincode `TriMesh`).
    /// * `offset_x/y/z`  — Local-space offset from the body origin (metres).
    /// * `is_sensor`     — When `true`, collision response is suppressed; only events fire.
    /// * `friction`      — Surface friction coefficient (≥ 0).
    /// * `restitution`   — Bounciness coefficient (\[0, 1\]).
    /// * `layer_bits`    — Collision layer membership bitmask.
    /// * `mask_bits`     — Collision filter bitmask.
    /// * `collider_id`   — Stable application-defined collider ID.
    ///
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`] before `physics3d_init`,
    /// [`Physics3DError::BodyNotFound`] when the entity has no body, and typed shape errors:
    /// BVH_LOAD_FAILED for a short buffer, a wrong magic, an undecodable payload or an invalid decoded mesh, and INVALID_COLLIDER.
    /// COLLIDER_ALREADY_EXISTS when `(entity_index, collider_id)` is already registered; this is checked after the shape and values, and before anything is inserted.
    /// The world is unchanged on error. The success value is `true`.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_load_bvh_collider(
        &mut self,
        entity_index: u32,
        bvh_bytes: &[u8],
        offset_x: f32,
        offset_y: f32,
        offset_z: f32,
        is_sensor: bool,
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
        collider_id: u32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.load_bvh_collider(
            entity_index,
            bvh_bytes,
            offset_x,
            offset_y,
            offset_z,
            is_sensor,
            friction,
            restitution,
            layer_bits,
            mask_bits,
            collider_id,
        )?;
        Ok(true)
    }

    /// Bulk-spawn N static box bodies in one call.
    ///
    /// Entity indices must be pre-allocated by the TypeScript caller via
    /// `engine.createEntity()`. This function creates the Rapier bodies and
    /// attaches box colliders in one Rust pass.
    ///
    /// Returns the number of bodies successfully created.
    ///
    /// # Arguments
    /// * `entity_indices`    — Pre-allocated ECS entity slot indices (one per body).
    /// * `positions_flat`    — Flat `[x0,y0,z0, x1,y1,z1, ...]` — `N × 3` f32 elements.
    /// * `half_extents_flat` — Either 3 floats (uniform) or `N × 3` floats (per-entity).
    /// * `friction`          — Surface friction coefficient (≥ 0).
    /// * `restitution`       — Bounciness coefficient (\[0, 1\]).
    /// * `layer_bits`        — Collision layer membership bitmask.
    /// * `mask_bits`         — Collision filter bitmask.
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`]; `BUFFER_LENGTH_MISMATCH` naming `positions`
    /// or `half_extents` when a buffer is shorter than `N * 3`; `BODY_ALREADY_EXISTS` when a slot is
    /// registered or listed twice; `INVALID_COLLIDER` for a refused position, extent or coefficient.
    /// Nothing is written on error.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_bulk_spawn_static_boxes(
        &mut self,
        entity_indices: &[u32],
        positions_flat: &[f32],
        half_extents_flat: &[f32],
        friction: f32,
        restitution: f32,
        layer_bits: u32,
        mask_bits: u32,
    ) -> Result<u32, Physics3DError> {
        let world = self.world3d_mut()?;
        world.bulk_add_static_boxes(
            entity_indices,
            positions_flat,
            half_extents_flat,
            friction,
            restitution,
            layer_bits,
            mask_bits,
        )
    }

    /// Attach multiple primitive colliders to one 3D body in a single WASM call.
    ///
    /// The `shape_data` slice encodes 12 `f32` values per shape:
    /// `[shape_type, p0, p1, p2, p3, offset_x, offset_y, offset_z, is_sensor, friction, restitution, collider_id]`
    ///
    /// Shape types: `0` = BOX, `1` = SPHERE, `2` = CAPSULE.
    ///
    /// `layer_bits` and `mask_bits` apply to all shapes in the batch.
    ///
    /// # Returns
    /// Number of colliders successfully inserted; `0` if the world is not
    /// initialised, the entity has no body, or `shape_data` is malformed.
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`], [`Physics3DError::BodyNotFound`],
    /// `INVALID_COMPOUND` for a length that is not a multiple of 12 or an unknown shape type
    /// (refused, not skipped), and `INVALID_COLLIDER` for a refused size, offset, coefficient or
    /// COLLIDER_ALREADY_EXISTS when a part id is already registered for the slot or repeats inside the buffer; nothing is inserted.
    /// id. Nothing is inserted on error.
    #[cfg(feature = "physics3d")]
    #[wasm_bindgen]
    pub fn physics3d_add_compound_collider(
        &mut self,
        entity_index: u32,
        shape_data: &[f32],
        layer_bits: u32,
        mask_bits: u32,
    ) -> Result<u32, Physics3DError> {
        let world = self.world3d_mut()?;
        world.add_compound_collider(entity_index, shape_data, layer_bits, mask_bits)
    }

    /// Remove a specific collider from a 3D body.
    ///
    /// Returns `false` if the collider was not found or the world is not
    /// initialised.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `collider_id`  — Stable ID that was passed when the collider was created.
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`] before `physics3d_init` and
    /// [`Physics3DError::ColliderNotFound`] when no collider is registered under the pair.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_remove_collider(
        &mut self,
        entity_index: u32,
        collider_id: u32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.remove_collider(entity_index, collider_id)?;
        Ok(true)
    }

    /// Set the next kinematic position and orientation of a 3D body.
    ///
    /// Only affects bodies of kind `2` (KinematicPositionBased). Rapier
    /// interpolates from the current to the next position when computing
    /// collision response.
    ///
    /// Returns `Ok(true)` once the target is stored.
    ///
    /// # Arguments
    /// * `entity_index`    — ECS entity slot index.
    /// * `px/py/pz`        — Target world-space position.
    /// * `qx/qy/qz/qw`    — Target orientation as a unit quaternion (xyzw order).
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_set_kinematic_position(
        &mut self,
        entity_index: u32,
        px: f32,
        py: f32,
        pz: f32,
        qx: f32,
        qy: f32,
        qz: f32,
        qw: f32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(
            world.set_kinematic_position(entity_index, px, py, pz, qx, qy, qz, qw),
            entity_index,
        )
    }

    /// Integrate the positions of N 3D kinematic bodies in one WASM call.
    ///
    /// Each body `i` is moved by `(vx[i], vy[i], vz[i]) * dt`.
    /// Orientation is preserved. All slice lengths must be equal.
    ///
    /// # Arguments
    /// * `slots` — Entity indices.
    /// * `vx`, `vy`, `vz` — Velocity components in m/s.
    /// * `dt` — Delta time in seconds.
    ///
    /// # Returns
    /// Number of bodies updated.
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`] and `BUFFER_LENGTH_MISMATCH` naming `vx`,
    /// `vy` or `vz` (checked in that order). No body moves on error.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_bulk_step_kinematics(
        &mut self,
        slots: &[u32],
        vx: &[f32],
        vy: &[f32],
        vz: &[f32],
        dt: f32,
    ) -> Result<u32, Physics3DError> {
        let world = self.world3d_mut()?;
        world.bulk_step_kinematics(slots, vx, vy, vz, dt)
    }

    /// Integrate the orientations of N 3D kinematic bodies in one WASM call.
    ///
    /// Applies first-order quaternion integration to each body using the supplied
    /// angular velocity `(wx[i], wy[i], wz[i])` in rad/s. Position is preserved.
    ///
    /// # Arguments
    /// * `slots` — Entity indices.
    /// * `wx`, `wy`, `wz` — Angular velocity components in rad/s (world-space).
    /// * `dt` — Delta time in seconds.
    ///
    /// # Returns
    /// Number of bodies updated.
    ///
    /// # Errors
    /// Returns [`Physics3DError::WorldNotInitialized`] and `BUFFER_LENGTH_MISMATCH` naming `wx`,
    /// `wy` or `wz` (checked in that order). No body moves on error.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_bulk_step_kinematic_rotations(
        &mut self,
        slots: &[u32],
        wx: &[f32],
        wy: &[f32],
        wz: &[f32],
        dt: f32,
    ) -> Result<u32, Physics3DError> {
        let world = self.world3d_mut()?;
        world.bulk_step_kinematic_rotations(slots, wx, wy, wz, dt)
    }

    /// Apply a world-space angular (torque) impulse to a 3D body.
    ///
    /// Immediately changes the body's angular velocity. Wakes the body if
    /// sleeping. Returns `Ok(true)` once applied.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `ax/ay/az`     — Angular impulse vector (N·m·s).
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_apply_angular_impulse(
        &mut self,
        entity_index: u32,
        ax: f32,
        ay: f32,
        az: f32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(
            world.apply_angular_impulse(entity_index, ax, ay, az),
            entity_index,
        )
    }

    // ─── Physics 3D — RFC-09: Forces, torques, gravity scale, locks, sleep ────

    /// Apply a continuous force to a dynamic body for the current simulation step.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index of the target body.
    /// * `fx` / `fy` / `fz` — Force vector in world space (Newtons).
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_add_force(
        &mut self,
        entity_index: u32,
        fx: f32,
        fy: f32,
        fz: f32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(world.add_force(entity_index, fx, fy, fz), entity_index)
    }

    /// Apply a continuous torque to a dynamic body for the current simulation step.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index of the target body.
    /// * `tx` / `ty` / `tz` — Torque vector in world space (Newton-metres).
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_add_torque(
        &mut self,
        entity_index: u32,
        tx: f32,
        ty: f32,
        tz: f32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(world.add_torque(entity_index, tx, ty, tz), entity_index)
    }

    /// Apply a continuous force at a world-space point on a dynamic body.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index of the target body.
    /// * `fx` / `fy` / `fz` — Force vector (Newtons).
    /// * `px` / `py` / `pz` — World-space application point.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_force_at_point(
        &mut self,
        entity_index: u32,
        fx: f32,
        fy: f32,
        fz: f32,
        px: f32,
        py: f32,
        pz: f32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(
            world.add_force_at_point(entity_index, fx, fy, fz, px, py, pz),
            entity_index,
        )
    }

    /// Set the gravity scale multiplier for a body.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `scale` — Gravity multiplier (`0.0` = weightless, `1.0` = normal).
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_set_gravity_scale(
        &mut self,
        entity_index: u32,
        scale: f32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(world.set_gravity_scale(entity_index, scale), entity_index)
    }

    /// Read the current gravity scale multiplier of a body.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    ///
    /// Returns the multiplier.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_get_gravity_scale(&self, entity_index: u32) -> Result<f32, Physics3DError> {
        let world = self.world3d()?;
        if !world.has_body(entity_index) {
            return Err(Physics3DError::BodyNotFound { slot: entity_index });
        }
        Ok(world.get_gravity_scale(entity_index))
    }

    /// Additively lock translation axes for a body.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `x` / `y` / `z` — Lock each axis when `true`.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_lock_translations(
        &mut self,
        entity_index: u32,
        x: bool,
        y: bool,
        z: bool,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(world.lock_translations(entity_index, x, y, z), entity_index)
    }

    /// Additively lock rotation axes for a body.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `x` / `y` / `z` — Lock rotation about each axis when `true`.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_lock_rotations(
        &mut self,
        entity_index: u32,
        x: bool,
        y: bool,
        z: bool,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(world.lock_rotations(entity_index, x, y, z), entity_index)
    }

    /// Put a body to sleep (`sleeping = true`) or force it awake (`sleeping = false`).
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `sleeping`     — Desired sleep state.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_set_body_sleeping(
        &mut self,
        entity_index: u32,
        sleeping: bool,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(
            world.set_body_sleeping(entity_index, sleeping),
            entity_index,
        )
    }

    /// Return whether a body is currently sleeping.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    ///
    /// Returns `true` when the body sleeps.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_is_body_sleeping(&self, entity_index: u32) -> Result<bool, Physics3DError> {
        let world = self.world3d()?;
        if !world.has_body(entity_index) {
            return Err(Physics3DError::BodyNotFound { slot: entity_index });
        }
        Ok(world.is_body_sleeping(entity_index))
    }

    /// Wake every dynamic body in the simulation.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_wake_all(&mut self) -> Result<(), Physics3DError> {
        let world = self.world3d_mut()?;
        world.wake_all();
        Ok(())
    }

    /// Sets additional per-body solver iterations for better simulation accuracy.
    ///
    /// A value of `0` uses the world-level default. Higher values increase accuracy
    /// for fast-moving or heavily constrained bodies at additional CPU cost.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `iterations`   — Number of additional iterations (0 = world default).
    ///
    /// # Returns
    /// `Ok(true)` once the iteration count is stored.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_set_body_solver_iterations(
        &mut self,
        entity_index: u32,
        iterations: u32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        body_found(
            world.set_body_solver_iterations(entity_index, iterations),
            entity_index,
        )
    }

    // ─── Physics 3D — Spatial queries (RFC-07) ────────────────────────────────

    /// Cast a ray and return the first hit.
    ///
    /// # Returns
    /// 9 floats on hit `[1.0, entity, toi, nx, ny, nz, px, py, pz]`, or `[0.0]` on miss.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_cast_ray(
        &self,
        ox: f32,
        oy: f32,
        oz: f32,
        dx: f32,
        dy: f32,
        dz: f32,
        max_dist: f32,
        layers: u32,
        mask: u32,
        solid: bool,
    ) -> Result<Vec<f32>, Physics3DError> {
        let world = self.world3d()?;
        Ok(world.cast_ray(ox, oy, oz, dx, dy, dz, max_dist, layers, mask, solid))
    }

    /// Cast a shape along a direction and return the first collision.
    ///
    /// # Returns
    /// 15 floats on hit or `[0.0]` on miss. See [`PhysicsWorld3D::cast_shape`].
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_cast_shape(
        &self,
        pos_x: f32,
        pos_y: f32,
        pos_z: f32,
        rot_x: f32,
        rot_y: f32,
        rot_z: f32,
        rot_w: f32,
        dir_x: f32,
        dir_y: f32,
        dir_z: f32,
        shape_type: u32,
        p0: f32,
        p1: f32,
        p2: f32,
        max_dist: f32,
        layers: u32,
        mask: u32,
    ) -> Result<Vec<f32>, Physics3DError> {
        let world = self.world3d()?;
        Ok(world.cast_shape(
            pos_x, pos_y, pos_z, rot_x, rot_y, rot_z, rot_w, dir_x, dir_y, dir_z, shape_type, p0,
            p1, p2, max_dist, layers, mask,
        ))
    }

    /// Find all colliders overlapping a shape, writing entity indices to a WASM memory pointer.
    ///
    /// `out_ptr` must be the start of a live [`Self::alloc_shared_buffer`] allocation of at
    /// least `max_results * 4` bytes. The check runs before the output slice is built.
    ///
    /// # Returns
    /// Number of overlapping entities written to `out_ptr`.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `Core(InvalidSharedBuffer)` when `out_ptr` is null, is not the start of a live shared
    /// allocation of this engine, or the allocation is shorter than `max_results * 4` bytes.
    /// A refusal writes nothing.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_overlap_shape(
        &self,
        pos_x: f32,
        pos_y: f32,
        pos_z: f32,
        rot_x: f32,
        rot_y: f32,
        rot_z: f32,
        rot_w: f32,
        shape_type: u32,
        p0: f32,
        p1: f32,
        p2: f32,
        layers: u32,
        mask: u32,
        out_ptr: u32,
        max_results: u32,
    ) -> Result<u32, Physics3DError> {
        let world = self.world3d()?;
        self.check_shared_u32_slots(out_ptr as usize, max_results)?;
        let out_slots = out_ptr as usize as *mut u32;
        let slot_count = max_results as usize;
        // SAFETY: `check_shared_u32_slots` just proved that `out_slots` is the start of a live
        // allocation made by `alloc_shared_buffer` (8-byte aligned, so 4-byte aligned) of at
        // least `slot_count * 4` bytes, and nothing else in this engine holds a reference into
        // it. The slice does not outlive this call. [U-013]
        let out = unsafe { std::slice::from_raw_parts_mut(out_slots, slot_count) };
        Ok(world.overlap_shape(
            pos_x, pos_y, pos_z, rot_x, rot_y, rot_z, rot_w, shape_type, p0, p1, p2, layers, mask,
            out,
        ))
    }

    /// Project a world-space point onto the nearest collider.
    ///
    /// # Returns
    /// 6 floats on hit `[1.0, entity, px, py, pz, is_inside]`, or `[0.0]` on miss.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_project_point(
        &self,
        px: f32,
        py: f32,
        pz: f32,
        layers: u32,
        mask: u32,
        solid: bool,
    ) -> Result<Vec<f32>, Physics3DError> {
        let world = self.world3d()?;
        Ok(world.project_point(px, py, pz, layers, mask, solid))
    }

    // ─── Physics 3D — Character Controller (RFC-09D) ──────────────────────────

    /// Registers a kinematic character controller for the body at `entity_index`.
    ///
    /// # Arguments
    /// * `entity_index`              — ECS entity slot index.
    /// * `step_height`               — Max step-up height in metres (`0.0` disables).
    /// * `slope_limit`               — Max climbable slope in **degrees**.
    /// * `skin_width`                — Surface separation offset in metres.
    /// * `snap_to_ground`            — Ground-snap distance in metres (`0.0` disables).
    /// * `slide_on_steep_slopes`     — Slide rather than stop on steep surfaces.
    /// * `apply_impulses_to_dynamic` — Push dynamic bodies on contact.
    ///
    /// # Returns
    /// The compact controller slot. A second call for an entity that already has a controller
    /// replaces its configuration and returns the same slot.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the entity has no body.
    /// `CharacterControllerLimitReached` when all slots are taken. The check runs before any
    /// insert, so a refusal leaves the pool as it was.
    /// `InvalidCollider` when `skin_width` is NaN or negative, which rapier asserts on.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_character_controller(
        &mut self,
        entity_index: u32,
        step_height: f32,
        slope_limit: f32,
        skin_width: f32,
        snap_to_ground: f32,
        slide_on_steep_slopes: bool,
        apply_impulses_to_dynamic: bool,
    ) -> Result<u32, Physics3DError> {
        let world = self.world3d_mut()?;
        world.add_character_controller(
            entity_index,
            step_height,
            slope_limit,
            skin_width,
            snap_to_ground,
            slide_on_steep_slopes,
            apply_impulses_to_dynamic,
        )
    }

    /// Drive a character controller for one frame.
    /// Results are written to the CC SAB buffer; read via [`physics3d_get_cc_sab_ptr`].
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `CharacterControllerNotFound` when the entity has no controller.
    /// `BodyNotFound` when the controller's body was removed.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_character_controller_move(
        &mut self,
        entity_index: u32,
        vx: f32,
        vy: f32,
        vz: f32,
        dt: f32,
    ) -> Result<(), Physics3DError> {
        let world = self.world3d_mut()?;
        world.character_controller_move(entity_index, vx, vy, vz, dt)
    }

    /// Returns the WASM linear-memory pointer to the CC state buffer.
    ///
    /// Layout per slot (stride = 5 f32):
    /// `[grounded, normal_x, normal_y, normal_z, ground_entity_bits]`
    ///
    /// Slot index is returned by [`physics3d_add_character_controller`].
    #[cfg(feature = "physics3d")]
    pub fn physics3d_get_cc_sab_ptr(&self) -> u32 {
        if let Some(world) = self.physics3d_world.as_ref() {
            world.cc_state_ptr() as u32
        } else {
            0
        }
    }

    /// Returns the maximum number of concurrent character controllers.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_get_max_cc_entities(&self) -> u32 {
        crate::physics3d::world::max_cc_entities()
    }

    /// Removes the character controller registered for `entity_index`.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `CharacterControllerNotFound` when the entity has no controller.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_remove_character_controller(
        &mut self,
        entity_index: u32,
    ) -> Result<(), Physics3DError> {
        let world = self.world3d_mut()?;
        world.remove_character_controller(entity_index)
    }

    // ─── Physics 3D — Joints (RFC-08) ─────────────────────────────────────────

    /// Attach two bodies with a fixed (weld) joint.
    ///
    /// # Arguments
    /// * `entity_a` / `entity_b` — ECS entity slot indices.
    /// * `ax/ay/az` — Anchor on body A (local space).
    /// * `bx/by/bz` — Anchor on body B (local space).
    ///
    /// # Returns
    /// Stable joint ID.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when either entity has no body. The error names the first one missing,
    /// `entity_a` before `entity_b`.
    /// `InvalidJoint` when an anchor, axis, spring value or used joint limit is NaN or infinite
    /// (a limit may be infinite on one side). The check runs after the body check.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_fixed_joint(
        &mut self,
        entity_a: u32,
        entity_b: u32,
        ax: f32,
        ay: f32,
        az: f32,
        bx: f32,
        by: f32,
        bz: f32,
    ) -> Result<u32, Physics3DError> {
        let world = self.world3d_mut()?;
        world.add_fixed_joint(entity_a, entity_b, ax, ay, az, bx, by, bz)
    }

    /// Attach two bodies with a revolute (hinge) joint.
    ///
    /// # Arguments
    /// * `entity_a` / `entity_b` — ECS entity slot indices.
    /// * `ax/ay/az` — Anchor on body A (local space).
    /// * `bx/by/bz` — Anchor on body B (local space).
    /// * `axis_x/y/z` — Rotation axis (world space, normalised internally).
    /// * `use_limits` — Enable angular limits.
    /// * `limit_min` / `limit_max` — Angular limits in radians.
    ///
    /// # Returns
    /// Stable joint ID.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when either entity has no body. The error names the first one missing,
    /// `entity_a` before `entity_b`.
    /// `InvalidJoint` when an anchor, axis, spring value or used joint limit is NaN or infinite
    /// (a limit may be infinite on one side). The check runs after the body check.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_revolute_joint(
        &mut self,
        entity_a: u32,
        entity_b: u32,
        ax: f32,
        ay: f32,
        az: f32,
        bx: f32,
        by: f32,
        bz: f32,
        axis_x: f32,
        axis_y: f32,
        axis_z: f32,
        use_limits: bool,
        limit_min: f32,
        limit_max: f32,
    ) -> Result<u32, Physics3DError> {
        let world = self.world3d_mut()?;
        world.add_revolute_joint(
            entity_a, entity_b, ax, ay, az, bx, by, bz, axis_x, axis_y, axis_z, use_limits,
            limit_min, limit_max,
        )
    }

    /// Attach two bodies with a prismatic (slider) joint.
    ///
    /// # Arguments
    /// * `entity_a` / `entity_b` — ECS entity slot indices.
    /// * `ax/ay/az` — Anchor on body A (local space).
    /// * `bx/by/bz` — Anchor on body B (local space).
    /// * `axis_x/y/z` — Slide axis (world space, normalised internally).
    /// * `use_limits` — Enable translation limits.
    /// * `limit_min` / `limit_max` — Limits in metres.
    ///
    /// # Returns
    /// Stable joint ID.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when either entity has no body. The error names the first one missing,
    /// `entity_a` before `entity_b`.
    /// `InvalidJoint` when an anchor, axis, spring value or used joint limit is NaN or infinite
    /// (a limit may be infinite on one side). The check runs after the body check.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_prismatic_joint(
        &mut self,
        entity_a: u32,
        entity_b: u32,
        ax: f32,
        ay: f32,
        az: f32,
        bx: f32,
        by: f32,
        bz: f32,
        axis_x: f32,
        axis_y: f32,
        axis_z: f32,
        use_limits: bool,
        limit_min: f32,
        limit_max: f32,
    ) -> Result<u32, Physics3DError> {
        let world = self.world3d_mut()?;
        world.add_prismatic_joint(
            entity_a, entity_b, ax, ay, az, bx, by, bz, axis_x, axis_y, axis_z, use_limits,
            limit_min, limit_max,
        )
    }

    /// Attach two bodies with a ball (spherical) joint.
    ///
    /// # Arguments
    /// * `entity_a` / `entity_b` — ECS entity slot indices.
    /// * `ax/ay/az` — Anchor on body A (local space).
    /// * `bx/by/bz` — Anchor on body B (local space).
    ///
    /// # Returns
    /// Stable joint ID.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when either entity has no body. The error names the first one missing,
    /// `entity_a` before `entity_b`.
    /// `InvalidJoint` when an anchor, axis, spring value or used joint limit is NaN or infinite
    /// (a limit may be infinite on one side). The check runs after the body check.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_ball_joint(
        &mut self,
        entity_a: u32,
        entity_b: u32,
        ax: f32,
        ay: f32,
        az: f32,
        bx: f32,
        by: f32,
        bz: f32,
    ) -> Result<u32, Physics3DError> {
        let world = self.world3d_mut()?;
        world.add_ball_joint(entity_a, entity_b, ax, ay, az, bx, by, bz)
    }

    /// Attach two bodies with a spring joint.
    ///
    /// # Arguments
    /// * `entity_a` / `entity_b` — ECS entity slot indices.
    /// * `ax/ay/az` — Anchor on body A (local space).
    /// * `bx/by/bz` — Anchor on body B (local space).
    /// * `rest_length` — Natural length of the spring (metres).
    /// * `stiffness`   — Spring constant (N/m).
    /// * `damping`     — Damping coefficient (N·s/m).
    ///
    /// # Returns
    /// Stable joint ID.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when either entity has no body. The error names the first one missing,
    /// `entity_a` before `entity_b`.
    /// `InvalidJoint` when an anchor, axis, spring value or used joint limit is NaN or infinite
    /// (a limit may be infinite on one side). The check runs after the body check.
    #[cfg(feature = "physics3d")]
    #[allow(clippy::too_many_arguments, reason = "flat wasm-bindgen ABI")]
    pub fn physics3d_add_spring_joint(
        &mut self,
        entity_a: u32,
        entity_b: u32,
        ax: f32,
        ay: f32,
        az: f32,
        bx: f32,
        by: f32,
        bz: f32,
        rest_length: f32,
        stiffness: f32,
        damping: f32,
    ) -> Result<u32, Physics3DError> {
        let world = self.world3d_mut()?;
        world.add_spring_joint(
            entity_a,
            entity_b,
            ax,
            ay,
            az,
            bx,
            by,
            bz,
            rest_length,
            stiffness,
            damping,
        )
    }

    /// Remove a joint by its stable ID.
    ///
    /// # Arguments
    /// * `id` — Joint ID returned by `physics3d_add_*_joint`.
    ///
    /// # Returns
    /// `true` once the joint is removed.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `JointNotFound` when no joint is registered for `id`.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_remove_joint(&mut self, id: u32) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.remove_joint(id)?;
        Ok(true)
    }

    /// Set a motor velocity target on a joint's primary axis (AngX).
    ///
    /// # Arguments
    /// * `id`        — Joint ID.
    /// * `velocity`  — Target angular / linear velocity (rad/s or m/s).
    /// * `max_force` — Maximum motor force / torque (N or N·m).
    ///
    /// # Returns
    /// `true` once the motor is set.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `JointNotFound` when no joint is registered for `id`.
    /// `InvalidJoint` when a float is NaN or infinite. The check runs after the joint check.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_set_joint_motor_velocity(
        &mut self,
        id: u32,
        velocity: f32,
        max_force: f32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.set_joint_motor_velocity(id, velocity, max_force)?;
        Ok(true)
    }

    /// Set a motor position target on a joint's primary axis (AngX).
    ///
    /// # Arguments
    /// * `id`        — Joint ID.
    /// * `target`    — Target angle / position (radians or metres).
    /// * `stiffness` — Spring stiffness (N·m/rad or N/m).
    /// * `damping`   — Damping coefficient (N·m·s/rad or N·s/m).
    ///
    /// # Returns
    /// `true` once the motor is set.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `JointNotFound` when no joint is registered for `id`.
    /// `InvalidJoint` when a float is NaN or infinite. The check runs after the joint check.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_set_joint_motor_position(
        &mut self,
        id: u32,
        target: f32,
        stiffness: f32,
        damping: f32,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.set_joint_motor_position(id, target, stiffness, damping)?;
        Ok(true)
    }

    /// Enable or disable a joint.
    ///
    /// # Arguments
    /// * `id`      — Joint ID.
    /// * `enabled` — `true` to enable, `false` to disable.
    ///
    /// # Returns
    /// `true` once the joint is updated.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `JointNotFound` when no joint is registered for `id`.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_set_joint_enabled(
        &mut self,
        id: u32,
        enabled: bool,
    ) -> Result<bool, Physics3DError> {
        let world = self.world3d_mut()?;
        world.set_joint_enabled(id, enabled)?;
        Ok(true)
    }

    // ─── Physics 3D — Getters (read-only) ─────────────────────────────────────

    /// Return the sensor state for a 3D collider as a packed `u64`.
    ///
    /// Bit layout: `bits 0–31 = contact_count (u32)`, `bit 32 = is_active (bool)`.
    /// Returns `0` if no state has been recorded for a registered body.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `sensor_id`    — Stable collider ID used when the sensor was created.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_get_sensor_state(
        &self,
        entity_index: u32,
        sensor_id: u32,
    ) -> Result<u64, Physics3DError> {
        let world = self.world3d()?;
        if !world.has_body(entity_index) {
            return Err(Physics3DError::BodyNotFound { slot: entity_index });
        }
        Ok(world.get_sensor_state(entity_index, sensor_id))
    }

    /// Manually override the sensor state for a 3D collider.
    ///
    /// Normally sensor state is derived automatically from collision events
    /// during [`physics3d_step`]. Use this to reset or pre-populate state from
    /// the JavaScript side.
    ///
    /// # Arguments
    /// * `entity_index` — ECS entity slot index.
    /// * `sensor_id`    — Stable collider ID.
    /// * `is_active`    — Whether the sensor is currently overlapping.
    /// * `count`        — Number of concurrent overlapping contacts.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    /// `BodyNotFound` when the slot has no body.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_update_sensor_state(
        &mut self,
        entity_index: u32,
        sensor_id: u32,
        is_active: bool,
        count: u32,
    ) -> Result<(), Physics3DError> {
        let world = self.world3d_mut()?;
        if !world.has_body(entity_index) {
            return Err(Physics3DError::BodyNotFound { slot: entity_index });
        }
        world.update_sensor_state(entity_index, sensor_id, is_active, count);
        Ok(())
    }

    /// Select the physics quality preset for the 3D simulation.
    ///
    /// | Preset | `u8` | Solver iters | Stabilization iters | CCD substeps |
    /// |--------|:----:|:------------:|:-------------------:|:------------:|
    /// | Low    | 0    | 2            | 1                   | 1            |
    /// | Medium | 1    | 4            | 2                   | 1            |
    /// | High   | 2    | 8            | 3                   | 2            |
    /// | Esport | 3    | 10           | 4                   | 4            |
    ///
    /// Any unrecognised value maps to `Medium`.
    ///
    /// # Arguments
    /// * `preset` — Quality level discriminant (0–3).
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_set_quality(&mut self, preset: u8) -> Result<(), Physics3DError> {
        let world = self.world3d_mut()?;
        world.set_quality(preset);
        Ok(())
    }

    /// Enable or disable collision event coalescing for the 3D world.
    ///
    /// When enabled, duplicate `(entity_a, entity_b)` pairs generated within a
    /// single step are deduplicated before writing to the ring buffer. This
    /// reduces event volume at the cost of losing intermediate state transitions.
    ///
    /// # Arguments
    /// * `enabled` — `true` to enable coalescing, `false` to disable.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_set_event_coalescing(&mut self, enabled: bool) -> Result<(), Physics3DError> {
        let world = self.world3d_mut()?;
        world.set_event_coalescing(enabled);
        Ok(())
    }

    /// Return a raw pointer to the 3D collision event ring buffer.
    ///
    /// The buffer lives in WASM linear memory and remains valid for the
    /// lifetime of the module. JavaScript should wrap the result in a typed
    /// array view of length `physics3d_get_collision_event_count() * EVENT_STRIDE_3D`.
    ///
    /// Returns `0` if the world is not initialised.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_get_collision_events_ptr(&self) -> usize {
        if let Some(ref world) = self.physics3d_world {
            world.get_collision_events_ptr()
        } else {
            0
        }
    }

    // ─── Physics 3D — Events ─────────────────────────────────────────────────

    /// Return the number of 3D collision events written since the last step.
    ///
    /// Returns `0` if the world is not initialised.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_get_collision_event_count(&self) -> u32 {
        if let Some(ref world) = self.physics3d_world {
            world.get_collision_event_count()
        } else {
            0
        }
    }

    /// Clear all pending 3D collision events.
    ///
    /// Call after JavaScript has finished reading the event buffer. The next
    /// [`physics3d_step`] call also implicitly clears the buffer.
    ///
    /// # Errors
    /// `WorldNotInitialized` when `physics3d_init` has not run.
    #[cfg(feature = "physics3d")]
    pub fn physics3d_consume_events(&mut self) -> Result<(), Physics3DError> {
        let world = self.world3d_mut()?;
        world.consume_events();
        Ok(())
    }

    // ─── Engine stats ─────────────────────────────────────────────────────────

    /// Alive entity and transform-node counts: `{"entities":N,"transforms":M}`.
    ///
    /// `M` is [`TransformSystem::count`].
    pub fn stats(&self) -> String {
        format!(
            r#"{{"entities":{},"transforms":{}}}"#,
            self.entity_manager.count_entities(),
            self.transform_system.count()
        )
    }

    // ─── Bulk query-read API (Tier 1) ─────────────────────────────────────────

    /// Query entities that have ALL given component types and bulk-read one component type.
    ///
    /// Combines an archetype-cached query and a bulk component read into a **single** WASM
    /// boundary crossing, eliminating N per-entity crossings that dominate frame budgets at
    /// scale. The match set is the awake rows of the chunk store, the same
    /// rows [`query_entities_to_buffer`] writes.
    ///
    /// # Arguments
    /// * `component_type_ids` – Entity must possess ALL of these component type IDs.
    ///   An empty slice returns `Ok(vec![0, 0])` when `out_slots` and `out_gens`
    ///   have the same length, and writes nothing. A length mismatch is an
    ///   error even when the type list is empty.
    /// * `read_type_id`       – The component type whose bytes are packed into `out_buf`.
    /// * `out_slots`          – Caller-provided buffer. Same length as `out_gens`.
    ///   Filled with matching entity slot indices on return.
    /// * `out_gens`           – Caller-provided buffer (same length as `out_slots`).
    ///   Filled with matching entity generation counters on return.
    /// * `out_buf`            – Caller-provided `Uint8Array` for packed component data.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::BufferLengthMismatch`] before the empty-type
    /// shortcut when `out_gens` differs in length from `out_slots`.
    /// Nothing is written.
    /// The buffer name is `"gens"`, `expected` is the `out_slots` length, and
    /// `actual` is the `out_gens` length.
    ///
    /// # Returns
    /// `Ok` of a two-element `Vec<u32>` `[entity_count, bytes_written]`.  After the call,
    /// `out_slots[0..entity_count]` and `out_gens[0..entity_count]` identify the matched
    /// entities, and `out_buf[0..bytes_written]` contains their packed component data.
    ///
    /// When the two output slices have the same length, `entity_count` is
    /// `min(matches, out_slots.len())`. A shorter equal-length pair truncates
    /// the result. A shorter `out_buf` stops the component copy. There is no
    /// fixed 10_000 cap.
    ///
    /// # Performance
    /// One WASM boundary crossing regardless of entity count.
    /// Query results are archetype-cached; subsequent frames with the same filter are fast.
    pub fn query_read_bulk(
        &mut self,
        component_type_ids: &[u32],
        read_type_id: u32,
        out_slots: &mut [u32],
        out_gens: &mut [u32],
        out_buf: &mut [u8],
    ) -> Result<Vec<u32>, CoreError> {
        if out_slots.len() != out_gens.len() {
            return Err(CoreError::BufferLengthMismatch {
                buffer: "gens",
                expected: bulk_len_u32(out_slots.len()),
                actual: bulk_len_u32(out_gens.len()),
            });
        }

        if component_type_ids.is_empty() {
            return Ok(vec![0, 0]);
        }

        let written = self
            .storage
            .write_awake(component_type_ids, out_slots, out_gens)?;
        if written == 0 {
            return Ok(vec![0, 0]);
        }
        let bytes = self.get_components_bulk(
            &out_slots[..written],
            &out_gens[..written],
            read_type_id,
            out_buf,
        )?;
        Ok(vec![written as u32, bytes])
    }

    /// Write back component data for a previously-queried entity set in one WASM call.
    ///
    /// Pass the `out_slots` and `out_gens` filled by [`query_read_bulk`] together with
    /// updated packed component bytes.  Dead entities (stale generation) are silently skipped.
    ///
    /// # Arguments
    /// * `slots`          – Entity slot indices (from a prior `query_read_bulk` call).
    /// * `gens`           – Per-slot generation counters (from a prior `query_read_bulk` call).
    /// * `write_type_id`  – Component type ID to write.
    /// * `data`           – Packed component bytes; total length must equal
    ///   `slots.len() × component_size_bytes`.
    ///
    /// # Errors
    ///
    /// Same as [`Engine::set_components_bulk`]: [`CoreError::BufferLengthMismatch`]
    /// when `gens` or `data` has the wrong length, before any write.
    ///
    /// # Performance
    /// One WASM boundary crossing regardless of entity count.
    pub fn query_write_bulk(
        &mut self,
        slots: &[u32],
        gens: &[u32],
        write_type_id: u32,
        data: &[u8],
    ) -> Result<(), CoreError> {
        self.set_components_bulk(slots, gens, write_type_id, data)
    }

    // ─── Bulk physics 2D API (Tier 2) ─────────────────────────────────────────

    /// Bulk-sync Rapier physics2D → ECS transforms.
    ///
    /// One WASM boundary crossing per frame instead of N per-entity crossings.
    /// Only available when compiled with `features = ["physics2d"]`.
    ///
    /// See [`crate::bulk_ops_physics2d::physics2d_bulk_sync_from_rapier`] for details.
    ///
    /// # Errors
    /// Propagates [`CoreError`] from that function. A length mismatch writes nothing.
    #[cfg(feature = "physics2d")]
    #[wasm_bindgen]
    pub fn physics2d_bulk_sync_from_rapier(
        &mut self,
        transform_type_id: u32,
        out_slots: &mut [u32],
        out_gens: &mut [u32],
        out_buf: &mut [u8],
    ) -> Result<Vec<u32>, CoreError> {
        let (count, bytes) = crate::bulk_ops_physics2d::physics2d_bulk_sync_from_rapier(
            self,
            transform_type_id,
            out_slots,
            out_gens,
            out_buf,
        )?;
        Ok(vec![count, bytes])
    }

    /// Bulk-sync ECS transforms → Rapier physics2D.
    ///
    /// One WASM boundary crossing per frame.
    /// Only available when compiled with `features = ["physics2d"]`.
    ///
    /// See [`crate::bulk_ops_physics2d::physics2d_bulk_sync_to_rapier`] for details.
    ///
    /// # Errors
    /// Propagates [`CoreError`] from that function. A length mismatch writes nothing.
    #[cfg(feature = "physics2d")]
    #[wasm_bindgen]
    pub fn physics2d_bulk_sync_to_rapier(
        &mut self,
        slots: &[u32],
        gens: &[u32],
        transform_type_id: u32,
        data: &[u8],
    ) -> Result<(), CoreError> {
        crate::bulk_ops_physics2d::physics2d_bulk_sync_to_rapier(
            self,
            slots,
            gens,
            transform_type_id,
            data,
        )
    }

    /// Bulk-apply impulses to physics2D entities.
    ///
    /// One WASM boundary crossing per frame.
    /// Only available when compiled with `features = ["physics2d"]`.
    ///
    /// See [`crate::bulk_ops_physics2d::physics2d_bulk_apply_impulse`] for details.
    ///
    /// # Errors
    /// Propagates [`CoreError`] from that function. A length mismatch writes nothing.
    #[cfg(feature = "physics2d")]
    #[wasm_bindgen]
    pub fn physics2d_bulk_apply_impulse(
        &mut self,
        slots: &[u32],
        gens: &[u32],
        rigidbody_type_id: u32,
        impulse_data: &[u8],
    ) -> Result<(), CoreError> {
        crate::bulk_ops_physics2d::physics2d_bulk_apply_impulse(
            self,
            slots,
            gens,
            rigidbody_type_id,
            impulse_data,
        )
    }

    // ─── Bulk physics 3D API (Tier 3) ─────────────────────────────────────────

    /// Bulk-sync Rapier3D → ECS Transform3D (7×f32 = 28 bytes per entity).
    ///
    /// One WASM boundary crossing per frame instead of N per-entity crossings.
    /// Only available when compiled with `features = ["physics3d"]`.
    ///
    /// See [`crate::bulk_ops_physics3d::physics3d_bulk_sync_from_rapier`] for details.
    ///
    /// # Errors
    /// `Core(BufferLengthMismatch)` when `out_slots` and `out_gens` differ in length. Nothing is
    /// written.
    #[cfg(feature = "physics3d")]
    #[wasm_bindgen]
    pub fn physics3d_bulk_sync_from_rapier(
        &mut self,
        transform_type_id: u32,
        out_slots: &mut [u32],
        out_gens: &mut [u32],
        out_buf: &mut [u8],
    ) -> Result<Vec<u32>, Physics3DError> {
        let (count, bytes) = crate::bulk_ops_physics3d::physics3d_bulk_sync_from_rapier(
            self,
            transform_type_id,
            out_slots,
            out_gens,
            out_buf,
        )
        .map_err(Physics3DError::Core)?;
        Ok(vec![count, bytes])
    }

    /// Bulk-sync ECS Transform3D → Rapier3D (7×f32 = 28 bytes per entity).
    ///
    /// One WASM boundary crossing per frame.
    /// Only available when compiled with `features = ["physics3d"]`.
    ///
    /// See [`crate::bulk_ops_physics3d::physics3d_bulk_sync_to_rapier`] for details.
    ///
    /// # Errors
    /// `Core(BufferLengthMismatch)` when `slots`, `gens` and `data` do not agree. Nothing is
    /// written.
    #[cfg(feature = "physics3d")]
    #[wasm_bindgen]
    pub fn physics3d_bulk_sync_to_rapier(
        &mut self,
        slots: &[u32],
        gens: &[u32],
        transform_type_id: u32,
        data: &[u8],
    ) -> Result<(), Physics3DError> {
        crate::bulk_ops_physics3d::physics3d_bulk_sync_to_rapier(
            self,
            slots,
            gens,
            transform_type_id,
            data,
        )
        .map_err(Physics3DError::Core)
    }

    /// Bulk-apply 3D impulses `[fx, fy, fz]` (12 bytes/entity) to physics3D entities.
    ///
    /// One WASM boundary crossing per frame.
    /// Only available when compiled with `features = ["physics3d"]`.
    ///
    /// See [`crate::bulk_ops_physics3d::physics3d_bulk_apply_impulse`] for details.
    ///
    /// # Errors
    /// `Core(BufferLengthMismatch)` when `slots`, `gens` and `impulse_data` do not agree. Nothing
    /// is written.
    #[cfg(feature = "physics3d")]
    #[wasm_bindgen]
    pub fn physics3d_bulk_apply_impulse(
        &mut self,
        slots: &[u32],
        gens: &[u32],
        rigidbody_type_id: u32,
        impulse_data: &[u8],
    ) -> Result<(), Physics3DError> {
        crate::bulk_ops_physics3d::physics3d_bulk_apply_impulse(
            self,
            slots,
            gens,
            rigidbody_type_id,
            impulse_data,
        )
        .map_err(Physics3DError::Core)
    }

    // ─── Bulk entity operations ────────────────────────────────────────────────

    /// Destroy multiple entities in a single call.
    ///
    /// # Arguments
    /// * `indices` - Flat array of entity indices to destroy (obtained from `create_entity`).
    ///
    /// # Description
    /// This method efficiently removes multiple entities from the engine in a single
    /// WASM boundary crossing. Entities that are already destroyed are silently skipped.
    /// This is useful for batch cleanup operations or clearing many entities at once.
    ///
    /// # Examples
    /// ```js
    /// engine.bulk_destroy(new Uint32Array([3, 7, 12]));
    /// ```
    #[wasm_bindgen]
    pub fn bulk_destroy(&mut self, indices: &[u32]) -> Result<(), CoreError> {
        for &index in indices {
            let gen = self.get_entity_generation(index);
            if self.is_alive(index, gen) {
                self.delete_entity(index, gen)?;
            }
        }
        Ok(())
    }

    /// Create N entities, each with a transform, and return their indices.
    ///
    /// # Arguments
    /// * `positions` - Flat `[x0, y0, x1, y1, ...]` array. Length must be exactly `2 * N`.
    /// * `rotations` - Flat `[r0, r1, ...]` array. Length must be exactly `N`.
    ///
    /// # Returns
    /// `Vec<u32>` (exposed as `Uint32Array` to JavaScript) of N entity indices in the same order as `positions`.
    /// Both slices empty (`N = 0`) returns an empty vec and creates nothing.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::BufferLengthMismatch`] before any entity is created
    /// when `positions` has an odd length (the message's expected value is the
    /// next even length) or when `rotations.len()` is not `N`.
    /// Returns [`CoreError::EntityLimitReached`] when N is greater than the
    /// remaining entity capacity. Nothing is created in that case.
    ///
    /// # Description
    /// This method spawns multiple entities with transforms in one call.
    /// Each entity gets a position `(x, y)`, the rotation at the same index, and scale `(1, 1)`.
    ///
    /// # Examples
    /// ```js
    /// const ids = engine.bulk_spawn_with_transforms(
    ///   new Float32Array([0, 0, 16, 0, 32, 0]),
    ///   new Float32Array([0, 0, 0]),
    /// );
    /// // Creates 3 entities at (0, 0), (16, 0), (32, 0) with rotations 0, 0, 0
    /// ```
    #[wasm_bindgen]
    pub fn bulk_spawn_with_transforms(
        &mut self,
        positions: &[f32],
        rotations: &[f32],
    ) -> Result<Vec<u32>, CoreError> {
        if !positions.len().is_multiple_of(2) {
            let expected = match positions.len().checked_add(1) {
                Some(len) => bulk_len_u32(len),
                None => u32::MAX,
            };
            return Err(CoreError::BufferLengthMismatch {
                buffer: "positions",
                expected,
                actual: bulk_len_u32(positions.len()),
            });
        }
        let count = positions.len() / 2;
        if rotations.len() != count {
            return Err(CoreError::BufferLengthMismatch {
                buffer: "rotations",
                expected: bulk_len_u32(count),
                actual: bulk_len_u32(rotations.len()),
            });
        }
        if count > self.entity_manager.remaining_capacity() as usize {
            let max = self.entity_manager.max_entities();
            return Err(CoreError::EntityLimitReached { max });
        }

        let mut indices = Vec::with_capacity(count);

        for i in 0..count {
            let js_id = self.create_entity()?;
            let index = js_id.index();
            let x = positions[i * 2];
            let y = positions[i * 2 + 1];
            let rotation = rotations[i];

            let entity = EntityId::from_parts(index, self.get_entity_generation(index));
            self.transform_system.add_transform(
                entity,
                Transform {
                    position: Vec2::new(x, y),
                    rotation,
                    scale: Vec2::one(),
                },
            );

            indices.push(index);
        }

        Ok(indices)
    }
}

#[cfg(feature = "physics2d")]
impl Engine {
    /// Reads Rapier `is_enabled` for the body in `slot`.
    ///
    /// Not a `#[wasm_bindgen]` export. A missing world or slot is `false`.
    pub fn is_body_enabled(&self, slot: u32) -> bool {
        let Some(world) = self.physics_world.as_ref() else {
            return false;
        };
        world.is_body_enabled(slot)
    }
}

impl Engine {
    /// Shrink the query result buffer so tests can force
    /// [`CoreError::QueryCapacityExceeded`].
    ///
    /// Not a `#[wasm_bindgen]` export. Production code never resizes this buffer:
    /// its length is `max_entities`, so a normal query cannot exceed it.
    #[doc(hidden)]
    pub fn testing_shrink_query_buffer(&mut self, len: usize) {
        self.query_result_buffer.truncate(len);
    }
}

#[cfg(feature = "physics3d")]
impl Engine {
    /// Borrow the 3D world, or refuse when `physics3d_init` has not run.
    ///
    /// Not a `#[wasm_bindgen]` export.
    fn world3d(&self) -> Result<&PhysicsWorld3D, Physics3DError> {
        self.physics3d_world
            .as_ref()
            .ok_or(Physics3DError::WorldNotInitialized)
    }

    /// Check that `ptr` is the start of a live [`Self::alloc_shared_buffer`] allocation of this
    /// engine and that the allocation holds at least `count` `u32` slots.
    ///
    /// Not a `#[wasm_bindgen]` export: `physics3d_overlap_shape` runs it before it builds the
    /// output slice. It is `pub` so a native test can drive it with a full-width address, which
    /// the `u32` argument of the export cannot carry on a 64-bit host.
    ///
    /// # Errors
    /// Returns [`CoreError::InvalidSharedBuffer`] inside [`Physics3DError::Core`]. `len` is 0
    /// when `ptr` is null, is not the start of a live allocation, was freed, or belongs to
    /// another engine. `len` is the recorded byte length when the allocation is too short. The
    /// byte count is computed in `u64`, so `count * 4` cannot overflow.
    pub fn check_shared_u32_slots(&self, ptr: usize, count: u32) -> Result<(), Physics3DError> {
        let Some((len, _)) = self.shared_buffers.get(&ptr).copied() else {
            return Err(Physics3DError::Core(CoreError::InvalidSharedBuffer {
                ptr,
                len: 0,
            }));
        };
        if u64::from(count) * 4 > len as u64 {
            return Err(Physics3DError::Core(CoreError::InvalidSharedBuffer {
                ptr,
                len,
            }));
        }
        Ok(())
    }

    /// Mutably borrow the 3D world, or refuse when `physics3d_init` has not run.
    ///
    /// Not a `#[wasm_bindgen]` export.
    fn world3d_mut(&mut self) -> Result<&mut PhysicsWorld3D, Physics3DError> {
        self.physics3d_world
            .as_mut()
            .ok_or(Physics3DError::WorldNotInitialized)
    }
}

/// Map a world call that reports "no such body" with `false` to a typed result.
#[cfg(feature = "physics3d")]
fn body_found(found: bool, slot: u32) -> Result<bool, Physics3DError> {
    if found {
        Ok(true)
    } else {
        Err(Physics3DError::BodyNotFound { slot })
    }
}

/// Refuse a body kind that is not 0 (fixed), 1 (dynamic) or 2 (kinematic).
#[cfg(feature = "physics3d")]
fn check_body_kind(kind: u8) -> Result<(), Physics3DError> {
    if kind > 2 {
        return Err(Physics3DError::InvalidBodyKind { kind });
    }
    Ok(())
}

// ─── build-tools exports ──────────────────────────────────────────────────────

#[cfg(feature = "build-tools")]
#[wasm_bindgen]
pub fn build_bvh_buffer(vertices_flat: &[f32], indices_flat: &[u32]) -> Result<Vec<u8>, String> {
    crate::build_tools::build_bvh_buffer(vertices_flat, indices_flat)
}

#[cfg(feature = "build-tools")]
#[wasm_bindgen]
pub fn build_bvh_from_glb(glb_bytes: &[u8], mesh_name: Option<String>) -> Result<Vec<u8>, String> {
    crate::build_tools::build_bvh_from_glb(glb_bytes, mesh_name.as_deref())
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
    use crate::CoreError;

    fn must_ok<T, E>(result: Result<T, E>) -> T {
        match result {
            Ok(value) => value,
            Err(_) => unreachable!(),
        }
    }

    #[test]
    fn test_query_entities_to_buffer() {
        let mut engine = Engine::new(100).expect("max entities");
        let t0 = must_ok(engine.register_component(&[0]));
        let t1 = must_ok(engine.register_component(&[0]));

        let e0 = engine.create_entity().expect("entity limit");
        let e1 = engine.create_entity().expect("entity limit");
        let e2 = engine.create_entity().expect("entity limit");

        // Add components to entities
        // e0 has t0 and t1
        engine
            .add_component(e0.index(), e0.generation(), t0, &[0u8; 4])
            .expect("component");
        engine
            .add_component(e0.index(), e0.generation(), t1, &[0u8; 4])
            .expect("component");
        // e1 has t0 only
        engine
            .add_component(e1.index(), e1.generation(), t0, &[0u8; 4])
            .expect("component");
        // e2 has t1 only
        engine
            .add_component(e2.index(), e2.generation(), t1, &[0u8; 4])
            .expect("component");

        // Query for t0
        let count = engine.query_entities_to_buffer(&[t0]).unwrap();
        assert_eq!(count, 2);
        assert_eq!(engine.get_query_result_capacity(), 100);

        let ptr = engine.get_query_result_ptr();
        // SAFETY: `ptr` is this engine's query buffer. `count` is what the query just wrote.
        unsafe {
            let slice = std::slice::from_raw_parts(ptr, count as usize);
            assert!(slice.contains(&e0.index()));
            assert!(slice.contains(&e1.index()));
            assert!(!slice.contains(&e2.index()));
        }

        // Query for both t0 and t1
        let count = engine.query_entities_to_buffer(&[t0, t1]).unwrap();
        assert_eq!(count, 1);
        // SAFETY: `ptr` is this engine's query buffer. `count` is what the query just wrote.
        unsafe {
            let slice = std::slice::from_raw_parts(ptr, count as usize);
            assert_eq!(slice[0], e0.index());
        }
    }

    #[test]
    fn test_query_entities_to_buffer_cap() {
        let max = 11_000u32;
        let mut engine = Engine::new(max).expect("max entities");
        assert_eq!(engine.get_query_result_capacity(), max);
        let t0 = must_ok(engine.register_component(&[0]));

        for _ in 0..max {
            let e = engine.create_entity().expect("entity limit");
            engine
                .add_component(e.index(), e.generation(), t0, &[0u8; 4])
                .expect("component");
        }

        let count = engine
            .query_entities_to_buffer(&[t0])
            .expect("11_000 matches fit in a buffer of max_entities");
        assert_eq!(count, max, "must not truncate at the old 10_000 cap");

        let ptr = engine.get_query_result_ptr();
        // SAFETY: `ptr` is this engine's query buffer. `count` is what the query just wrote.
        let slice = unsafe { std::slice::from_raw_parts(ptr, count as usize) };
        assert_eq!(slice[0], 0);
        assert_eq!(slice[max as usize - 1], max - 1);
    }

    #[test]
    fn test_query_result_buffer_is_per_engine() {
        let mut a = Engine::new(8).expect("max entities");
        let mut b = Engine::new(4).expect("max entities");
        assert_eq!(a.get_query_result_capacity(), 8);
        assert_eq!(b.get_query_result_capacity(), 4);
        assert_ne!(
            a.get_query_result_ptr(),
            b.get_query_result_ptr(),
            "two engines must not share the query buffer"
        );

        let ta = must_ok(a.register_component(&[0]));
        let tb = must_ok(b.register_component(&[0]));
        let ea = a.create_entity().expect("entity limit");
        a.add_component(ea.index(), ea.generation(), ta, &[1, 0, 0, 0])
            .expect("component");
        let eb = b.create_entity().expect("entity limit");
        b.add_component(eb.index(), eb.generation(), tb, &[2, 0, 0, 0])
            .expect("component");
        assert_eq!(a.query_entities_to_buffer(&[ta]).unwrap(), 1);
        let ptr_a = a.get_query_result_ptr();
        // SAFETY: `ptr_a` is engine A's query buffer. The query wrote one id there.
        let a_id = unsafe { *ptr_a };

        assert_eq!(b.query_entities_to_buffer(&[tb]).unwrap(), 1);
        // SAFETY: the pointer is engine B's query buffer. The query wrote one id there.
        let b_id = unsafe { *b.get_query_result_ptr() };

        assert_eq!(
            // SAFETY: `ptr_a` is still engine A's buffer. Engine B does not alias it.
            unsafe { *ptr_a },
            a_id,
            "engine B must not overwrite engine A"
        );
        assert_eq!(a_id, ea.index());
        assert_eq!(b_id, eb.index());
    }

    #[test]
    fn set_components_bulk_returns_a_typed_error_when_storage_rejects_the_write() {
        let made = Engine::new(4).and_then(|mut engine| {
            let e = engine.create_entity()?;
            Ok((engine, e))
        });
        let Ok((mut engine, e)) = made else {
            unreachable!("Engine::new(4) and one entity always succeed");
        };
        let type_id = must_ok(engine.register_component(&[0]));

        let result =
            engine.set_components_bulk(&[e.index()], &[e.generation()], type_id, &[9u8; 8]);

        assert_eq!(
            result,
            Err(CoreError::BufferLengthMismatch {
                buffer: "data",
                expected: 4,
                actual: 8
            })
        );
        assert_eq!(
            engine.get_component_raw(e.index(), e.generation(), type_id),
            Ok(Vec::<u8>::new())
        );
    }

    #[test]
    fn set_components_bulk_rejects_a_fixed_size_mismatch_before_writing_the_first_entity() {
        let made = Engine::new(4).and_then(|mut engine| {
            let first = engine.create_entity()?;
            let second = engine.create_entity()?;
            Ok((engine, first, second))
        });
        let Ok((mut engine, first, second)) = made else {
            unreachable!("Engine::new(4) and two entities always succeed");
        };
        let type_id = must_ok(engine.register_component(&[0]));
        let added_first =
            engine.add_component(first.index(), first.generation(), type_id, &[1, 2, 3, 4]);
        assert_eq!(added_first, Ok(true));

        let result = engine.set_components_bulk(
            &[first.index(), second.index()],
            &[first.generation(), second.generation()],
            type_id,
            &[9u8; 16],
        );

        assert_eq!(
            result,
            Err(CoreError::BufferLengthMismatch {
                buffer: "data",
                expected: 8,
                actual: 16
            })
        );
        assert_eq!(
            engine.get_component_raw(first.index(), first.generation(), type_id),
            Ok(vec![1, 2, 3, 4])
        );
        assert_eq!(
            engine.get_component_raw(second.index(), second.generation(), type_id),
            Ok(Vec::<u8>::new())
        );
    }

    #[test]
    fn set_components_bulk_keeps_written_rows_when_a_later_width_is_wrong() {
        let made = Engine::new(4).and_then(|mut engine| {
            let first = engine.create_entity()?;
            let second = engine.create_entity()?;
            Ok((engine, first, second))
        });
        let Ok((mut engine, first, second)) = made else {
            unreachable!("Engine::new(4) and two entities always succeed");
        };
        let type_id = must_ok(engine.register_component(&[0]));
        let written = engine.set_components_bulk(
            &[first.index(), second.index()],
            &[first.generation(), second.generation()],
            type_id,
            &[1, 2, 3, 4, 5, 6, 7, 8],
        );
        assert_eq!(written, Ok(()));

        let result = engine.set_components_bulk(
            &[first.index(), second.index()],
            &[first.generation(), second.generation()],
            type_id,
            &[9u8; 16],
        );

        assert_eq!(
            result,
            Err(CoreError::BufferLengthMismatch {
                buffer: "data",
                expected: 8,
                actual: 16
            })
        );
        assert_eq!(
            engine.get_component_raw(first.index(), first.generation(), type_id),
            Ok(vec![1, 2, 3, 4])
        );
        assert_eq!(
            engine.get_component_raw(second.index(), second.generation(), type_id),
            Ok(vec![5, 6, 7, 8])
        );
    }

    #[test]
    fn test_query_entities_to_buffer_exceeds_capacity() {
        assert_eq!(
            QUERY_EXCEEDED_BUFFER_CAPACITY,
            "query exceeded the buffer capacity"
        );

        let mut engine = Engine::new(4).expect("max entities");
        let t0 = must_ok(engine.register_component(&[0]));
        for _ in 0..4 {
            let e = engine.create_entity().expect("entity limit");
            engine
                .add_component(e.index(), e.generation(), t0, &[0u8; 4])
                .expect("component");
        }

        // Force a buffer shorter than the match set. Production code never resizes it.
        engine.testing_shrink_query_buffer(2);
        let before = engine.query_result_buffer.clone();

        let err = engine
            .query_entities_to_buffer(&[t0])
            .expect_err("must not return a short count");
        assert_eq!(err.code(), "CORE:QUERY_CAPACITY_EXCEEDED");
        assert!(
            err.to_string().contains(QUERY_EXCEEDED_BUFFER_CAPACITY),
            "message must say the query exceeded the buffer capacity, got {err}"
        );
        match err {
            CoreError::QueryCapacityExceeded { matches, capacity } => {
                assert_eq!(matches, 4);
                assert_eq!(capacity, 2);
            }
            other => panic!("unexpected {other:?}"),
        }

        assert_eq!(
            engine.query_result_buffer, before,
            "overflow must not write a partial result"
        );
    }

    #[cfg(feature = "physics3d")]
    #[test]
    fn test_physics3d_rebuild_mesh_collider_binding_happy_path() {
        let mut engine = Engine::new(64).expect("max entities");
        engine.physics3d_init(0.0, -9.81, 0.0, 64);
        assert_eq!(
            engine.physics3d_add_body(0, 0.0, 0.0, 0.0, 0, 1.0, 0.0, 0.0),
            Ok(true)
        );

        let verts: Vec<f32> = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let idxs: Vec<u32> = vec![0, 1, 2];
        assert_eq!(
            engine.physics3d_add_mesh_collider(
                0,
                &verts,
                &idxs,
                0.0,
                0.0,
                0.0,
                false,
                0.5,
                0.0,
                0xFFFF_FFFF,
                0xFFFF_FFFF,
                42
            ),
            Ok(true)
        );

        let new_verts: Vec<f32> = vec![0.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 3.0, 0.0];
        let new_idxs: Vec<u32> = vec![0, 1, 2];
        assert_eq!(
            engine.physics3d_rebuild_mesh_collider(
                0,
                42,
                &new_verts,
                &new_idxs,
                0.0,
                0.0,
                0.0,
                false,
                0.5,
                0.0,
                0xFFFF_FFFF,
                0xFFFF_FFFF
            ),
            Ok(true)
        );
    }

    #[cfg(feature = "physics3d")]
    #[test]
    fn test_physics3d_rebuild_mesh_collider_binding_returns_not_initialized_when_no_world() {
        let mut engine = Engine::new(64).expect("max entities");
        // physics3d not initialised.
        let verts: Vec<f32> = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let idxs: Vec<u32> = vec![0, 1, 2];
        assert_eq!(
            engine.physics3d_rebuild_mesh_collider(
                0,
                1,
                &verts,
                &idxs,
                0.0,
                0.0,
                0.0,
                false,
                0.5,
                0.0,
                0xFFFF_FFFF,
                0xFFFF_FFFF
            ),
            Err(Physics3DError::WorldNotInitialized)
        );
    }

    /// The registry stores alignment 8 for every live shared buffer.
    #[test]
    fn unsafe_site_u001_records_align_8() {
        let mut engine = Engine::new(1).unwrap_or_else(|err| {
            assert_eq!("", err.code());
            std::process::abort();
        });
        let lengths = [1usize, 3, 9, 8];
        let mut ptrs = [0usize; 4];
        for (index, length) in lengths.iter().copied().enumerate() {
            let ptr = engine.alloc_shared_buffer(length);
            assert_ne!(ptr, 0);
            assert_eq!(ptr % 8, 0);
            let Some((_, align)) = engine.shared_buffers.get(&ptr).copied() else {
                assert_eq!("", "missing shared buffer");
                return;
            };
            assert_eq!(align, 8);
            ptrs[index] = ptr;
        }
        for (index, length) in lengths.iter().copied().enumerate() {
            assert_eq!(engine.free_shared_buffer(ptrs[index], length), Ok(()));
        }
    }

    /// The export copies a buffer this test sized. The dimensions are checked, the address is not.
    #[cfg(feature = "physics3d")]
    #[test]
    fn unsafe_site_u004_export_copies_cells() {
        let mut engine = Engine::new(4).unwrap_or_else(|err| {
            assert_eq!("", err.code());
            std::process::abort();
        });
        engine.physics3d_init(0.0, 0.0, 0.0, 4);
        let cells = [9u8, 8, 7, 6, 5, 4, 3, 2, 1];
        assert_eq!(
            engine.physics3d_init_navgrid_3d(cells.as_ptr() as usize, 3, 1, 3, 1.0, 0.0, 0.0, 0.0),
            Ok(())
        );
        let Some(world) = engine.physics3d_world.as_ref() else {
            assert_eq!("", "no physics3d world");
            return;
        };
        let Some(grid) = world.nav_grid() else {
            assert_eq!("", "no nav grid");
            return;
        };
        assert_eq!(
            crate::physics3d::pathfinding::navgrid_cells(grid),
            cells.as_slice()
        );
    }
    /// Allocation failure of `transform_history_commit` on a native host.
    /// A process-wide counter would count other lib tests. The flag is per thread.
    #[cfg(all(test, not(target_arch = "wasm32")))]
    mod history_commit_failure {
        use std::alloc::{GlobalAlloc, Layout, System};
        use std::cell::Cell;

        use super::super::*;

        thread_local! {
            static FAIL_LARGE: Cell<bool> = const { Cell::new(false) };
        }

        struct ResetFail;

        impl Drop for ResetFail {
            fn drop(&mut self) {
                FAIL_LARGE.with(|flag| flag.set(false));
            }
        }

        // SAFETY: forwards to the system allocator, except a large request made while
        // `FAIL_LARGE` is set on this thread, which returns null so `try_reserve_exact` fails.
        unsafe impl GlobalAlloc for FailLarge {
            unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
                let fail = FAIL_LARGE.with(Cell::get);
                if fail && layout.size() >= 1024 {
                    return std::ptr::null_mut();
                }
                // SAFETY: `layout` is the layout the caller passed to this allocator.
                unsafe { System.alloc(layout) }
            }

            unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
                // SAFETY: `ptr` and `layout` are the pair this allocator returned.
                unsafe { System.dealloc(ptr, layout) }
            }

            unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
                let fail = FAIL_LARGE.with(Cell::get);
                if fail && new_size >= 1024 {
                    return std::ptr::null_mut();
                }
                // SAFETY: `ptr` and `layout` are the pair this allocator returned.
                unsafe { System.realloc(ptr, layout, new_size) }
            }
        }

        struct FailLarge;

        #[global_allocator]
        static GLOBAL: FailLarge = FailLarge;

        #[test]
        fn history_pair_bytes_fits_67108864_entities_when_usize_is_64_bits() {
            assert_eq!(usize::BITS, 64);
            let smallest_wasm32_overflow = 67_108_864u32;
            let product = u64::from(smallest_wasm32_overflow) * 64;
            assert_eq!(product, 1u64 << 32);
            match history_pair_bytes(smallest_wasm32_overflow) {
                Some(bytes) => assert_eq!(bytes, product as usize),
                None => assert_eq!(0, 1),
            }
            match history_pair_bytes(u32::MAX) {
                Some(bytes) => assert_eq!(bytes, usize::try_from(u32::MAX).unwrap_or(0) * 64),
                None => assert_eq!(0, 1),
            }
        }

        #[test]
        fn history_commit_allocation_failure_stores_nothing_and_does_not_flip_parity() {
            let mut engine = match Engine::new(64) {
                Ok(engine) => engine,
                Err(err) => {
                    assert_eq!(err.code(), "");
                    return;
                }
            };
            FAIL_LARGE.with(|flag| flag.set(true));
            let _reset = ResetFail;
            let shown = format!("{:?}", engine.transform_history_commit());
            let ptr0 = engine.transform_history_ptr(0);
            let ptr1 = engine.transform_history_ptr(1);
            let parity = engine.transform_history.current;
            FAIL_LARGE.with(|flag| flag.set(false));
            let next = format!("{:?}", engine.transform_history_commit());
            assert_eq!(ptr0, 0);
            assert_eq!(ptr1, 0);
            assert_eq!(parity, None);
            assert_eq!(shown, "Err(HistoryBuffersUnavailable { max_entities: 64 })");
            assert_eq!(next, "Ok(0)");
        }
    }
}

/// Smallest `max_entities` whose history pair overflows a 32-bit `usize`.
#[cfg(all(test, target_arch = "wasm32"))]
mod history_commit_overflow {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    const SMALLEST_OVERFLOW: u32 = 67_108_864;

    #[wasm_bindgen_test]
    fn smallest_wasm32_input_overflows_and_stores_nothing() {
        match history_pair_bytes(SMALLEST_OVERFLOW - 1) {
            Some(_) => {}
            None => assert_eq!(0, 1),
        }
        match history_pair_bytes(SMALLEST_OVERFLOW) {
            None => {}
            Some(bytes) => assert_eq!(bytes, 1),
        }
        let mut engine = match Engine::new(1) {
            Ok(engine) => engine,
            Err(err) => {
                assert_eq!(err.code(), "");
                return;
            }
        };
        engine.entity_manager = EntityManager::with_unreserved_limit(SMALLEST_OVERFLOW);
        let shown = format!("{:?}", engine.transform_history_commit());
        assert_eq!(engine.transform_history_ptr(0), 0);
        assert_eq!(engine.transform_history_ptr(1), 0);
        assert_eq!(engine.transform_history.current, None);
        assert_eq!(
            shown,
            "Err(HistoryBuffersUnavailable { max_entities: 67108864 })"
        );
    }
}
