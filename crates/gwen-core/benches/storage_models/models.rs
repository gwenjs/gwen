//! Bench-only storage models for ADR-0001.
//! Not part of the crate. Do not move this under `src/`.
//!
//! Link: internals-docs/adr/0001-component-storage.md

use gwen_core::{ArchetypeStorage, BitSet128, ComponentTypeId};

/// Entity counts of the reference scene. See ADR-0001.
pub const STORAGE_REFERENCE_SCENE: [usize; 2] = [1_000, 10_000];

pub const REFERENCE_FRAMES: u32 = 60;

/// Fixed frame delta used by every model.
pub const DT: f32 = 1.0 / 60.0;

const POS: u8 = 0b0001;
const VEL: u8 = 0b0010;
const HEALTH: u8 = 0b0100;
const ENEMY: u8 = 0b1000;

const POS_RAW: u32 = 1;
const VEL_RAW: u32 = 2;
const HEALTH_RAW: u32 = 3;
const ENEMY_RAW: u32 = 4;

pub fn structural_ops(entity_count: usize) -> usize {
    entity_count / 200
}

pub fn remove_entity(entity_count: usize, frame: u32, k: usize) -> u32 {
    let step = frame as usize * structural_ops(entity_count) + k;
    ((step * 2) % entity_count) as u32
}

pub fn add_entity(entity_count: usize, frame: u32, k: usize) -> u32 {
    let step = frame as usize * structural_ops(entity_count) + k;
    ((step * 2 + 1) % entity_count) as u32
}

fn initial_position(entity: u32) -> [f32; 2] {
    let i = entity as f32;
    [i, i * 0.5]
}

fn initial_velocity(entity: u32) -> [f32; 2] {
    let i = entity as f32;
    [1.0, i * 0.01]
}

fn initial_health(entity: u32) -> [f32; 2] {
    [entity as f32, 100.0]
}

fn spawned_health() -> [f32; 2] {
    [0.0, 100.0]
}

fn write_pair(pair: [f32; 2]) -> [u8; 8] {
    let mut out = [0u8; 8];
    out[..4].copy_from_slice(&pair[0].to_le_bytes());
    out[4..].copy_from_slice(&pair[1].to_le_bytes());
    out
}

fn read_f32(data: &[u8], offset: usize) -> f32 {
    let mut buf = [0u8; 4];
    let end = offset + 4;
    if end > data.len() {
        return 0.0;
    }
    buf.copy_from_slice(&data[offset..end]);
    f32::from_le_bytes(buf)
}

fn write_f32(data: &mut [u8], offset: usize, value: f32) {
    let end = offset + 4;
    if end > data.len() {
        return;
    }
    data[offset..end].copy_from_slice(&value.to_le_bytes());
}

fn read_pair(data: &[u8], offset: usize) -> [f32; 2] {
    [read_f32(data, offset), read_f32(data, offset + 4)]
}

pub trait StorageModel {
    fn entity_count(&self) -> usize;
    fn movement(&mut self, dt: f32);
    fn regen(&mut self, dt: f32);
    fn add_health(&mut self, entity: u32);
    fn remove_health(&mut self, entity: u32);
    fn heap_bytes(&self) -> usize;
    fn position(&self, entity: u32) -> [f32; 2];
    fn velocity(&self, entity: u32) -> [f32; 2];
    fn health(&self, entity: u32) -> Option<[f32; 2]>;
    fn has_enemy(&self, entity: u32) -> bool;
}

pub fn run_frame(model: &mut impl StorageModel, frame: u32, dt: f32) {
    model.movement(dt);
    model.regen(dt);
    let count = structural_ops(model.entity_count());
    for k in 0..count {
        model.remove_health(remove_entity(model.entity_count(), frame, k));
        model.add_health(add_entity(model.entity_count(), frame, k));
    }
}

fn pos_id() -> ComponentTypeId {
    ComponentTypeId::from_raw(POS_RAW)
}

fn vel_id() -> ComponentTypeId {
    ComponentTypeId::from_raw(VEL_RAW)
}

fn health_id() -> ComponentTypeId {
    ComponentTypeId::from_raw(HEALTH_RAW)
}

fn enemy_id() -> ComponentTypeId {
    ComponentTypeId::from_raw(ENEMY_RAW)
}

/// Production `ArchetypeStorage` with `register_raw(id, 8)` and HashMap migration.
///
/// Column buffers are `pub(crate)`, so iteration uses the public per-entity API.
/// `heap_bytes` is component payload plus entity-id slots, not `Vec` capacity
/// or the private index maps.
pub struct ModelAProd {
    entity_count: usize,
    storage: ArchetypeStorage,
}

impl ModelAProd {
    pub fn build(entity_count: usize) -> Self {
        let mut storage = ArchetypeStorage::new();
        storage.register_raw(pos_id(), 8);
        storage.register_raw(vel_id(), 8);
        storage.register_raw(health_id(), 8);
        storage.register_raw(enemy_id(), 0);
        for entity in 0..entity_count as u32 {
            let pos = write_pair(initial_position(entity));
            let vel = write_pair(initial_velocity(entity));
            let _ = storage.add_component(entity, pos_id(), &pos);
            let _ = storage.add_component(entity, vel_id(), &vel);
            if entity % 2 == 0 {
                let health = write_pair(initial_health(entity));
                let _ = storage.add_component(entity, health_id(), &health);
            }
            if entity % 4 == 0 {
                let _ = storage.add_component(entity, enemy_id(), &[]);
            }
        }
        Self {
            entity_count,
            storage,
        }
    }
}

impl StorageModel for ModelAProd {
    fn entity_count(&self) -> usize {
        self.entity_count
    }

    fn movement(&mut self, dt: f32) {
        for entity in 0..self.entity_count as u32 {
            let vel = match self.storage.get_component(entity, vel_id()) {
                Some(bytes) if bytes.len() >= 8 => read_pair(bytes, 0),
                _ => continue,
            };
            let Some(pos) = self.storage.get_component_mut(entity, pos_id()) else {
                continue;
            };
            if pos.len() < 8 {
                continue;
            }
            let x = read_f32(pos, 0) + vel[0] * dt;
            let y = read_f32(pos, 4) + vel[1] * dt;
            write_f32(pos, 0, x);
            write_f32(pos, 4, y);
        }
    }

    fn regen(&mut self, dt: f32) {
        for entity in 0..self.entity_count as u32 {
            let Some(bytes) = self.storage.get_component_mut(entity, health_id()) else {
                continue;
            };
            if bytes.len() < 8 {
                continue;
            }
            let current = read_f32(bytes, 0) + dt;
            write_f32(bytes, 0, current);
        }
    }

    fn add_health(&mut self, entity: u32) {
        if self.storage.has_component(entity, health_id()) {
            return;
        }
        let bytes = write_pair(spawned_health());
        let _ = self.storage.add_component(entity, health_id(), &bytes);
    }

    fn remove_health(&mut self, entity: u32) {
        let _ = self.storage.remove_component(entity, health_id());
    }

    fn heap_bytes(&self) -> usize {
        let mut total = 0usize;
        for id in self.storage.archetypes_matching(BitSet128::new()) {
            let arch = self.storage.archetype(id);
            let rows = arch.len();
            if rows == 0 {
                continue;
            }
            for type_id in arch.component_types() {
                if let Some(bytes) = arch.get_component(0, *type_id) {
                    total += bytes.len() * rows;
                }
            }
            total += rows * std::mem::size_of::<u32>();
        }
        total
    }

    fn position(&self, entity: u32) -> [f32; 2] {
        match self.storage.get_component(entity, pos_id()) {
            Some(bytes) if bytes.len() >= 8 => read_pair(bytes, 0),
            _ => [0.0, 0.0],
        }
    }

    fn velocity(&self, entity: u32) -> [f32; 2] {
        match self.storage.get_component(entity, vel_id()) {
            Some(bytes) if bytes.len() >= 8 => read_pair(bytes, 0),
            _ => [0.0, 0.0],
        }
    }

    fn health(&self, entity: u32) -> Option<[f32; 2]> {
        self.storage
            .get_component(entity, health_id())
            .filter(|bytes| bytes.len() >= 8)
            .map(|bytes| read_pair(bytes, 0))
    }

    fn has_enemy(&self, entity: u32) -> bool {
        self.storage.has_component(entity, enemy_id())
    }
}

struct Column {
    type_id: u8,
    data: Vec<u8>,
}

struct DirectArch {
    mask: u8,
    pos_col: Option<usize>,
    vel_col: Option<usize>,
    health_col: Option<usize>,
    entities: Vec<u32>,
    columns: Vec<Column>,
}

struct Kept {
    pos: Option<[u8; 8]>,
    vel: Option<[u8; 8]>,
    health: Option<[u8; 8]>,
}

impl DirectArch {
    fn new(mask: u8) -> Self {
        let mut columns = Vec::new();
        let mut pos_col = None;
        let mut vel_col = None;
        let mut health_col = None;
        if mask & POS != 0 {
            pos_col = Some(columns.len());
            columns.push(Column {
                type_id: POS,
                data: Vec::new(),
            });
        }
        if mask & VEL != 0 {
            vel_col = Some(columns.len());
            columns.push(Column {
                type_id: VEL,
                data: Vec::new(),
            });
        }
        if mask & HEALTH != 0 {
            health_col = Some(columns.len());
            columns.push(Column {
                type_id: HEALTH,
                data: Vec::new(),
            });
        }
        if mask & ENEMY != 0 {
            columns.push(Column {
                type_id: ENEMY,
                data: Vec::new(),
            });
        }
        Self {
            mask,
            pos_col,
            vel_col,
            health_col,
            entities: Vec::new(),
            columns,
        }
    }

    fn copy_at(&self, col: Option<usize>, row: usize) -> Option<[u8; 8]> {
        let col = self.columns.get(col?)?;
        let off = row * 8;
        if off + 8 > col.data.len() {
            return None;
        }
        let mut out = [0u8; 8];
        out.copy_from_slice(&col.data[off..off + 8]);
        Some(out)
    }
}

fn split_cols(cols: &mut [Column], a: usize, b: usize) -> Option<(&mut Column, &mut Column)> {
    if a == b || a >= cols.len() || b >= cols.len() {
        return None;
    }
    if a < b {
        let (left, right) = cols.split_at_mut(b);
        let left_col = left.get_mut(a)?;
        let right_col = right.get_mut(0)?;
        Some((left_col, right_col))
    } else {
        let (left, right) = cols.split_at_mut(a);
        let right_col = right.get_mut(0)?;
        let left_col = left.get_mut(b)?;
        Some((right_col, left_col))
    }
}

/// Packed rows. Migration copies each kept column's row bytes once.
pub struct ModelADirect {
    entity_count: usize,
    archetypes: Vec<DirectArch>,
    location: Vec<(u16, u32)>,
}

impl ModelADirect {
    pub fn build(entity_count: usize) -> Self {
        let mut model = Self {
            entity_count,
            archetypes: Vec::new(),
            location: vec![(0, 0); entity_count],
        };
        for entity in 0..entity_count as u32 {
            let mut mask = POS | VEL;
            let health = if entity % 2 == 0 {
                mask |= HEALTH;
                Some(write_pair(initial_health(entity)))
            } else {
                None
            };
            let enemy = entity % 4 == 0;
            if enemy {
                mask |= ENEMY;
            }
            model.place(
                entity,
                mask,
                Kept {
                    pos: Some(write_pair(initial_position(entity))),
                    vel: Some(write_pair(initial_velocity(entity))),
                    health,
                },
            );
        }
        model
    }

    fn ensure(&mut self, mask: u8) -> usize {
        if let Some(index) = self.archetypes.iter().position(|arch| arch.mask == mask) {
            return index;
        }
        self.archetypes.push(DirectArch::new(mask));
        self.archetypes.len() - 1
    }

    fn place(&mut self, entity: u32, mask: u8, kept: Kept) {
        let index = self.ensure(mask);
        let row = self.append(index, entity, &kept);
        self.location[entity as usize] = (index as u16, row);
    }

    fn append(&mut self, index: usize, entity: u32, kept: &Kept) -> u32 {
        let arch = &mut self.archetypes[index];
        let row = arch.entities.len() as u32;
        arch.entities.push(entity);
        for col in &mut arch.columns {
            let bytes = match col.type_id {
                POS => kept.pos,
                VEL => kept.vel,
                HEALTH => kept.health,
                _ => None,
            };
            if let Some(bytes) = bytes {
                col.data.extend_from_slice(&bytes);
            }
        }
        row
    }

    fn detach(&mut self, index: usize, row: usize) {
        let last = self.archetypes[index].entities.len() - 1;
        if row != last {
            let moved = self.archetypes[index].entities[last];
            self.archetypes[index].entities[row] = moved;
            self.location[moved as usize] = (index as u16, row as u32);
        }
        self.archetypes[index].entities.pop();
        for col in &mut self.archetypes[index].columns {
            if col.data.is_empty() {
                continue;
            }
            let width = 8usize;
            let src = last * width;
            if row != last && src + width <= col.data.len() {
                let dst = row * width;
                col.data.copy_within(src..src + width, dst);
            }
            let new_len = last * width;
            if col.data.len() >= new_len {
                col.data.truncate(new_len);
            }
        }
    }

    fn migrate(&mut self, entity: u32, new_mask: u8, health: Option<[u8; 8]>) {
        let (index, row) = self.location[entity as usize];
        let index = index as usize;
        let row = row as usize;
        let arch = &self.archetypes[index];
        let kept = Kept {
            pos: arch.copy_at(arch.pos_col, row),
            vel: arch.copy_at(arch.vel_col, row),
            health,
        };
        self.detach(index, row);
        let new_index = self.ensure(new_mask);
        let new_row = self.append(new_index, entity, &kept);
        self.location[entity as usize] = (new_index as u16, new_row);
    }
}

impl StorageModel for ModelADirect {
    fn entity_count(&self) -> usize {
        self.entity_count
    }

    fn movement(&mut self, dt: f32) {
        for arch in &mut self.archetypes {
            if arch.mask & (POS | VEL) != POS | VEL {
                continue;
            }
            let (Some(pos_col), Some(vel_col)) = (arch.pos_col, arch.vel_col) else {
                continue;
            };
            let rows = arch.entities.len();
            let Some((pos, vel)) = split_cols(&mut arch.columns, pos_col, vel_col) else {
                continue;
            };
            for row in 0..rows {
                let off = row * 8;
                let x = read_f32(&pos.data, off) + read_f32(&vel.data, off) * dt;
                let y = read_f32(&pos.data, off + 4) + read_f32(&vel.data, off + 4) * dt;
                write_f32(&mut pos.data, off, x);
                write_f32(&mut pos.data, off + 4, y);
            }
        }
    }

    fn regen(&mut self, dt: f32) {
        for arch in &mut self.archetypes {
            let Some(health_col) = arch.health_col else {
                continue;
            };
            let rows = arch.entities.len();
            let Some(col) = arch.columns.get_mut(health_col) else {
                continue;
            };
            for row in 0..rows {
                let off = row * 8;
                let current = read_f32(&col.data, off) + dt;
                write_f32(&mut col.data, off, current);
            }
        }
    }

    fn add_health(&mut self, entity: u32) {
        let (index, _) = self.location[entity as usize];
        let mask = self.archetypes[index as usize].mask;
        if mask & HEALTH != 0 {
            return;
        }
        self.migrate(entity, mask | HEALTH, Some(write_pair(spawned_health())));
    }

    fn remove_health(&mut self, entity: u32) {
        let (index, _) = self.location[entity as usize];
        let mask = self.archetypes[index as usize].mask;
        if mask & HEALTH == 0 {
            return;
        }
        self.migrate(entity, mask & !HEALTH, None);
    }

    fn heap_bytes(&self) -> usize {
        let mut total = self.location.capacity() * std::mem::size_of::<(u16, u32)>();
        total += self.archetypes.capacity() * std::mem::size_of::<DirectArch>();
        for arch in &self.archetypes {
            total += arch.entities.capacity() * std::mem::size_of::<u32>();
            total += arch.columns.capacity() * std::mem::size_of::<Column>();
            for col in &arch.columns {
                total += col.data.capacity();
            }
        }
        total
    }

    fn position(&self, entity: u32) -> [f32; 2] {
        self.pair_at(entity, true)
    }

    fn velocity(&self, entity: u32) -> [f32; 2] {
        self.pair_at(entity, false)
    }

    fn health(&self, entity: u32) -> Option<[f32; 2]> {
        let (index, row) = self.location.get(entity as usize).copied()?;
        let arch = self.archetypes.get(index as usize)?;
        let bytes = arch.copy_at(arch.health_col, row as usize)?;
        Some(read_pair(&bytes, 0))
    }

    fn has_enemy(&self, entity: u32) -> bool {
        let Some((index, _)) = self.location.get(entity as usize).copied() else {
            return false;
        };
        self.archetypes
            .get(index as usize)
            .is_some_and(|arch| arch.mask & ENEMY != 0)
    }
}

impl ModelADirect {
    fn pair_at(&self, entity: u32, position: bool) -> [f32; 2] {
        let Some((index, row)) = self.location.get(entity as usize).copied() else {
            return [0.0, 0.0];
        };
        let Some(arch) = self.archetypes.get(index as usize) else {
            return [0.0, 0.0];
        };
        let col = if position { arch.pos_col } else { arch.vel_col };
        match arch.copy_at(col, row as usize) {
            Some(bytes) => read_pair(&bytes, 0),
            None => [0.0, 0.0],
        }
    }
}

struct Chunk {
    mask: u8,
    entities: Vec<u32>,
    px: Vec<f32>,
    py: Vec<f32>,
    vx: Vec<f32>,
    vy: Vec<f32>,
    hc: Vec<f32>,
    hm: Vec<f32>,
}

struct FieldSnap {
    pos: Option<[f32; 2]>,
    vel: Option<[f32; 2]>,
    health: Option<[f32; 2]>,
}

impl Chunk {
    fn new(mask: u8) -> Self {
        Self {
            mask,
            entities: Vec::new(),
            px: Vec::new(),
            py: Vec::new(),
            vx: Vec::new(),
            vy: Vec::new(),
            hc: Vec::new(),
            hm: Vec::new(),
        }
    }

    fn push(&mut self, entity: u32, snap: &FieldSnap) {
        self.entities.push(entity);
        if let Some(pos) = snap.pos {
            self.px.push(pos[0]);
            self.py.push(pos[1]);
        }
        if let Some(vel) = snap.vel {
            self.vx.push(vel[0]);
            self.vy.push(vel[1]);
        }
        if let Some(health) = snap.health {
            self.hc.push(health[0]);
            self.hm.push(health[1]);
        }
    }

    fn take(&self, row: usize) -> FieldSnap {
        FieldSnap {
            pos: if self.mask & POS != 0 {
                Some([
                    self.px.get(row).copied().unwrap_or(0.0),
                    self.py.get(row).copied().unwrap_or(0.0),
                ])
            } else {
                None
            },
            vel: if self.mask & VEL != 0 {
                Some([
                    self.vx.get(row).copied().unwrap_or(0.0),
                    self.vy.get(row).copied().unwrap_or(0.0),
                ])
            } else {
                None
            },
            health: if self.mask & HEALTH != 0 {
                Some([
                    self.hc.get(row).copied().unwrap_or(0.0),
                    self.hm.get(row).copied().unwrap_or(0.0),
                ])
            } else {
                None
            },
        }
    }
}

fn swap_remove_f32(values: &mut Vec<f32>, row: usize) {
    let Some(last) = values.len().checked_sub(1) else {
        return;
    };
    if row > last {
        return;
    }
    if row != last {
        values[row] = values[last];
    }
    values.pop();
}

/// One `Vec<f32>` per field per archetype. Migration moves each kept field once.
pub struct ModelC {
    entity_count: usize,
    chunks: Vec<Chunk>,
    location: Vec<(u16, u32)>,
}

impl ModelC {
    pub fn build(entity_count: usize) -> Self {
        let mut model = Self {
            entity_count,
            chunks: Vec::new(),
            location: vec![(0, 0); entity_count],
        };
        for entity in 0..entity_count as u32 {
            let mut mask = POS | VEL;
            let health = if entity % 2 == 0 {
                mask |= HEALTH;
                Some(initial_health(entity))
            } else {
                None
            };
            let enemy = entity % 4 == 0;
            if enemy {
                mask |= ENEMY;
            }
            model.place(
                entity,
                mask,
                FieldSnap {
                    pos: Some(initial_position(entity)),
                    vel: Some(initial_velocity(entity)),
                    health,
                },
            );
        }
        model
    }

    fn ensure(&mut self, mask: u8) -> usize {
        if let Some(index) = self.chunks.iter().position(|chunk| chunk.mask == mask) {
            return index;
        }
        self.chunks.push(Chunk::new(mask));
        self.chunks.len() - 1
    }

    fn place(&mut self, entity: u32, mask: u8, snap: FieldSnap) {
        let index = self.ensure(mask);
        let row = self.chunks[index].entities.len() as u32;
        self.chunks[index].push(entity, &snap);
        self.location[entity as usize] = (index as u16, row);
    }

    fn detach(&mut self, index: usize, row: usize) {
        let last = self.chunks[index].entities.len() - 1;
        if row != last {
            let moved = self.chunks[index].entities[last];
            self.chunks[index].entities[row] = moved;
            self.location[moved as usize] = (index as u16, row as u32);
        }
        self.chunks[index].entities.pop();
        let mask = self.chunks[index].mask;
        if mask & POS != 0 {
            swap_remove_f32(&mut self.chunks[index].px, row);
            swap_remove_f32(&mut self.chunks[index].py, row);
        }
        if mask & VEL != 0 {
            swap_remove_f32(&mut self.chunks[index].vx, row);
            swap_remove_f32(&mut self.chunks[index].vy, row);
        }
        if mask & HEALTH != 0 {
            swap_remove_f32(&mut self.chunks[index].hc, row);
            swap_remove_f32(&mut self.chunks[index].hm, row);
        }
    }

    fn migrate(&mut self, entity: u32, new_mask: u8, health: Option<[f32; 2]>) {
        let (index, row) = self.location[entity as usize];
        let mut snap = self.chunks[index as usize].take(row as usize);
        snap.health = health;
        self.detach(index as usize, row as usize);
        self.place(entity, new_mask, snap);
    }
}

impl StorageModel for ModelC {
    fn entity_count(&self) -> usize {
        self.entity_count
    }

    fn movement(&mut self, dt: f32) {
        for chunk in &mut self.chunks {
            if chunk.mask & (POS | VEL) != POS | VEL {
                continue;
            }
            let rows = chunk.entities.len();
            for row in 0..rows {
                let vx = chunk.vx[row];
                let vy = chunk.vy[row];
                chunk.px[row] += vx * dt;
                chunk.py[row] += vy * dt;
            }
        }
    }

    fn regen(&mut self, dt: f32) {
        for chunk in &mut self.chunks {
            if chunk.mask & HEALTH == 0 {
                continue;
            }
            for value in &mut chunk.hc {
                *value += dt;
            }
        }
    }

    fn add_health(&mut self, entity: u32) {
        let (index, _) = self.location[entity as usize];
        let mask = self.chunks[index as usize].mask;
        if mask & HEALTH != 0 {
            return;
        }
        self.migrate(entity, mask | HEALTH, Some(spawned_health()));
    }

    fn remove_health(&mut self, entity: u32) {
        let (index, _) = self.location[entity as usize];
        let mask = self.chunks[index as usize].mask;
        if mask & HEALTH == 0 {
            return;
        }
        self.migrate(entity, mask & !HEALTH, None);
    }

    fn heap_bytes(&self) -> usize {
        let mut total = self.location.capacity() * std::mem::size_of::<(u16, u32)>();
        total += self.chunks.capacity() * std::mem::size_of::<Chunk>();
        for chunk in &self.chunks {
            total += chunk.entities.capacity() * std::mem::size_of::<u32>();
            for values in [
                &chunk.px, &chunk.py, &chunk.vx, &chunk.vy, &chunk.hc, &chunk.hm,
            ] {
                total += values.capacity() * std::mem::size_of::<f32>();
            }
        }
        total
    }

    fn position(&self, entity: u32) -> [f32; 2] {
        self.pair_at(entity, true)
    }

    fn velocity(&self, entity: u32) -> [f32; 2] {
        self.pair_at(entity, false)
    }

    fn health(&self, entity: u32) -> Option<[f32; 2]> {
        let (index, row) = self.location.get(entity as usize).copied()?;
        let chunk = self.chunks.get(index as usize)?;
        if chunk.mask & HEALTH == 0 {
            return None;
        }
        Some([
            chunk.hc.get(row as usize).copied().unwrap_or(0.0),
            chunk.hm.get(row as usize).copied().unwrap_or(0.0),
        ])
    }

    fn has_enemy(&self, entity: u32) -> bool {
        let Some((index, _)) = self.location.get(entity as usize).copied() else {
            return false;
        };
        self.chunks
            .get(index as usize)
            .is_some_and(|chunk| chunk.mask & ENEMY != 0)
    }
}

impl ModelC {
    fn pair_at(&self, entity: u32, position: bool) -> [f32; 2] {
        let Some((index, row)) = self.location.get(entity as usize).copied() else {
            return [0.0, 0.0];
        };
        let Some(chunk) = self.chunks.get(index as usize) else {
            return [0.0, 0.0];
        };
        let row = row as usize;
        if position {
            [
                chunk.px.get(row).copied().unwrap_or(0.0),
                chunk.py.get(row).copied().unwrap_or(0.0),
            ]
        } else {
            [
                chunk.vx.get(row).copied().unwrap_or(0.0),
                chunk.vy.get(row).copied().unwrap_or(0.0),
            ]
        }
    }
}

struct Sparse2 {
    sparse: Vec<u32>,
    entities: Vec<u32>,
    a: Vec<f32>,
    b: Vec<f32>,
}

struct Sparse0 {
    sparse: Vec<u32>,
    entities: Vec<u32>,
}

impl Sparse2 {
    fn new() -> Self {
        Self {
            sparse: Vec::new(),
            entities: Vec::new(),
            a: Vec::new(),
            b: Vec::new(),
        }
    }

    fn insert(&mut self, entity: u32, a: f32, b: f32) {
        let index = entity as usize;
        if index >= self.sparse.len() {
            self.sparse.resize(index + 1, 0);
        }
        if self.sparse[index] != 0 {
            let dense = (self.sparse[index] - 1) as usize;
            if let Some(slot) = self.a.get_mut(dense) {
                *slot = a;
            }
            if let Some(slot) = self.b.get_mut(dense) {
                *slot = b;
            }
            return;
        }
        let dense = self.entities.len() as u32;
        self.entities.push(entity);
        self.a.push(a);
        self.b.push(b);
        self.sparse[index] = dense + 1;
    }

    fn remove(&mut self, entity: u32) {
        let Some(slot) = self.sparse.get(entity as usize).copied() else {
            return;
        };
        if slot == 0 {
            return;
        }
        let dense = (slot - 1) as usize;
        let Some(last) = self.entities.len().checked_sub(1) else {
            return;
        };
        if dense != last {
            let moved = self.entities[last];
            self.entities[dense] = moved;
            if let (Some(src_a), Some(src_b)) =
                (self.a.get(last).copied(), self.b.get(last).copied())
            {
                if let Some(dst) = self.a.get_mut(dense) {
                    *dst = src_a;
                }
                if let Some(dst) = self.b.get_mut(dense) {
                    *dst = src_b;
                }
            }
            if let Some(sparse) = self.sparse.get_mut(moved as usize) {
                *sparse = slot;
            }
        }
        self.entities.pop();
        self.a.pop();
        self.b.pop();
        if let Some(sparse) = self.sparse.get_mut(entity as usize) {
            *sparse = 0;
        }
    }

    fn get(&self, entity: u32) -> Option<[f32; 2]> {
        let slot = self.sparse.get(entity as usize).copied()?;
        if slot == 0 {
            return None;
        }
        let dense = (slot - 1) as usize;
        Some([
            self.a.get(dense).copied().unwrap_or(0.0),
            self.b.get(dense).copied().unwrap_or(0.0),
        ])
    }

    fn heap_bytes(&self) -> usize {
        self.sparse.capacity() * std::mem::size_of::<u32>()
            + self.entities.capacity() * std::mem::size_of::<u32>()
            + (self.a.capacity() + self.b.capacity()) * std::mem::size_of::<f32>()
    }
}

impl Sparse0 {
    fn new() -> Self {
        Self {
            sparse: Vec::new(),
            entities: Vec::new(),
        }
    }

    fn insert(&mut self, entity: u32) {
        let index = entity as usize;
        if index >= self.sparse.len() {
            self.sparse.resize(index + 1, 0);
        }
        if self.sparse[index] != 0 {
            return;
        }
        let dense = self.entities.len() as u32;
        self.entities.push(entity);
        self.sparse[index] = dense + 1;
    }

    fn contains(&self, entity: u32) -> bool {
        self.sparse.get(entity as usize).copied().unwrap_or(0) != 0
    }

    fn heap_bytes(&self) -> usize {
        self.sparse.capacity() * std::mem::size_of::<u32>()
            + self.entities.capacity() * std::mem::size_of::<u32>()
    }
}

/// Sparse set per component. Dense per-field `Vec<f32>`. Join is an indirect lookup.
pub struct ModelB {
    entity_count: usize,
    position: Sparse2,
    velocity: Sparse2,
    health: Sparse2,
    enemy: Sparse0,
}

impl ModelB {
    pub fn build(entity_count: usize) -> Self {
        let mut model = Self {
            entity_count,
            position: Sparse2::new(),
            velocity: Sparse2::new(),
            health: Sparse2::new(),
            enemy: Sparse0::new(),
        };
        for entity in 0..entity_count as u32 {
            let pos = initial_position(entity);
            let vel = initial_velocity(entity);
            model.position.insert(entity, pos[0], pos[1]);
            model.velocity.insert(entity, vel[0], vel[1]);
            if entity % 2 == 0 {
                let health = initial_health(entity);
                model.health.insert(entity, health[0], health[1]);
            }
            if entity % 4 == 0 {
                model.enemy.insert(entity);
            }
        }
        model
    }
}

impl StorageModel for ModelB {
    fn entity_count(&self) -> usize {
        self.entity_count
    }

    fn movement(&mut self, dt: f32) {
        let rows = self.position.entities.len();
        for row in 0..rows {
            let entity = self.position.entities[row];
            let slot = self.velocity.sparse[entity as usize];
            if slot == 0 {
                continue;
            }
            let dense = (slot - 1) as usize;
            let vx = self.velocity.a[dense];
            let vy = self.velocity.b[dense];
            self.position.a[row] += vx * dt;
            self.position.b[row] += vy * dt;
        }
    }

    fn regen(&mut self, dt: f32) {
        for value in &mut self.health.a {
            *value += dt;
        }
    }

    fn add_health(&mut self, entity: u32) {
        if self.health.get(entity).is_some() {
            return;
        }
        let health = spawned_health();
        self.health.insert(entity, health[0], health[1]);
    }

    fn remove_health(&mut self, entity: u32) {
        self.health.remove(entity);
    }

    fn heap_bytes(&self) -> usize {
        self.position.heap_bytes()
            + self.velocity.heap_bytes()
            + self.health.heap_bytes()
            + self.enemy.heap_bytes()
    }

    fn position(&self, entity: u32) -> [f32; 2] {
        self.position.get(entity).unwrap_or([0.0, 0.0])
    }

    fn velocity(&self, entity: u32) -> [f32; 2] {
        self.velocity.get(entity).unwrap_or([0.0, 0.0])
    }

    fn health(&self, entity: u32) -> Option<[f32; 2]> {
        self.health.get(entity)
    }

    fn has_enemy(&self, entity: u32) -> bool {
        self.enemy.contains(entity)
    }
}
