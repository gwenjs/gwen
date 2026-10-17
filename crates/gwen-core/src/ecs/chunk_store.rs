//! Chunked archetype columns.
//!
//! Public so native tests can reach it. The engine stores components here.
//! A hole is filled from the archetype's last live row, including a row in an
//! earlier chunk. A trailing empty chunk is skipped. The moved row keeps its
//! dormancy: if it lands on the wrong side of `awake`, it swaps with the
//! boundary row in that same chunk and `awake` moves by one. A later chunk
//! may stay fully awake. An archetype keeps at most one empty chunk. A chunk
//! that becomes empty is freed only when that archetype already keeps another
//! empty chunk. The kept chunk is reused by the next row once every earlier
//! chunk is full. A freed id is taken again on a later call, once this call
//! has bumped `generation`.
//!
//! Dormancy lives on the row. An entity with no components has no row, so
//! [`ChunkStore::set_dormant`] returns `Ok(false)`. Removing the last
//! component drops the row and forgets dormancy. The next [`ChunkStore::add`]
//! is awake.

use super::{BitSet128, CoreError, MAX_COMPONENT_TYPES, MAX_ENTITIES_LIMIT};

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

const NO_CHUNK: u32 = u32::MAX;
const TYPE_SLOTS: usize = MAX_COMPONENT_TYPES as usize;
const STAGING_WORDS: usize = MAX_ROW_BYTES / 8;

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
#[derive(Debug)]
pub struct Archetype {
    /// Index in the store's archetype table.
    pub id: u32,
    mask: BitSet128,
    types: Vec<u32>,
    /// First lane index of each type, parallel to `types`.
    lane_at: Vec<u16>,
    lane_sizes: Vec<u8>,
    chunks: Vec<u32>,
}

/// One fixed block of rows. Lane buffers are allocated with the chunk.
#[derive(Debug)]
pub struct Chunk {
    /// Archetype that owns this chunk.
    pub archetype: u32,
    /// Rows in use. Every chunk except the archetype's last one is full.
    pub len: u16,
    /// Rows `[0, awake)` are awake. Dormant rows sit in `[awake, len)`.
    pub awake: u16,
    entity_index: Vec<u32>,
    entity_generation: Vec<u32>,
    lanes: Vec<LaneBuf>,
}

#[derive(Debug)]
struct LaneBuf {
    words: Vec<u64>,
    byte_len: usize,
    lane_size: usize,
}

#[derive(Debug)]
struct ChunkSlot {
    data: Option<Chunk>,
}

#[derive(Clone, Copy)]
struct EntitySlot {
    generation: u32,
    chunk: u32,
    row: u16,
}

struct Reserved {
    chunk_id: u32,
    row: u16,
    swap_with: Option<u16>,
}

#[derive(Clone, Copy)]
struct RowAt {
    arch: usize,
    chunk: u32,
    row: u16,
}

struct AddPlan {
    count: usize,
    dormant: bool,
    source: Option<RowAt>,
}

/// SoA columns for every archetype of one engine.
pub struct ChunkStore {
    max_entities: u32,
    generation: u32,
    slots: Vec<EntitySlot>,
    layouts: Vec<ComponentLayout>,
    archetypes: Vec<Archetype>,
    chunks: Vec<ChunkSlot>,
    /// Freed chunk ids. Popped only by a later call, after `generation` bumped.
    free_chunks: Vec<u32>,
    staging: [u64; STAGING_WORDS],
    queries: Vec<Option<StoreQuery>>,
    free_queries: Vec<u32>,
}

struct StoreQuery {
    types: Vec<u32>,
    /// Viewable lanes in query order: `(type_id, lane offset inside that type)`.
    viewable: Vec<(u32, u16)>,
    matched: Vec<u32>,
    lane_at: Vec<u16>,
    scratch: Vec<u32>,
    table: Vec<u32>,
}

fn ptr_word(ptr: usize) -> u32 {
    u32::try_from(ptr).unwrap_or(0)
}

fn lane_size(kind: u8) -> Option<usize> {
    match kind {
        0 | 2 | 3 | 7 => Some(4),
        1 | 5 | 6 => Some(8),
        4 => Some(1),
        _ => None,
    }
}

fn layout_error(type_id: u32, reason: u8) -> CoreError {
    CoreError::ComponentLayoutInvalid { type_id, reason }
}

fn inconsistent(site: u32) -> CoreError {
    CoreError::StorageInconsistent { site }
}

impl EntitySlot {
    fn empty() -> Self {
        Self {
            generation: 0,
            chunk: NO_CHUNK,
            row: 0,
        }
    }
}

impl LaneBuf {
    fn allocate(lane_size: usize) -> Option<Self> {
        if lane_size == 0 || lane_size > 8 {
            return None;
        }
        let byte_len = CHUNK_ROWS.checked_mul(lane_size)?;
        let words = byte_len.div_ceil(8);
        Some(Self {
            words: vec![0u64; words],
            byte_len,
            lane_size,
        })
    }

    fn bytes(&self) -> Option<&[u8]> {
        let all = bytemuck::try_cast_slice(&self.words).ok()?;
        all.get(..self.byte_len)
    }

    fn bytes_mut(&mut self) -> Option<&mut [u8]> {
        let all = bytemuck::try_cast_slice_mut(&mut self.words).ok()?;
        all.get_mut(..self.byte_len)
    }
}

impl ChunkStore {
    /// `max_entities` must be from 1 through [`MAX_ENTITIES_LIMIT`].
    ///
    /// The slot table is allocated here and is not grown later.
    pub fn new(max_entities: u32) -> Result<Self, CoreError> {
        if max_entities == 0 || max_entities > MAX_ENTITIES_LIMIT {
            return Err(CoreError::InvalidMaxEntities {
                value: max_entities,
                max: MAX_ENTITIES_LIMIT,
            });
        }
        let mut slots = Vec::new();
        slots.resize(max_entities as usize, EntitySlot::empty());
        Ok(Self {
            max_entities,
            generation: 0,
            slots,
            layouts: Vec::new(),
            archetypes: Vec::new(),
            chunks: Vec::new(),
            free_chunks: Vec::new(),
            staging: [0; STAGING_WORDS],
            queries: Vec::new(),
            free_queries: Vec::new(),
        })
    }

    /// Table length passed to [`ChunkStore::new`].
    pub fn max_entities(&self) -> u32 {
        self.max_entities
    }

    /// Records a layout and returns its type id.
    ///
    /// The 129th call returns [`CoreError::ComponentTypeLimitReached`] before
    /// the lane bytes are checked. A layout error leaves the table unchanged.
    pub fn register(&mut self, lane_kinds: &[u8]) -> Result<u32, CoreError> {
        if self.layouts.len() >= TYPE_SLOTS {
            return Err(CoreError::ComponentTypeLimitReached {
                max: MAX_COMPONENT_TYPES,
            });
        }
        let type_id = match u32::try_from(self.layouts.len()) {
            Ok(type_id) => type_id,
            Err(_) => {
                return Err(CoreError::ComponentTypeLimitReached {
                    max: MAX_COMPONENT_TYPES,
                });
            }
        };
        if lane_kinds.len() > MAX_LANES {
            return Err(layout_error(type_id, LAYOUT_REASON_TOO_MANY_LANES));
        }
        let mut row_bytes: usize = 0;
        for kind in lane_kinds {
            let Some(size) = lane_size(*kind) else {
                return Err(layout_error(type_id, LAYOUT_REASON_UNKNOWN_LANE));
            };
            row_bytes = match row_bytes.checked_add(size) {
                Some(sum) => sum,
                None => return Err(layout_error(type_id, LAYOUT_REASON_ROW_TOO_BIG)),
            };
        }
        if row_bytes > MAX_ROW_BYTES {
            return Err(layout_error(type_id, LAYOUT_REASON_ROW_TOO_BIG));
        }
        let Ok(row_bytes) = u16::try_from(row_bytes) else {
            return Err(layout_error(type_id, LAYOUT_REASON_ROW_TOO_BIG));
        };
        let Ok(bit) = u8::try_from(type_id) else {
            return Err(CoreError::ComponentTypeLimitReached {
                max: MAX_COMPONENT_TYPES,
            });
        };
        let mut lanes = Vec::new();
        lanes.extend(lane_kinds.iter().copied().map(LaneKind));
        self.layouts.push(ComponentLayout {
            type_id,
            bit,
            lanes,
            row_bytes,
        });
        Ok(type_id)
    }

    /// Inserts `type_id` or overwrites it in place.
    ///
    /// `Ok(false)` is a stale generation: nothing changes. A new row is awake.
    /// A row that already had components keeps its dormancy across the move.
    /// On `Err`, nothing has been written.
    ///
    /// The source row, when there is one, and the new bytes are checked
    /// before a destination row is reserved. Reserving that row is the first
    /// write of the move. A `false` return after the reserve does not occur
    /// on a public call: the destination archetype is a different mask, the
    /// bytes already matched the layout, and the source hole was checked.
    /// Copying kept lanes, writing the new lanes, storing the entity index,
    /// finishing the awake swap, or filling the source hole would fail only
    /// if a lane or the chunk disappeared during this call.
    pub fn add(
        &mut self,
        index: u32,
        generation: u32,
        type_id: u32,
        data: &[u8],
    ) -> Result<bool, CoreError> {
        self.check_index(index)?;
        if !self.generation_matches(index, generation) {
            return Ok(false);
        }
        let row_bytes = match self.layouts.get(type_id as usize) {
            Some(layout) => layout.row_bytes as usize,
            None => return Err(layout_error(type_id, LAYOUT_REASON_UNREGISTERED_TYPE)),
        };
        if data.len() != row_bytes {
            return Err(layout_error(type_id, LAYOUT_REASON_BAD_LEN));
        }
        if self.row_has_type(index, type_id)? {
            self.write_in_place(index, type_id, data)?;
            return Ok(true);
        }
        let mut target = [0u32; TYPE_SLOTS];
        let plan = self.plan_add(index, type_id, &mut target)?;
        let mask = match self.mask_of(&target[..plan.count]) {
            Some(mask) => mask,
            None => return Err(layout_error(type_id, LAYOUT_REASON_UNREGISTERED_TYPE)),
        };
        let existing = self.find_archetype(mask);
        if existing.is_none() && self.archetypes.len() >= MAX_ARCHETYPES as usize {
            return Err(CoreError::ArchetypeLimitReached {
                max: MAX_ARCHETYPES,
            });
        }
        let arch = match existing {
            Some(arch) => arch,
            None => match self.create_archetype(mask, &target[..plan.count]) {
                Some(arch) => arch,
                None => {
                    return Err(CoreError::ArchetypeLimitReached {
                        max: MAX_ARCHETYPES,
                    });
                }
            },
        };
        if !self.migrate(
            index,
            generation,
            arch,
            plan.dormant,
            plan.source,
            Some((type_id, data)),
        ) {
            return Ok(false);
        }
        self.bump();
        Ok(true)
    }

    /// Drops `type_id`. `Ok(false)` means the entity does not have it, or the
    /// generation is stale. Those paths leave the store unchanged.
    ///
    /// Dropping the last component checks the row before clearing its
    /// location. A failed fill after that check does not occur: the chunk is
    /// still live and the row is inside `len`. A move onto another archetype
    /// checks the source row before reserving the destination. A `false`
    /// return after that reserve does not occur, for the same reason as
    /// [`ChunkStore::add`].
    pub fn remove(&mut self, index: u32, generation: u32, type_id: u32) -> Result<bool, CoreError> {
        self.check_index(index)?;
        if !self.generation_matches(index, generation) {
            return Ok(false);
        }
        let Some((chunk_id, row, arch)) = self.row_of(index)? else {
            return Ok(false);
        };
        if !self.arch_has(arch, type_id) {
            return Ok(false);
        }
        let type_count = match self.archetypes.get(arch) {
            Some(archetype) => archetype.types.len(),
            // `arch_has` just found this record. A miss here is not a state
            // a public call can build, and it is not reachable by corrupting
            // one field without failing `arch_has` first. Kept as `Ok(false)`.
            None => return Ok(false),
        };
        if type_count <= 1 {
            if !self.can_fill(arch, chunk_id, row) {
                return Err(inconsistent(14));
            }
            if !self.clear_loc(index) {
                return Ok(false);
            }
            if !self.fill_hole(arch, chunk_id, row)? {
                return Ok(false);
            }
            self.bump();
            return Ok(true);
        }
        let dormant = match self.row_is_dormant(chunk_id, row)? {
            Some(dormant) => dormant,
            // The chunk was live in `row_of`. Kept.
            None => return Ok(false),
        };
        let mut target = [0u32; TYPE_SLOTS];
        let count = {
            let Some(current) = self.archetypes.get(arch).map(|item| &item.types) else {
                return Ok(false);
            };
            match remove_sorted(current, type_id, &mut target) {
                Some(count) => count,
                None => return Ok(false),
            }
        };
        let mask = match self.mask_of(&target[..count]) {
            Some(mask) => mask,
            None => return Ok(false),
        };
        let existing = self.find_archetype(mask);
        if existing.is_none() && self.archetypes.len() >= MAX_ARCHETYPES as usize {
            return Err(CoreError::ArchetypeLimitReached {
                max: MAX_ARCHETYPES,
            });
        }
        let dest = match existing {
            Some(dest) => dest,
            None => match self.create_archetype(mask, &target[..count]) {
                Some(dest) => dest,
                None => {
                    return Err(CoreError::ArchetypeLimitReached {
                        max: MAX_ARCHETYPES,
                    });
                }
            },
        };
        if !self.migrate(
            index,
            generation,
            dest,
            dormant,
            Some(RowAt {
                arch,
                chunk: chunk_id,
                row,
            }),
            None,
        ) {
            return Ok(false);
        }
        self.bump();
        Ok(true)
    }

    /// Frees the slot when `generation` matches.
    ///
    /// An index past the table or a stale generation returns `false` and
    /// changes nothing. When the entity has a row, that row is checked
    /// before the slot is cleared. The check fails only when the row is
    /// already outside `len` or the archetype has no live row. Public calls
    /// do not build that state, and a failure leaves the slot as it was.
    /// Filling the hole after the check does not fail: the chunk is still
    /// live, the row is inside `len`, and clearing the slot does not drop
    /// the chunk. The storage generation bumps only when a row was removed.
    /// The slot generation always bumps on success, so the next occupant of
    /// this index is a new entity and is not dormant.
    pub fn delete_entity(&mut self, index: u32, generation: u32) -> Result<bool, CoreError> {
        if index >= self.max_entities {
            return Ok(false);
        }
        if !self.generation_matches(index, generation) {
            return Ok(false);
        }
        let saved = self.row_of(index)?;
        if let Some((chunk_id, row, arch)) = saved {
            if !self.can_fill(arch, chunk_id, row) {
                return Err(inconsistent(13));
            }
            // `awake` past `len` is site 16. A row past `len` already failed
            // `can_fill` (site 13).
            let _dormant = self.row_is_dormant(chunk_id, row)?;
        }
        // The index was checked against `max_entities`, and the slot table is
        // that long. A miss is not reachable by corrupting one field.
        let Some(slot) = self.slots.get_mut(index as usize) else {
            return Ok(false);
        };
        slot.generation = slot.generation.wrapping_add(1);
        slot.chunk = NO_CHUNK;
        slot.row = 0;
        if let Some((chunk_id, row, arch)) = saved {
            // `can_fill` already required a live row inside `len`. A miss
            // after that is not reachable by corrupting one field.
            if !self.fill_hole(arch, chunk_id, row)? {
                return Ok(false);
            }
            self.bump();
        }
        Ok(true)
    }

    /// Moves the row across its chunk's awake boundary.
    ///
    /// `Ok(false)` is a stale generation, or an entity with no row. An entity
    /// with no components has no row, so this returns `Ok(false)` and changes
    /// nothing. Removing the last component drops the row and forgets
    /// dormancy. The next [`ChunkStore::add`] of that index is awake.
    /// The same state again is `Ok(true)` and does not bump `generation`.
    /// An index past the table is [`CoreError::InvalidMaxEntities`].
    ///
    /// Sleeping a row while `awake` is 0 does not occur: every row is already
    /// dormant, and the same-state check has returned. A boundary swap whose
    /// entity has no slot returns [`CoreError::StorageInconsistent`] site 21.
    pub fn set_dormant(
        &mut self,
        index: u32,
        generation: u32,
        dormant: bool,
    ) -> Result<bool, CoreError> {
        self.check_index(index)?;
        if !self.generation_matches(index, generation) {
            return Ok(false);
        }
        let Some((chunk_id, row, _)) = self.row_of(index)? else {
            return Ok(false);
        };
        let Some(chunk) = self.chunk_ref(chunk_id) else {
            // `row_of` already required this chunk. Kept.
            return Ok(false);
        };
        if chunk.awake > chunk.len {
            return Err(inconsistent(20));
        }
        if row >= chunk.len {
            return Err(inconsistent(19));
        }
        let awake = chunk.awake;
        let is_dormant = row >= awake;
        if is_dormant == dormant {
            return Ok(true);
        }
        if dormant {
            // `row < awake` here, so `awake` is not 0. Kept.
            if awake == 0 {
                return Ok(false);
            }
            let boundary = awake - 1;
            if !self.swap_rows(chunk_id, row, boundary) {
                return Err(inconsistent(21));
            }
            let Some(chunk) = self.chunk_mut(chunk_id) else {
                return Ok(false);
            };
            chunk.awake -= 1;
        } else {
            if !self.swap_rows(chunk_id, row, awake) {
                return Err(inconsistent(21));
            }
            let Some(chunk) = self.chunk_mut(chunk_id) else {
                return Ok(false);
            };
            chunk.awake = chunk.awake.saturating_add(1);
        }
        self.bump();
        Ok(true)
    }

    /// Upserts from `staging[0..row_bytes]`. `Ok(false)` means the generation
    /// is stale. The staging bytes stay as the caller left them.
    pub fn write_staged(
        &mut self,
        index: u32,
        generation: u32,
        type_id: u32,
    ) -> Result<bool, CoreError> {
        let width = match self.layouts.get(type_id as usize) {
            Some(layout) => layout.row_bytes as usize,
            None => return Err(layout_error(type_id, LAYOUT_REASON_UNREGISTERED_TYPE)),
        };
        if width > MAX_ROW_BYTES {
            return Err(layout_error(type_id, LAYOUT_REASON_ROW_TOO_BIG));
        }
        let mut tmp = [0u8; MAX_ROW_BYTES];
        let Some(dst) = tmp.get_mut(..width) else {
            return Err(layout_error(type_id, LAYOUT_REASON_ROW_TOO_BIG));
        };
        let Some(src) = self.staging().get(..width) else {
            return Err(layout_error(type_id, LAYOUT_REASON_ROW_TOO_BIG));
        };
        dst.copy_from_slice(src);
        self.add(index, generation, type_id, &tmp[..width])
    }

    /// Copies the row into the staging buffer.
    ///
    /// Returns `false` when the generation is stale, the row is absent, or
    /// the type is not on the entity. The staging bytes are then unchanged.
    pub fn read_staged(
        &mut self,
        index: u32,
        generation: u32,
        type_id: u32,
    ) -> Result<bool, CoreError> {
        let Some(width) = self
            .layouts
            .get(type_id as usize)
            .map(|layout| layout.row_bytes as usize)
        else {
            return Ok(false);
        };
        if width > MAX_ROW_BYTES {
            return Ok(false);
        }
        let mut tmp = [0u8; MAX_ROW_BYTES];
        let Some(dst) = tmp.get_mut(..width) else {
            return Ok(false);
        };
        if !self.copy_row(index, generation, type_id, dst)? {
            return Ok(false);
        }
        let Some(slot) = self.staging_mut().get_mut(..width) else {
            return Ok(false);
        };
        let Some(src) = tmp.get(..width) else {
            return Ok(false);
        };
        slot.copy_from_slice(src);
        Ok(true)
    }

    /// The 512-byte staging buffer. The allocation is 8-byte aligned.
    pub fn staging(&self) -> &[u8] {
        bytemuck::try_cast_slice(&self.staging).unwrap_or(&[])
    }

    /// The 512-byte staging buffer. The allocation is 8-byte aligned.
    pub fn staging_mut(&mut self) -> &mut [u8] {
        bytemuck::try_cast_slice_mut(&mut self.staging).unwrap_or(&mut [])
    }

    /// Storage generation. A lane write does not change it.
    pub fn generation(&self) -> u32 {
        self.generation
    }

    /// `Some(true)` when the live row is dormant.
    pub fn is_dormant(&self, index: u32, generation: u32) -> Result<Option<bool>, CoreError> {
        let Some(slot) = self.slots.get(index as usize) else {
            return Ok(None);
        };
        if slot.generation != generation || slot.chunk == NO_CHUNK {
            return Ok(None);
        }
        let Some(chunk) = self.chunk_ref(slot.chunk) else {
            return Err(inconsistent(2));
        };
        if chunk.awake > chunk.len {
            return Err(inconsistent(4));
        }
        if slot.row >= chunk.len {
            return Err(inconsistent(3));
        }
        Ok(Some(slot.row >= chunk.awake))
    }

    /// Copies one component row into `out`.
    pub fn copy_row(
        &self,
        index: u32,
        generation: u32,
        type_id: u32,
        out: &mut [u8],
    ) -> Result<bool, CoreError> {
        let Some(width) = self
            .layouts
            .get(type_id as usize)
            .map(|layout| layout.row_bytes as usize)
        else {
            return Ok(false);
        };
        if out.len() != width {
            return Ok(false);
        }
        let Some(slot) = self.slots.get(index as usize) else {
            return Ok(false);
        };
        if slot.generation != generation || slot.chunk == NO_CHUNK {
            return Ok(false);
        }
        let chunk_id = slot.chunk;
        let row = slot.row;
        let Some(chunk) = self.chunk_ref(chunk_id) else {
            return Err(inconsistent(8));
        };
        if chunk.awake > chunk.len {
            return Err(inconsistent(10));
        }
        if row >= chunk.len {
            return Err(inconsistent(9));
        }
        let arch = chunk.archetype as usize;
        let Some((start, end)) = self.lane_range(arch, type_id) else {
            return Ok(false);
        };
        let mut offset = 0usize;
        for lane in start..end {
            let Some(cell) = self.read_cell(chunk_id, lane, row) else {
                return Err(inconsistent(11));
            };
            let Some(size) = self
                .chunk_ref(chunk_id)
                .and_then(|chunk| chunk.lanes.get(lane))
                .map(|lane| lane.lane_size)
            else {
                // `read_cell` just found this lane. Kept.
                return Ok(false);
            };
            let Some(next) = offset.checked_add(size) else {
                return Ok(false);
            };
            let Some(dst) = out.get_mut(offset..next) else {
                return Ok(false);
            };
            let Some(src) = cell.get(..size) else {
                return Ok(false);
            };
            dst.copy_from_slice(src);
            offset = next;
        }
        Ok(offset == out.len())
    }

    /// Row of a live entity, if it has any component.
    pub fn location(&self, index: u32) -> Option<EntityLocation> {
        let slot = self.slots.get(index as usize)?;
        if slot.chunk == NO_CHUNK {
            return None;
        }
        Some(EntityLocation {
            chunk: slot.chunk,
            row: slot.row,
        })
    }

    /// Awake prefix of a live chunk.
    pub fn chunk_awake(&self, chunk: u32) -> Option<u16> {
        Some(self.chunk_ref(chunk)?.awake)
    }

    /// Rows in use in a live chunk.
    pub fn chunk_len(&self, chunk: u32) -> Option<u16> {
        Some(self.chunk_ref(chunk)?.len)
    }

    /// Entity index and generation stored at one row.
    pub fn chunk_entity(&self, chunk: u32, row: u16) -> Option<(u32, u32)> {
        let data = self.chunk_ref(chunk)?;
        if row >= data.len {
            return None;
        }
        let index = *data.entity_index.get(row as usize)?;
        let generation = *data.entity_generation.get(row as usize)?;
        Some((index, generation))
    }

    /// Chunk slots allocated, including slots whose chunk was freed.
    pub fn chunk_slot_count(&self) -> u32 {
        u32::try_from(self.chunks.len()).unwrap_or_default()
    }

    /// Address of one lane buffer. Stable until that chunk is freed.
    pub fn lane_ptr(&self, chunk: u32, lane: usize) -> Option<usize> {
        let data = self.chunk_ref(chunk)?;
        let buf = data.lanes.get(lane)?;
        Some(buf.words.as_ptr() as usize)
    }

    /// Address of the chunk's entity-index column.
    pub fn entity_index_ptr(&self, chunk: u32) -> Option<usize> {
        Some(self.chunk_ref(chunk)?.entity_index.as_ptr() as usize)
    }

    /// Archetypes created so far.
    pub fn archetype_count(&self) -> u32 {
        u32::try_from(self.archetypes.len()).unwrap_or_default()
    }

    /// Layouts registered so far.
    pub fn layout_count(&self) -> u32 {
        u32::try_from(self.layouts.len()).unwrap_or_default()
    }

    /// Generation of one entity slot.
    pub fn slot_generation(&self, index: u32) -> Option<u32> {
        Some(self.slots.get(index as usize)?.generation)
    }

    /// Archetype of an entity that has a row.
    pub fn entity_archetype(&self, index: u32) -> Result<Option<u32>, CoreError> {
        let Some(slot) = self.slots.get(index as usize) else {
            return Ok(None);
        };
        if slot.chunk == NO_CHUNK {
            return Ok(None);
        }
        let Some(chunk) = self.chunk_ref(slot.chunk) else {
            return Err(inconsistent(12));
        };
        Ok(Some(chunk.archetype))
    }

    /// Chunks the archetype still holds, including one kept empty chunk.
    pub fn archetype_chunk_count(&self, archetype: u32) -> Option<u32> {
        let count = self.archetypes.get(archetype as usize)?.chunks.len();
        u32::try_from(count).ok()
    }

    /// Layout recorded for `type_id`.
    pub fn layout(&self, type_id: u32) -> Option<&ComponentLayout> {
        self.layouts.get(type_id as usize)
    }

    /// Address of the chunk's entity-generation column.
    pub fn entity_generation_ptr(&self, chunk: u32) -> Option<usize> {
        Some(self.chunk_ref(chunk)?.entity_generation.as_ptr() as usize)
    }

    /// The live row holds `type_id` and the generation matches.
    pub fn has(&self, index: u32, generation: u32, type_id: u32) -> Result<bool, CoreError> {
        let Some(slot) = self.slots.get(index as usize) else {
            return Ok(false);
        };
        if slot.generation != generation || slot.chunk == NO_CHUNK {
            return Ok(false);
        }
        let Some(chunk) = self.chunk_ref(slot.chunk) else {
            return Err(inconsistent(5));
        };
        if chunk.awake > chunk.len {
            return Err(inconsistent(7));
        }
        if slot.row >= chunk.len {
            return Err(inconsistent(6));
        }
        Ok(self.arch_has(chunk.archetype as usize, type_id))
    }

    /// Awake rows whose archetype holds every type in `types`.
    pub fn count_awake(&self, types: &[u32]) -> Result<usize, CoreError> {
        if types.is_empty() {
            return Ok(0);
        }
        let mut total = 0usize;
        for index in 0..self.archetypes.len() {
            if !self.arch_has_types(index, types) {
                continue;
            }
            let chunks = self
                .archetypes
                .get(index)
                .map(|arch| arch.chunks.len())
                .unwrap_or(0);
            for cursor in 0..chunks {
                let Some(chunk_id) = self
                    .archetypes
                    .get(index)
                    .and_then(|arch| arch.chunks.get(cursor))
                    .copied()
                else {
                    continue;
                };
                let awake = self.listed_awake(chunk_id)?;
                total = total.saturating_add(usize::from(awake));
            }
        }
        Ok(total)
    }

    /// `awake` of a chunk an archetype still lists.
    fn listed_awake(&self, chunk_id: u32) -> Result<u16, CoreError> {
        let Some(chunk) = self.chunk_ref(chunk_id) else {
            return Err(inconsistent(22));
        };
        if chunk.awake > chunk.len {
            return Err(inconsistent(23));
        }
        Ok(chunk.awake)
    }

    /// Writes awake `(index, generation)` pairs into the two buffers.
    ///
    /// The number written is the smaller of the match count and the buffer lengths.
    pub fn write_awake(
        &self,
        types: &[u32],
        slots: &mut [u32],
        gens: &mut [u32],
    ) -> Result<usize, CoreError> {
        if types.is_empty() {
            return Ok(0);
        }
        let cap = slots.len().min(gens.len());
        let mut written = 0usize;
        for index in 0..self.archetypes.len() {
            if written >= cap {
                break;
            }
            if !self.arch_has_types(index, types) {
                continue;
            }
            let chunks = self
                .archetypes
                .get(index)
                .map(|arch| arch.chunks.len())
                .unwrap_or(0);
            for cursor in 0..chunks {
                if written >= cap {
                    break;
                }
                let Some(chunk_id) = self
                    .archetypes
                    .get(index)
                    .and_then(|arch| arch.chunks.get(cursor))
                    .copied()
                else {
                    continue;
                };
                let awake = usize::from(self.listed_awake(chunk_id)?);
                let Some(chunk) = self.chunk_ref(chunk_id) else {
                    // `listed_awake` just required this chunk. Kept.
                    continue;
                };
                for row in 0..awake {
                    if written >= cap {
                        break;
                    }
                    let Some(entity) = chunk.entity_index.get(row).copied() else {
                        continue;
                    };
                    let Some(generation) = chunk.entity_generation.get(row).copied() else {
                        continue;
                    };
                    let Some(slot) = slots.get_mut(written) else {
                        break;
                    };
                    *slot = entity;
                    let Some(gen) = gens.get_mut(written) else {
                        break;
                    };
                    *gen = generation;
                    written += 1;
                }
            }
        }
        Ok(written)
    }

    /// Records a query. An empty list is [`CoreError::QueryInvalid`] and stores nothing.
    ///
    /// An unregistered type id is [`CoreError::ComponentLayoutInvalid`] and stores nothing.
    pub fn register_query(&mut self, type_ids: &[u32]) -> Result<u32, CoreError> {
        if type_ids.is_empty() {
            return Err(CoreError::QueryInvalid { query: 0 });
        }
        let mut viewable = Vec::new();
        for &type_id in type_ids {
            let Some(layout) = self.layouts.get(type_id as usize) else {
                return Err(layout_error(type_id, LAYOUT_REASON_UNREGISTERED_TYPE));
            };
            for (offset, lane) in layout.lanes.iter().enumerate() {
                if lane.0 > 4 {
                    continue;
                }
                let Ok(offset) = u16::try_from(offset) else {
                    continue;
                };
                viewable.push((type_id, offset));
            }
        }
        let query = StoreQuery {
            types: type_ids.to_vec(),
            viewable,
            matched: Vec::new(),
            lane_at: Vec::new(),
            scratch: Vec::new(),
            table: Vec::new(),
        };
        if let Some(id) = self.free_queries.pop() {
            let Some(slot) = self.queries.get_mut(id as usize) else {
                return Err(CoreError::QueryInvalid { query: id });
            };
            *slot = Some(query);
            return Ok(id);
        }
        let Ok(id) = u32::try_from(self.queries.len()) else {
            return Err(CoreError::QueryInvalid { query: 0 });
        };
        self.queries.push(Some(query));
        Ok(id)
    }

    /// Drops a query. An unknown handle does nothing.
    pub fn release_query(&mut self, query: u32) {
        let Some(slot) = self.queries.get_mut(query as usize) else {
            return;
        };
        if slot.is_none() {
            return;
        }
        *slot = None;
        self.free_queries.push(query);
    }

    /// Words of the last `query_chunks` fill. `None` when the handle is unknown.
    pub fn query_table(&self, query: u32) -> Option<&[u32]> {
        self.queries
            .get(query as usize)?
            .as_ref()
            .map(|query| query.table.as_slice())
    }

    /// Fills the query table and returns its address as `u32`.
    ///
    /// On a 64-bit host the address does not fit, and the word is 0. The table
    /// is still readable from [`ChunkStore::query_table`]. wasm32 stores the
    /// real address. Awake changes bump the storage generation, so each call
    /// rebuilds the table. A same-generation call fills the buffer again.
    pub fn query_chunks(&mut self, query: u32) -> Result<u32, CoreError> {
        self.fill_query(query)?;
        let ptr = self
            .query_table(query)
            .map(|table| table.as_ptr() as usize)
            .unwrap_or(0);
        Ok(u32::try_from(ptr).unwrap_or(0))
    }

    fn fill_query(&mut self, query_id: u32) -> Result<(), CoreError> {
        let Ok(index) = usize::try_from(query_id) else {
            return Err(CoreError::QueryInvalid { query: query_id });
        };
        let exists = self.queries.get(index).is_some_and(|slot| slot.is_some());
        if !exists {
            return Err(CoreError::QueryInvalid { query: query_id });
        }
        let mut query = match self.queries.get_mut(index).and_then(|slot| slot.take()) {
            Some(query) => query,
            None => return Err(CoreError::QueryInvalid { query: query_id }),
        };
        if let Err(err) = self.rebuild_query(&mut query) {
            if let Some(slot) = self.queries.get_mut(index) {
                *slot = Some(query);
            }
            return Err(err);
        }
        if let Some(slot) = self.queries.get_mut(index) {
            *slot = Some(query);
        }
        Ok(())
    }

    fn rebuild_query(&mut self, query: &mut StoreQuery) -> Result<(), CoreError> {
        query.matched.clear();
        query.lane_at.clear();
        query.table.clear();
        let view_count = query.viewable.len();
        let arch_count = self.archetypes.len();
        for arch_index in 0..arch_count {
            if !self.arch_has_types(arch_index, &query.types) {
                continue;
            }
            let lane_start = query.lane_at.len();
            let mut lanes_ok = true;
            for cursor in 0..view_count {
                let Some((type_id, offset)) = query.viewable.get(cursor).copied() else {
                    lanes_ok = false;
                    break;
                };
                let Some((start, _)) = self.lane_range(arch_index, type_id) else {
                    lanes_ok = false;
                    break;
                };
                let lane = start.saturating_add(usize::from(offset));
                let Ok(word) = u16::try_from(lane) else {
                    lanes_ok = false;
                    break;
                };
                query.lane_at.push(word);
            }
            if !lanes_ok {
                query.lane_at.truncate(lane_start);
                continue;
            }
            let Some(arch_id) = self.archetypes.get(arch_index).map(|arch| arch.id) else {
                query.lane_at.truncate(lane_start);
                continue;
            };
            query.matched.push(arch_id);
        }
        let stride = 4usize.saturating_add(view_count);
        let Ok(stride_word) = u32::try_from(stride) else {
            return Ok(());
        };
        query
            .table
            .extend_from_slice(&[0, self.generation, stride_word, 0]);
        let matched = query.matched.len();
        let mut chunk_count = 0u32;
        let mut awake_total = 0u32;
        for cursor in 0..matched {
            let Some(arch_id) = query.matched.get(cursor).copied() else {
                continue;
            };
            query.scratch.clear();
            if let Some(arch) = self.archetypes.get(arch_id as usize) {
                query.scratch.extend_from_slice(&arch.chunks);
            }
            let chunks = query.scratch.len();
            for chunk_cursor in 0..chunks {
                let Some(chunk_id) = query.scratch.get(chunk_cursor).copied() else {
                    continue;
                };
                let awake = self.listed_awake(chunk_id)?;
                if awake == 0 {
                    continue;
                }
                let awake_word = u32::from(awake);
                let index_ptr = self.entity_index_ptr(chunk_id).unwrap_or(0);
                let generation_ptr = self.entity_generation_ptr(chunk_id).unwrap_or(0);
                query.table.push(chunk_id);
                query.table.push(awake_word);
                query.table.push(ptr_word(index_ptr));
                query.table.push(ptr_word(generation_ptr));
                let base = cursor.saturating_mul(view_count);
                for lane_cursor in 0..view_count {
                    let lane = usize::from(
                        query
                            .lane_at
                            .get(base.saturating_add(lane_cursor))
                            .copied()
                            .unwrap_or(0),
                    );
                    let ptr = self.lane_ptr(chunk_id, lane).unwrap_or(0);
                    query.table.push(ptr_word(ptr));
                }
                chunk_count = chunk_count.saturating_add(1);
                awake_total = awake_total.saturating_add(awake_word);
            }
        }
        if let Some(slot) = query.table.get_mut(0) {
            *slot = chunk_count;
        }
        if let Some(slot) = query.table.get_mut(3) {
            *slot = awake_total;
        }
        Ok(())
    }

    fn arch_has_types(&self, arch: usize, types: &[u32]) -> bool {
        types.iter().all(|type_id| self.arch_has(arch, *type_id))
    }

    fn check_index(&self, index: u32) -> Result<(), CoreError> {
        if index >= self.max_entities {
            Err(CoreError::InvalidMaxEntities {
                value: index,
                max: self.max_entities,
            })
        } else {
            Ok(())
        }
    }

    fn generation_matches(&self, index: u32, generation: u32) -> bool {
        match self.slots.get(index as usize) {
            Some(slot) => slot.generation == generation,
            None => false,
        }
    }

    fn bump(&mut self) {
        self.generation = self.generation.wrapping_add(1);
    }

    fn row_of(&self, index: u32) -> Result<Option<(u32, u16, usize)>, CoreError> {
        let Some(slot) = self.slots.get(index as usize) else {
            return Ok(None);
        };
        if slot.chunk == NO_CHUNK {
            return Ok(None);
        }
        let Some(chunk) = self.chunk_ref(slot.chunk) else {
            return Err(inconsistent(1));
        };
        Ok(Some((slot.chunk, slot.row, chunk.archetype as usize)))
    }

    fn row_has_type(&self, index: u32, type_id: u32) -> Result<bool, CoreError> {
        match self.row_of(index)? {
            Some((_, _, arch)) => Ok(self.arch_has(arch, type_id)),
            None => Ok(false),
        }
    }

    fn plan_add(
        &self,
        index: u32,
        type_id: u32,
        target: &mut [u32; TYPE_SLOTS],
    ) -> Result<AddPlan, CoreError> {
        let Some((chunk_id, row, arch)) = self.row_of(index)? else {
            let Some(slot) = target.first_mut() else {
                return Err(CoreError::ComponentTypeLimitReached {
                    max: MAX_COMPONENT_TYPES,
                });
            };
            *slot = type_id;
            return Ok(AddPlan {
                count: 1,
                dormant: false,
                source: None,
            });
        };
        let dormant = match self.row_is_dormant(chunk_id, row)? {
            Some(dormant) => dormant,
            // The chunk was live in `row_of`. Kept.
            None => {
                return Ok(AddPlan {
                    count: 0,
                    dormant: false,
                    source: None,
                });
            }
        };
        let count = {
            let Some(current) = self.archetypes.get(arch).map(|item| &item.types) else {
                return Err(inconsistent(17));
            };
            match insert_sorted(current, type_id, target) {
                Some(count) => count,
                None => {
                    return Err(CoreError::ComponentTypeLimitReached {
                        max: MAX_COMPONENT_TYPES,
                    });
                }
            }
        };
        Ok(AddPlan {
            count,
            dormant,
            source: Some(RowAt {
                arch,
                chunk: chunk_id,
                row,
            }),
        })
    }

    /// Moves one entity onto `dest`.
    ///
    /// The source row and the fresh bytes are checked before [`Self::reserve`].
    /// `false` before the reserve reserves nothing. `false` after the reserve
    /// would mean a copy, a write, the entity assign, the awake swap, or the
    /// source fill failed. Those later failures need a lane or a chunk to
    /// disappear after the checks, which this call does not do. The
    /// destination archetype is not the source archetype, so the reserve does
    /// not change the source row.
    fn migrate(
        &mut self,
        index: u32,
        generation: u32,
        dest: usize,
        dormant: bool,
        source: Option<RowAt>,
        fresh: Option<(u32, &[u8])>,
    ) -> bool {
        if let Some(src) = source {
            if src.arch == dest || !self.can_fill(src.arch, src.chunk, src.row) {
                return false;
            }
        }
        if let Some((type_id, data)) = fresh {
            if !self.type_fits(dest, type_id, data) {
                return false;
            }
        }
        let Some(reserved) = self.reserve(dest, dormant) else {
            return false;
        };
        let dest_row = RowAt {
            arch: dest,
            chunk: reserved.chunk_id,
            row: reserved.row,
        };
        if let Some(src) = source {
            if !self.copy_intersection(src, dest_row) {
                return false;
            }
        }
        if let Some((type_id, data)) = fresh {
            if !self.write_type(dest, reserved.chunk_id, reserved.row, type_id, data) {
                return false;
            }
        }
        if !self.assign(reserved.chunk_id, reserved.row, index, generation) {
            return false;
        }
        if !self.finish(reserved) {
            return false;
        }
        if let Some(src) = source {
            // After the reserve. A later miss stays `false`.
            if !matches!(self.fill_hole(src.arch, src.chunk, src.row), Ok(true)) {
                return false;
            }
        }
        true
    }

    fn write_in_place(&mut self, index: u32, type_id: u32, data: &[u8]) -> Result<(), CoreError> {
        // `row_has_type` just found this row. A second miss is not a separate site.
        if let Some((chunk_id, row, arch)) = self.row_of(index)? {
            if !self.write_type(arch, chunk_id, row, type_id, data) {
                return Err(inconsistent(18));
            }
        }
        Ok(())
    }

    fn mask_of(&self, types: &[u32]) -> Option<BitSet128> {
        let mut mask = BitSet128::new();
        for type_id in types {
            let bit = self.layouts.get(*type_id as usize)?.bit;
            if !mask.set(bit) {
                return None;
            }
        }
        Some(mask)
    }

    fn find_archetype(&self, mask: BitSet128) -> Option<usize> {
        self.archetypes.iter().position(|arch| arch.mask == mask)
    }

    fn arch_has(&self, arch: usize, type_id: u32) -> bool {
        self.archetypes
            .get(arch)
            .is_some_and(|arch| arch.types.binary_search(&type_id).is_ok())
    }

    fn create_archetype(&mut self, mask: BitSet128, types: &[u32]) -> Option<usize> {
        if self.archetypes.len() >= MAX_ARCHETYPES as usize {
            return None;
        }
        let mut lane_sizes = Vec::new();
        let mut lane_at = Vec::new();
        for type_id in types {
            let layout = self.layouts.get(*type_id as usize)?;
            let start = u16::try_from(lane_sizes.len()).ok()?;
            lane_at.push(start);
            for lane in &layout.lanes {
                let size = lane_size(lane.0)?;
                lane_sizes.push(u8::try_from(size).ok()?);
            }
        }
        let mut stored = Vec::new();
        stored.extend_from_slice(types);
        let id = u32::try_from(self.archetypes.len()).ok()?;
        self.archetypes.push(Archetype {
            id,
            mask,
            types: stored,
            lane_at,
            lane_sizes,
            chunks: Vec::new(),
        });
        Some(self.archetypes.len() - 1)
    }

    fn lane_range(&self, arch: usize, type_id: u32) -> Option<(usize, usize)> {
        let archetype = self.archetypes.get(arch)?;
        let pos = archetype.types.binary_search(&type_id).ok()?;
        let start = usize::from(*archetype.lane_at.get(pos)?);
        let width = self.layouts.get(type_id as usize)?.lanes.len();
        Some((start, start + width))
    }

    fn chunk_ref(&self, id: u32) -> Option<&Chunk> {
        self.chunks.get(id as usize)?.data.as_ref()
    }

    fn chunk_mut(&mut self, id: u32) -> Option<&mut Chunk> {
        self.chunks.get_mut(id as usize)?.data.as_mut()
    }

    fn make_chunk(&self, arch_index: usize) -> Option<Chunk> {
        let archetype = self.archetypes.get(arch_index)?;
        let mut lanes = Vec::new();
        for size in &archetype.lane_sizes {
            lanes.push(LaneBuf::allocate(usize::from(*size))?);
        }
        let archetype_id = u32::try_from(arch_index).ok()?;
        Some(Chunk {
            archetype: archetype_id,
            len: 0,
            awake: 0,
            entity_index: vec![0; CHUNK_ROWS],
            entity_generation: vec![0; CHUNK_ROWS],
            lanes,
        })
    }

    fn alloc_chunk(&mut self, arch_index: usize) -> Option<u32> {
        let data = self.make_chunk(arch_index)?;
        let id = if let Some(id) = self.free_chunks.pop() {
            self.chunks.get_mut(id as usize)?.data = Some(data);
            id
        } else {
            let id = u32::try_from(self.chunks.len()).ok()?;
            self.chunks.push(ChunkSlot { data: Some(data) });
            id
        };
        self.archetypes.get_mut(arch_index)?.chunks.push(id);
        Some(id)
    }

    fn free_chunk(&mut self, id: u32) {
        if let Some(slot) = self.chunks.get_mut(id as usize) {
            slot.data = None;
        }
        self.free_chunks.push(id);
    }

    fn ensure_room(&mut self, arch_index: usize) -> bool {
        let needs_new = match self.archetypes.get(arch_index) {
            None => true,
            Some(arch) => {
                let mut room = false;
                for id in &arch.chunks {
                    let Some(slot) = self.chunks.get(*id as usize) else {
                        continue;
                    };
                    let Some(chunk) = slot.data.as_ref() else {
                        continue;
                    };
                    if (chunk.len as usize) < CHUNK_ROWS {
                        room = true;
                        break;
                    }
                }
                !room
            }
        };
        if needs_new {
            self.alloc_chunk(arch_index).is_some()
        } else {
            true
        }
    }

    /// Chunk that should receive the next row: a partial live chunk, or the
    /// empty chunk kept for this archetype.
    fn append_chunk_id(&self, arch_index: usize) -> Option<u32> {
        let arch = self.archetypes.get(arch_index)?;
        let mut partial = None;
        let mut spare = None;
        for id in &arch.chunks {
            let Some(slot) = self.chunks.get(*id as usize) else {
                continue;
            };
            let Some(chunk) = slot.data.as_ref() else {
                continue;
            };
            if chunk.len == 0 {
                if spare.is_none() {
                    spare = Some(*id);
                }
            } else if (chunk.len as usize) < CHUNK_ROWS {
                partial = Some(*id);
            }
        }
        partial.or(spare)
    }

    fn reserve(&mut self, arch_index: usize, dormant: bool) -> Option<Reserved> {
        if !self.ensure_room(arch_index) {
            return None;
        }
        let chunk_id = self.append_chunk_id(arch_index)?;
        let chunk = self.chunk_mut(chunk_id)?;
        if chunk.len as usize >= CHUNK_ROWS {
            return None;
        }
        let row = chunk.len;
        chunk.len = chunk.len.saturating_add(1);
        if dormant {
            Some(Reserved {
                chunk_id,
                row,
                swap_with: None,
            })
        } else if chunk.awake == row {
            chunk.awake = chunk.awake.saturating_add(1);
            Some(Reserved {
                chunk_id,
                row,
                swap_with: None,
            })
        } else {
            Some(Reserved {
                chunk_id,
                row,
                swap_with: Some(chunk.awake),
            })
        }
    }

    fn finish(&mut self, reserved: Reserved) -> bool {
        let Some(boundary) = reserved.swap_with else {
            return true;
        };
        if !self.swap_rows(reserved.chunk_id, reserved.row, boundary) {
            return false;
        }
        let Some(chunk) = self.chunk_mut(reserved.chunk_id) else {
            return false;
        };
        chunk.awake = chunk.awake.saturating_add(1);
        true
    }

    fn assign(&mut self, chunk_id: u32, row: u16, entity: u32, generation: u32) -> bool {
        let wrote = {
            let Some(chunk) = self.chunk_mut(chunk_id) else {
                return false;
            };
            let Some(slot) = chunk.entity_index.get_mut(row as usize) else {
                return false;
            };
            *slot = entity;
            let Some(slot) = chunk.entity_generation.get_mut(row as usize) else {
                return false;
            };
            *slot = generation;
            true
        };
        wrote && self.note(entity, chunk_id, row)
    }

    fn note(&mut self, entity: u32, chunk_id: u32, row: u16) -> bool {
        let Some(slot) = self.slots.get_mut(entity as usize) else {
            return false;
        };
        slot.chunk = chunk_id;
        slot.row = row;
        true
    }

    fn clear_loc(&mut self, entity: u32) -> bool {
        let Some(slot) = self.slots.get_mut(entity as usize) else {
            return false;
        };
        slot.chunk = NO_CHUNK;
        slot.row = 0;
        true
    }

    fn row_is_dormant(&self, chunk_id: u32, row: u16) -> Result<Option<bool>, CoreError> {
        let Some(chunk) = self.chunk_ref(chunk_id) else {
            // `row_of` or `last_live` already required this chunk. Kept.
            return Ok(None);
        };
        if chunk.awake > chunk.len {
            return Err(inconsistent(16));
        }
        if row >= chunk.len {
            return Err(inconsistent(15));
        }
        Ok(Some(row >= chunk.awake))
    }

    fn copy_intersection(&mut self, src: RowAt, dst: RowAt) -> bool {
        let mut ids = [0u32; TYPE_SLOTS];
        let count = {
            let Some(arch) = self.archetypes.get(src.arch) else {
                return false;
            };
            if arch.types.len() > TYPE_SLOTS {
                return false;
            }
            let Some(copied) = ids.get_mut(..arch.types.len()) else {
                return false;
            };
            copied.copy_from_slice(&arch.types);
            arch.types.len()
        };
        for type_id in ids.iter().take(count).copied() {
            if self.arch_has(dst.arch, type_id) && !self.copy_type(src, dst, type_id) {
                return false;
            }
        }
        true
    }

    fn copy_type(&mut self, src: RowAt, dst: RowAt, type_id: u32) -> bool {
        let Some((src_start, src_end)) = self.lane_range(src.arch, type_id) else {
            return false;
        };
        let Some((dst_start, _)) = self.lane_range(dst.arch, type_id) else {
            return false;
        };
        let count = src_end.saturating_sub(src_start);
        for offset in 0..count {
            let Some(cell) = self.read_cell(src.chunk, src_start + offset, src.row) else {
                return false;
            };
            if !self.write_cell(dst.chunk, dst_start + offset, dst.row, &cell) {
                return false;
            }
        }
        true
    }

    fn write_type(
        &mut self,
        arch: usize,
        chunk_id: u32,
        row: u16,
        type_id: u32,
        data: &[u8],
    ) -> bool {
        let Some((start, end)) = self.lane_range(arch, type_id) else {
            return false;
        };
        let mut offset = 0usize;
        for lane in start..end {
            let Some(size) = self
                .archetypes
                .get(arch)
                .and_then(|item| item.lane_sizes.get(lane))
                .map(|size| usize::from(*size))
            else {
                return false;
            };
            let Some(next) = offset.checked_add(size) else {
                return false;
            };
            let Some(src) = data.get(offset..next) else {
                return false;
            };
            let mut cell = [0u8; 8];
            let Some(dst) = cell.get_mut(..size) else {
                return false;
            };
            dst.copy_from_slice(src);
            if !self.write_cell(chunk_id, lane, row, &cell) {
                return false;
            }
            offset = next;
        }
        offset == data.len()
    }

    fn read_cell(&self, chunk_id: u32, lane: usize, row: u16) -> Option<[u8; 8]> {
        let chunk = self.chunk_ref(chunk_id)?;
        let lane = chunk.lanes.get(lane)?;
        let size = lane.lane_size;
        if size > 8 {
            return None;
        }
        let start = usize::from(row).checked_mul(size)?;
        let end = start.checked_add(size)?;
        let bytes = lane.bytes()?;
        let src = bytes.get(start..end)?;
        let mut cell = [0u8; 8];
        cell.get_mut(..size)?.copy_from_slice(src);
        Some(cell)
    }

    fn write_cell(&mut self, chunk_id: u32, lane: usize, row: u16, cell: &[u8; 8]) -> bool {
        let Some(chunk) = self.chunk_mut(chunk_id) else {
            return false;
        };
        let Some(lane) = chunk.lanes.get_mut(lane) else {
            return false;
        };
        let size = lane.lane_size;
        if size > 8 {
            return false;
        }
        let start = match usize::from(row).checked_mul(size) {
            Some(start) => start,
            None => return false,
        };
        let end = match start.checked_add(size) {
            Some(end) => end,
            None => return false,
        };
        let Some(bytes) = lane.bytes_mut() else {
            return false;
        };
        let Some(dst) = bytes.get_mut(start..end) else {
            return false;
        };
        let Some(src) = cell.get(..size) else {
            return false;
        };
        dst.copy_from_slice(src);
        true
    }

    fn swap_rows(&mut self, chunk_id: u32, a: u16, b: u16) -> bool {
        if a == b {
            return true;
        }
        let lane_count = match self.chunk_ref(chunk_id) {
            Some(chunk) => chunk.lanes.len(),
            None => return false,
        };
        for lane in 0..lane_count {
            let Some(left) = self.read_cell(chunk_id, lane, a) else {
                return false;
            };
            let Some(right) = self.read_cell(chunk_id, lane, b) else {
                return false;
            };
            if !self.write_cell(chunk_id, lane, a, &right)
                || !self.write_cell(chunk_id, lane, b, &left)
            {
                return false;
            }
        }
        let (entity_a, entity_b) = {
            let Some(chunk) = self.chunk_mut(chunk_id) else {
                return false;
            };
            let Some(index_a) = chunk.entity_index.get(a as usize).copied() else {
                return false;
            };
            let Some(index_b) = chunk.entity_index.get(b as usize).copied() else {
                return false;
            };
            let Some(generation_a) = chunk.entity_generation.get(a as usize).copied() else {
                return false;
            };
            let Some(generation_b) = chunk.entity_generation.get(b as usize).copied() else {
                return false;
            };
            if let Some(slot) = chunk.entity_index.get_mut(a as usize) {
                *slot = index_b;
            } else {
                return false;
            }
            if let Some(slot) = chunk.entity_index.get_mut(b as usize) {
                *slot = index_a;
            } else {
                return false;
            }
            if let Some(slot) = chunk.entity_generation.get_mut(a as usize) {
                *slot = generation_b;
            } else {
                return false;
            }
            if let Some(slot) = chunk.entity_generation.get_mut(b as usize) {
                *slot = generation_a;
            } else {
                return false;
            }
            (index_a, index_b)
        };
        self.note(entity_a, chunk_id, b) && self.note(entity_b, chunk_id, a)
    }

    fn move_row(&mut self, src: u32, src_row: u16, dst: u32, dst_row: u16) -> bool {
        let lane_count = match self.chunk_ref(src) {
            Some(chunk) => chunk.lanes.len(),
            None => return false,
        };
        for lane in 0..lane_count {
            let Some(cell) = self.read_cell(src, lane, src_row) else {
                return false;
            };
            if !self.write_cell(dst, lane, dst_row, &cell) {
                return false;
            }
        }
        let (entity, generation) = {
            let Some(chunk) = self.chunk_ref(src) else {
                return false;
            };
            let Some(entity) = chunk.entity_index.get(src_row as usize).copied() else {
                return false;
            };
            let Some(generation) = chunk.entity_generation.get(src_row as usize).copied() else {
                return false;
            };
            (entity, generation)
        };
        let wrote = {
            let Some(chunk) = self.chunk_mut(dst) else {
                return false;
            };
            let Some(slot) = chunk.entity_index.get_mut(dst_row as usize) else {
                return false;
            };
            *slot = entity;
            let Some(slot) = chunk.entity_generation.get_mut(dst_row as usize) else {
                return false;
            };
            *slot = generation;
            true
        };
        wrote && self.note(entity, dst, dst_row)
    }

    fn can_fill(&self, arch_index: usize, chunk_id: u32, row: u16) -> bool {
        let Some(chunk) = self.chunk_ref(chunk_id) else {
            return false;
        };
        if chunk.archetype as usize != arch_index {
            return false;
        }
        if usize::from(row) >= usize::from(chunk.len) {
            return false;
        }
        self.last_live(arch_index).is_some()
    }

    fn type_fits(&self, arch_index: usize, type_id: u32, data: &[u8]) -> bool {
        if !self.arch_has(arch_index, type_id) {
            return false;
        }
        match self.layouts.get(type_id as usize) {
            Some(layout) => data.len() == usize::from(layout.row_bytes),
            None => false,
        }
    }

    fn last_live(&self, arch_index: usize) -> Option<(u32, u16)> {
        let arch = self.archetypes.get(arch_index)?;
        for id in arch.chunks.iter().rev() {
            let slot = self.chunks.get(*id as usize)?;
            let chunk = slot.data.as_ref()?;
            if chunk.len > 0 {
                return Some((*id, chunk.len - 1));
            }
        }
        None
    }

    fn keeps_another_empty(&self, arch_index: usize, chunk_id: u32) -> bool {
        let Some(arch) = self.archetypes.get(arch_index) else {
            return false;
        };
        arch.chunks.iter().any(|&id| {
            id != chunk_id
                && self
                    .chunks
                    .get(id as usize)
                    .and_then(|slot| slot.data.as_ref())
                    .is_some_and(|chunk| chunk.len == 0)
        })
    }

    fn last_row(&self, arch_index: usize) -> Option<(u32, u16)> {
        self.last_live(arch_index)
    }

    fn fill_hole(&mut self, arch_index: usize, chunk_id: u32, row: u16) -> Result<bool, CoreError> {
        let Some((last_chunk, last_row)) = self.last_row(arch_index) else {
            return Ok(false);
        };
        if last_chunk == chunk_id && last_row == row {
            return Ok(self.pop_last(arch_index));
        }
        let was_dormant = match self.row_is_dormant(last_chunk, last_row)? {
            Some(value) => value,
            // The last live row's chunk was just read. Kept.
            None => return Ok(false),
        };
        if !self.move_row(last_chunk, last_row, chunk_id, row) {
            return Ok(false);
        }
        if !self.pop_last(arch_index) {
            return Ok(false);
        }
        Ok(self.repair(chunk_id, row, was_dormant))
    }

    fn pop_last(&mut self, arch_index: usize) -> bool {
        let Some((chunk_id, _)) = self.last_live(arch_index) else {
            return false;
        };
        let now_empty = {
            let Some(chunk) = self.chunk_mut(chunk_id) else {
                return false;
            };
            if chunk.len == 0 {
                return false;
            }
            let last = chunk.len - 1;
            let was_awake = last < chunk.awake;
            chunk.len -= 1;
            if was_awake {
                chunk.awake -= 1;
            }
            chunk.len == 0
        };
        if now_empty && self.keeps_another_empty(arch_index, chunk_id) {
            if let Some(arch) = self.archetypes.get_mut(arch_index) {
                if let Some(pos) = arch.chunks.iter().position(|id| *id == chunk_id) {
                    arch.chunks.remove(pos);
                }
            }
            self.free_chunk(chunk_id);
        }
        true
    }

    fn repair(&mut self, chunk_id: u32, row: u16, was_dormant: bool) -> bool {
        let Some(awake) = self.chunk_ref(chunk_id).map(|chunk| chunk.awake) else {
            return false;
        };
        let in_awake = row < awake;
        if was_dormant && in_awake {
            if awake == 0 {
                return false;
            }
            if !self.swap_rows(chunk_id, row, awake - 1) {
                return false;
            }
            let Some(chunk) = self.chunk_mut(chunk_id) else {
                return false;
            };
            chunk.awake -= 1;
            return true;
        }
        if !was_dormant && !in_awake {
            if !self.swap_rows(chunk_id, row, awake) {
                return false;
            }
            let Some(chunk) = self.chunk_mut(chunk_id) else {
                return false;
            };
            chunk.awake = chunk.awake.saturating_add(1);
        }
        true
    }
}

#[cfg(test)]
impl ChunkStore {
    /// Test-only. A consistent store never builds these states.
    pub fn corrupt_slot_chunk_for_test(&mut self, index: u32, chunk: u32) -> bool {
        let Some(slot) = self.slots.get_mut(index as usize) else {
            return false;
        };
        slot.chunk = chunk;
        true
    }

    /// Test-only. Points the slot at a row past `len`.
    pub fn corrupt_slot_row_for_test(&mut self, index: u32, row: u16) -> bool {
        let Some(slot) = self.slots.get_mut(index as usize) else {
            return false;
        };
        slot.row = row;
        true
    }

    /// Test-only. Sets `awake` without moving rows.
    pub fn corrupt_awake_for_test(&mut self, chunk: u32, awake: u16) -> bool {
        let Some(data) = self
            .chunks
            .get_mut(chunk as usize)
            .and_then(|slot| slot.data.as_mut())
        else {
            return false;
        };
        data.awake = awake;
        true
    }

    /// Test-only. Drops lane buffers and leaves the archetype record.
    pub fn corrupt_clear_lanes_for_test(&mut self, chunk: u32) -> bool {
        let Some(data) = self
            .chunks
            .get_mut(chunk as usize)
            .and_then(|slot| slot.data.as_mut())
        else {
            return false;
        };
        data.lanes.clear();
        true
    }

    /// Test-only. Writes an entity index that has no slot.
    pub fn corrupt_row_entity_for_test(&mut self, chunk: u32, row: u16, entity: u32) -> bool {
        let Some(data) = self
            .chunks
            .get_mut(chunk as usize)
            .and_then(|slot| slot.data.as_mut())
        else {
            return false;
        };
        let Some(slot) = data.entity_index.get_mut(row as usize) else {
            return false;
        };
        *slot = entity;
        true
    }

    /// Test-only. Points the chunk at an archetype id that is not in the table.
    pub fn corrupt_chunk_archetype_for_test(&mut self, chunk: u32, archetype: u32) -> bool {
        let Some(data) = self
            .chunks
            .get_mut(chunk as usize)
            .and_then(|slot| slot.data.as_mut())
        else {
            return false;
        };
        data.archetype = archetype;
        true
    }

    /// Test-only. Drops the chunk body. The archetype still lists the id.
    pub fn corrupt_drop_chunk_for_test(&mut self, chunk: u32) -> bool {
        let Some(slot) = self.chunks.get_mut(chunk as usize) else {
            return false;
        };
        if slot.data.is_none() {
            return false;
        }
        slot.data = None;
        true
    }
}

fn insert_sorted(current: &[u32], type_id: u32, out: &mut [u32; TYPE_SLOTS]) -> Option<usize> {
    if current.len() >= TYPE_SLOTS {
        return None;
    }
    let mut count = 0usize;
    let mut placed = false;
    for id in current {
        if !placed && type_id < *id {
            *out.get_mut(count)? = type_id;
            count += 1;
            placed = true;
        }
        *out.get_mut(count)? = *id;
        count += 1;
    }
    if !placed {
        *out.get_mut(count)? = type_id;
        count += 1;
    }
    Some(count)
}

fn remove_sorted(current: &[u32], type_id: u32, out: &mut [u32; TYPE_SLOTS]) -> Option<usize> {
    let mut count = 0usize;
    let mut found = false;
    for id in current {
        if *id == type_id {
            found = true;
            continue;
        }
        *out.get_mut(count)? = *id;
        count += 1;
    }
    if found {
        Some(count)
    } else {
        None
    }
}

#[cfg(test)]
mod storage_inconsistent {
    use super::ChunkStore;
    use crate::CoreError;

    fn open() -> Result<ChunkStore, CoreError> {
        ChunkStore::new(8)
    }

    fn kind(store: &mut ChunkStore) -> Result<u32, CoreError> {
        store.register(&[0])
    }

    fn chunk_at(store: &ChunkStore, index: u32) -> u32 {
        match store.location(index) {
            Some(loc) => loc.chunk,
            None => u32::MAX,
        }
    }

    fn row_at(store: &ChunkStore, index: u32) -> u16 {
        match store.location(index) {
            Some(loc) => loc.row,
            None => u16::MAX,
        }
    }

    fn site(site: u32) -> CoreError {
        CoreError::StorageInconsistent { site }
    }

    #[cfg(test)]
    mod tests {
        #[cfg(miri)]
        use super::{kind, open};
        #[cfg(miri)]
        use crate::CoreError;

        #[cfg(miri)]
        #[test]
        fn lane_ptr_load_reads_the_stored_bytes() -> Result<(), CoreError> {
            let mut store = open()?;
            let kind = kind(&mut store)?;
            assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
            let ptr = match store.lane_ptr(0, 0) {
                Some(ptr) => ptr,
                None => return Err(CoreError::StorageInconsistent { site: 0 }),
            };
            // SAFETY: `lane_ptr` is the address of this store's `Vec<u64>` lane.
            // Row 0 holds the four bytes just written, and a `u64` buffer is aligned for `u32`.
            let word = unsafe { (ptr as *const u32).read() };
            assert_eq!(word, u32::from_le_bytes([1, 2, 3, 4]));
            Ok(())
        }
    }

    #[test]
    fn site_1_slot_names_a_chunk_that_is_not_live() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        let chunk = chunk_at(&store, 0);
        assert_eq!(
            u8::from(store.corrupt_slot_chunk_for_test(0, chunk.wrapping_add(9))),
            1
        );
        assert_eq!(store.remove(0, 0, kind), Err(site(1)));
        Ok(())
    }

    #[test]
    fn site_2_dormancy_read_chunk_is_not_live() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        let chunk = chunk_at(&store, 0);
        assert_eq!(
            u8::from(store.corrupt_slot_chunk_for_test(0, chunk.wrapping_add(9))),
            1
        );
        assert_eq!(store.is_dormant(0, 0), Err(site(2)));
        Ok(())
    }

    #[test]
    fn site_3_dormancy_read_row_past_len() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(u8::from(store.corrupt_slot_row_for_test(0, 4_000)), 1);
        assert_eq!(store.is_dormant(0, 0), Err(site(3)));
        Ok(())
    }

    #[test]
    fn site_4_dormancy_read_awake_past_len() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        let chunk = chunk_at(&store, 0);
        let len = store.chunk_len(chunk).unwrap_or(0);
        assert_eq!(
            u8::from(store.corrupt_awake_for_test(chunk, len.saturating_add(1))),
            1
        );
        assert_eq!(store.is_dormant(0, 0), Err(site(4)));
        Ok(())
    }

    #[test]
    fn site_5_has_chunk_is_not_live() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        let chunk = chunk_at(&store, 0);
        assert_eq!(
            u8::from(store.corrupt_slot_chunk_for_test(0, chunk.wrapping_add(9))),
            1
        );
        assert_eq!(store.has(0, 0, kind), Err(site(5)));
        Ok(())
    }

    #[test]
    fn site_6_has_row_past_len() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(u8::from(store.corrupt_slot_row_for_test(0, 4_000)), 1);
        assert_eq!(store.has(0, 0, kind), Err(site(6)));
        Ok(())
    }

    #[test]
    fn site_7_has_awake_past_len() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        let chunk = chunk_at(&store, 0);
        let len = store.chunk_len(chunk).unwrap_or(0);
        assert_eq!(
            u8::from(store.corrupt_awake_for_test(chunk, len.saturating_add(1))),
            1
        );
        assert_eq!(store.has(0, 0, kind), Err(site(7)));
        Ok(())
    }

    #[test]
    fn site_8_copy_chunk_is_not_live() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        let chunk = chunk_at(&store, 0);
        assert_eq!(
            u8::from(store.corrupt_slot_chunk_for_test(0, chunk.wrapping_add(9))),
            1
        );
        let mut out = [0u8; 4];
        assert_eq!(store.copy_row(0, 0, kind, &mut out), Err(site(8)));
        Ok(())
    }

    #[test]
    fn site_9_copy_row_past_len() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(u8::from(store.corrupt_slot_row_for_test(0, 4_000)), 1);
        let mut out = [0u8; 4];
        assert_eq!(store.copy_row(0, 0, kind, &mut out), Err(site(9)));
        Ok(())
    }

    #[test]
    fn site_10_copy_awake_past_len() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        let chunk = chunk_at(&store, 0);
        let len = store.chunk_len(chunk).unwrap_or(0);
        assert_eq!(
            u8::from(store.corrupt_awake_for_test(chunk, len.saturating_add(1))),
            1
        );
        let mut out = [0u8; 4];
        assert_eq!(store.copy_row(0, 0, kind, &mut out), Err(site(10)));
        Ok(())
    }

    #[test]
    fn site_11_copy_lane_cell_is_absent() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(
            u8::from(store.corrupt_clear_lanes_for_test(chunk_at(&store, 0))),
            1
        );
        let mut out = [0u8; 4];
        assert_eq!(store.copy_row(0, 0, kind, &mut out), Err(site(11)));
        Ok(())
    }

    #[test]
    fn site_12_archetype_read_chunk_is_not_live() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        let chunk = chunk_at(&store, 0);
        assert_eq!(
            u8::from(store.corrupt_slot_chunk_for_test(0, chunk.wrapping_add(9))),
            1
        );
        assert_eq!(store.entity_archetype(0), Err(site(12)));
        Ok(())
    }

    #[test]
    fn site_13_delete_row_cannot_be_filled() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(u8::from(store.corrupt_slot_row_for_test(0, 4_000)), 1);
        assert_eq!(store.delete_entity(0, 0), Err(site(13)));
        Ok(())
    }

    #[test]
    fn site_14_remove_last_row_cannot_be_filled() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(u8::from(store.corrupt_slot_row_for_test(0, 4_000)), 1);
        assert_eq!(store.remove(0, 0, kind), Err(site(14)));
        Ok(())
    }

    #[test]
    fn site_15_live_row_past_len_on_remove() -> Result<(), CoreError> {
        let mut store = open()?;
        let first = kind(&mut store)?;
        let second = kind(&mut store)?;
        assert_eq!(store.add(0, 0, first, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(store.add(0, 0, second, &[5, 6, 7, 8]), Ok(true));
        assert_eq!(u8::from(store.corrupt_slot_row_for_test(0, 4_000)), 1);
        assert_eq!(store.remove(0, 0, first), Err(site(15)));
        Ok(())
    }

    #[test]
    fn site_16_live_row_awake_past_len_on_remove() -> Result<(), CoreError> {
        let mut store = open()?;
        let first = kind(&mut store)?;
        let second = kind(&mut store)?;
        assert_eq!(store.add(0, 0, first, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(store.add(0, 0, second, &[5, 6, 7, 8]), Ok(true));
        let chunk = chunk_at(&store, 0);
        let len = store.chunk_len(chunk).unwrap_or(0);
        assert_eq!(
            u8::from(store.corrupt_awake_for_test(chunk, len.saturating_add(1))),
            1
        );
        assert_eq!(store.remove(0, 0, first), Err(site(16)));
        Ok(())
    }

    #[test]
    fn site_17_add_archetype_record_is_absent() -> Result<(), CoreError> {
        let mut store = open()?;
        let first = kind(&mut store)?;
        let second = kind(&mut store)?;
        assert_eq!(store.add(0, 0, first, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(
            u8::from(store.corrupt_chunk_archetype_for_test(chunk_at(&store, 0), 999)),
            1
        );
        assert_eq!(store.add(0, 0, second, &[5, 6, 7, 8]), Err(site(17)));
        Ok(())
    }

    #[test]
    fn site_18_in_place_write_lane_is_absent() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(
            u8::from(store.corrupt_clear_lanes_for_test(chunk_at(&store, 0))),
            1
        );
        assert_eq!(store.add(0, 0, kind, &[9, 9, 9, 9]), Err(site(18)));
        Ok(())
    }

    #[test]
    fn site_19_set_dormant_row_past_len() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(u8::from(store.corrupt_slot_row_for_test(0, 4_000)), 1);
        assert_eq!(store.set_dormant(0, 0, true), Err(site(19)));
        Ok(())
    }

    #[test]
    fn site_20_set_dormant_awake_past_len() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        let chunk = chunk_at(&store, 0);
        let len = store.chunk_len(chunk).unwrap_or(0);
        assert_eq!(
            u8::from(store.corrupt_awake_for_test(chunk, len.saturating_add(1))),
            1
        );
        assert_eq!(store.set_dormant(0, 0, true), Err(site(20)));
        Ok(())
    }

    #[test]
    fn site_21_set_dormant_sleep_entity_has_no_slot() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(store.add(1, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(
            u8::from(store.corrupt_row_entity_for_test(
                chunk_at(&store, 0),
                row_at(&store, 0),
                u32::MAX
            )),
            1
        );
        assert_eq!(store.set_dormant(0, 0, true), Err(site(21)));
        Ok(())
    }

    #[test]
    fn site_21_set_dormant_wake_entity_has_no_slot() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(store.add(1, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(store.add(2, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(store.set_dormant(0, 0, true), Ok(true));
        assert_eq!(store.set_dormant(2, 0, true), Ok(true));
        assert_eq!(
            u8::from(store.corrupt_row_entity_for_test(
                chunk_at(&store, 0),
                row_at(&store, 0),
                u32::MAX
            )),
            1
        );
        assert_eq!(store.set_dormant(0, 0, false), Err(site(21)));
        Ok(())
    }

    #[test]
    fn site_22_listed_chunk_is_not_live() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        assert_eq!(
            u8::from(store.corrupt_drop_chunk_for_test(chunk_at(&store, 0))),
            1
        );
        assert_eq!(store.count_awake(&[kind]), Err(site(22)));
        Ok(())
    }

    #[test]
    fn site_23_listed_chunk_awake_past_len() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.add(0, 0, kind, &[1, 2, 3, 4]), Ok(true));
        let chunk = chunk_at(&store, 0);
        let len = store.chunk_len(chunk).unwrap_or(0);
        assert_eq!(
            u8::from(store.corrupt_awake_for_test(chunk, len.saturating_add(1))),
            1
        );
        assert_eq!(store.count_awake(&[kind]), Err(site(23)));
        Ok(())
    }

    #[test]
    fn dead_entity_stays_false() -> Result<(), CoreError> {
        let mut store = open()?;
        let kind = kind(&mut store)?;
        assert_eq!(store.remove(0, 1, kind), Ok(false));
        assert_eq!(store.is_dormant(0, 1), Ok(None));
        assert_eq!(store.has(0, 1, kind), Ok(false));
        assert_eq!(store.delete_entity(0, 1), Ok(false));
        Ok(())
    }
}
