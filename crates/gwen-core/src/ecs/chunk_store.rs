//! Chunked archetype columns.
//!
//! This module is public so native tests can reach it. The engine does not
//! call it yet.

use crate::CoreError;

/// Rows stored in one chunk. A row index fits in a `u16`.
pub const CHUNK_ROWS: usize = 1024;

/// Archetype masks this store will create.
pub const MAX_ARCHETYPES: u32 = 4096;

/// Lanes one component layout may list.
pub const MAX_LANES: usize = 64;

/// Bytes in one component row, summed across its lanes.
pub const MAX_ROW_BYTES: usize = 512;

/// `ComponentLayoutInvalid.reason`: the lane byte is not 0..=7.
pub const LAYOUT_REASON_UNKNOWN_LANE: u8 = 1;

/// `ComponentLayoutInvalid.reason`: the layout lists more than 64 lanes.
pub const LAYOUT_REASON_TOO_MANY_LANES: u8 = 2;

/// `ComponentLayoutInvalid.reason`: `type_id` was never registered.
pub const LAYOUT_REASON_UNREGISTERED_TYPE: u8 = 3;

/// `ComponentLayoutInvalid.reason`: `data.len()` is not the layout width.
pub const LAYOUT_REASON_BAD_LEN: u8 = 4;

/// `ComponentLayoutInvalid.reason`: the summed lane widths exceed 512 bytes.
pub const LAYOUT_REASON_ROW_TOO_BIG: u8 = 5;

/// One column kind. The byte is the spec discriminant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LaneKind(pub u8);

/// Registered shape of one component type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComponentLayout {
    /// Id returned by [`ChunkStore::register`].
    pub type_id: u32,
    /// Bit in the archetype mask. Equal to `type_id` while ids stay below 128.
    pub bit: u8,
    /// Lane discriminants, in registration order.
    pub lanes: Vec<LaneKind>,
    /// Sum of the lane widths.
    pub row_bytes: u16,
}

/// Where an entity's row sits. Absent when the entity has no component.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityLocation {
    /// Chunk slot index.
    pub chunk: u32,
    /// Row inside that chunk.
    pub row: u16,
}

/// One component mask and the chunks that hold its rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Archetype {
    /// Index in the store's archetype table.
    pub id: u32,
}

/// One fixed block of rows. Lane buffers are allocated with the chunk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Chunk {
    /// Archetype that owns this chunk.
    pub archetype: u32,
    /// Rows in use. Every chunk except the archetype's last one is full.
    pub len: u16,
    /// Rows `[0, awake)` are awake. Dormant rows sit in `[awake, len)`.
    pub awake: u16,
}

/// Inert stand-in. Reads are empty. Writes report that nothing happened.
pub struct ChunkStore {
    max_entities: u32,
    staging: [u8; MAX_ROW_BYTES],
}

impl ChunkStore {
    /// Accepts any `max_entities` until the store checks the limit.
    pub fn new(max_entities: u32) -> Result<Self, CoreError> {
        Ok(Self {
            max_entities,
            staging: [0; MAX_ROW_BYTES],
        })
    }

    /// Table length passed to [`ChunkStore::new`].
    pub fn max_entities(&self) -> u32 {
        self.max_entities
    }

    /// Does not record a layout.
    pub fn register(&mut self, lane_kinds: &[u8]) -> Result<u32, CoreError> {
        let _ = lane_kinds;
        Ok(0)
    }

    /// Does not write a row.
    pub fn add(
        &mut self,
        index: u32,
        generation: u32,
        type_id: u32,
        data: &[u8],
    ) -> Result<bool, CoreError> {
        let _ = (index, generation, type_id, data);
        Ok(false)
    }

    /// Does not remove a row.
    pub fn remove(&mut self, index: u32, generation: u32, type_id: u32) -> Result<bool, CoreError> {
        let _ = (index, generation, type_id);
        Ok(false)
    }

    /// Does not free a slot.
    pub fn delete_entity(&mut self, index: u32, generation: u32) -> bool {
        let _ = (index, generation);
        false
    }

    /// Does not move a row.
    pub fn set_dormant(
        &mut self,
        index: u32,
        generation: u32,
        dormant: bool,
    ) -> Result<bool, CoreError> {
        let _ = (index, generation, dormant);
        Ok(false)
    }

    /// Does not read the staging bytes.
    pub fn write_staged(
        &mut self,
        index: u32,
        generation: u32,
        type_id: u32,
    ) -> Result<bool, CoreError> {
        let _ = (index, generation, type_id);
        Ok(false)
    }

    /// Does not fill the staging bytes.
    pub fn read_staged(&mut self, index: u32, generation: u32, type_id: u32) -> bool {
        let _ = (index, generation, type_id);
        false
    }

    /// The 512-byte staging buffer.
    pub fn staging(&self) -> &[u8] {
        &self.staging
    }

    /// The 512-byte staging buffer.
    pub fn staging_mut(&mut self) -> &mut [u8] {
        &mut self.staging
    }

    /// Storage generation. A lane write does not change it.
    pub fn generation(&self) -> u32 {
        0
    }

    /// `Some(true)` when the live row is dormant.
    pub fn is_dormant(&self, index: u32, generation: u32) -> Option<bool> {
        let _ = (index, generation);
        None
    }

    /// Copies one component row into `out`.
    pub fn copy_row(&self, index: u32, generation: u32, type_id: u32, out: &mut [u8]) -> bool {
        let _ = (index, generation, type_id, out);
        false
    }

    /// Row of a live entity, if it has any component.
    pub fn location(&self, index: u32) -> Option<EntityLocation> {
        let _ = index;
        None
    }

    /// Awake prefix of a live chunk.
    pub fn chunk_awake(&self, chunk: u32) -> Option<u16> {
        let _ = chunk;
        None
    }

    /// Rows in use in a live chunk.
    pub fn chunk_len(&self, chunk: u32) -> Option<u16> {
        let _ = chunk;
        None
    }

    /// Entity index and generation stored at one row.
    pub fn chunk_entity(&self, chunk: u32, row: u16) -> Option<(u32, u32)> {
        let _ = (chunk, row);
        None
    }

    /// Chunk slots allocated, including slots whose chunk was freed.
    pub fn chunk_slot_count(&self) -> u32 {
        0
    }

    /// Address of one lane buffer. Stable until that chunk is freed.
    pub fn lane_ptr(&self, chunk: u32, lane: usize) -> Option<usize> {
        let _ = (chunk, lane);
        None
    }

    /// Address of the chunk's entity-index column.
    pub fn entity_index_ptr(&self, chunk: u32) -> Option<usize> {
        let _ = chunk;
        None
    }

    /// Archetypes created so far.
    pub fn archetype_count(&self) -> u32 {
        0
    }

    /// Layouts registered so far.
    pub fn layout_count(&self) -> u32 {
        0
    }

    /// Generation of one entity slot.
    pub fn slot_generation(&self, index: u32) -> Option<u32> {
        let _ = index;
        None
    }

    /// Archetype of an entity that has a row.
    pub fn entity_archetype(&self, index: u32) -> Option<u32> {
        let _ = index;
        None
    }

    /// Chunks the archetype still holds, including one kept empty chunk.
    pub fn archetype_chunk_count(&self, archetype: u32) -> Option<u32> {
        let _ = archetype;
        None
    }

    /// Layout recorded for `type_id`.
    pub fn layout(&self, type_id: u32) -> Option<&ComponentLayout> {
        let _ = type_id;
        None
    }
}
