//! Memory allocator
//!
//! Efficient linear allocator for WASM with zero fragmentation.

/// Simple linear/bump allocator for fast allocation with no fragmentation
pub struct LinearAllocator {
    buffer: Vec<u8>,
    offset: usize,
}

impl LinearAllocator {
    /// Create a new linear allocator with given capacity
    pub fn new(capacity: usize) -> Self {
        LinearAllocator {
            buffer: vec![0u8; capacity],
            offset: 0,
        }
    }

    /// Allocate memory with alignment
    pub fn allocate(&mut self, size: usize, align: usize) -> Option<*mut u8> {
        if size == 0 {
            return None;
        }

        let aligned_offset = align_offset(self.offset, align);
        let end = aligned_offset.checked_add(size)?;

        if end > self.buffer.len() {
            return None; // Out of memory
        }

        let ptr = unsafe { self.buffer.as_mut_ptr().add(aligned_offset) };
        self.offset = end;
        Some(ptr)
    }

    /// Allocate with default alignment (8 bytes)
    pub fn allocate_aligned(&mut self, size: usize) -> Option<*mut u8> {
        self.allocate(size, 8)
    }

    /// Reset allocator to initial state
    pub fn reset(&mut self) {
        self.offset = 0;
    }

    /// Get amount of used memory
    pub fn used(&self) -> usize {
        self.offset
    }

    /// Get amount of free memory
    pub fn free(&self) -> usize {
        self.buffer.len().saturating_sub(self.offset)
    }

    /// Get total capacity
    pub fn capacity(&self) -> usize {
        self.buffer.len()
    }

    /// Get allocation utilization as percentage
    pub fn utilization(&self) -> f32 {
        (self.offset as f32) / (self.buffer.len() as f32)
    }

    /// Check if allocator has space for allocation
    pub fn can_allocate(&self, size: usize, align: usize) -> bool {
        let aligned_offset = align_offset(self.offset, align);
        let end = aligned_offset + size;
        end <= self.buffer.len()
    }
}

impl Default for LinearAllocator {
    fn default() -> Self {
        Self::new(1024 * 1024) // 1MB default
    }
}

/// Arena allocator - groups related allocations with a name
pub struct Arena {
    allocator: LinearAllocator,
    name: String,
}

impl Arena {
    /// Create a new arena with given name and capacity
    pub fn new(name: String, capacity: usize) -> Self {
        Arena {
            allocator: LinearAllocator::new(capacity),
            name,
        }
    }

    /// Allocate memory in this arena (with default 8-byte alignment)
    pub fn allocate(&mut self, size: usize) -> Option<*mut u8> {
        self.allocator.allocate_aligned(size)
    }

    /// Allocate with specific alignment
    pub fn allocate_aligned(&mut self, size: usize, align: usize) -> Option<*mut u8> {
        self.allocator.allocate(size, align)
    }

    /// Reset this arena
    pub fn reset(&mut self) {
        self.allocator.reset();
    }

    /// Get arena name
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Get arena statistics (used, free)
    pub fn stats(&self) -> (usize, usize) {
        (self.allocator.used(), self.allocator.free())
    }

    /// Get utilization percentage
    pub fn utilization(&self) -> f32 {
        self.allocator.utilization()
    }

    /// Get capacity
    pub fn capacity(&self) -> usize {
        self.allocator.capacity()
    }
}

/// Calculate aligned offset
fn align_offset(offset: usize, align: usize) -> usize {
    if align == 0 {
        return offset;
    }
    (offset + align - 1) & !(align - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_align_offset() {
        assert_eq!(align_offset(0, 8), 0);
        assert_eq!(align_offset(1, 8), 8);
        assert_eq!(align_offset(8, 8), 8);
        assert_eq!(align_offset(9, 8), 16);
        assert_eq!(align_offset(0, 16), 0);
        assert_eq!(align_offset(1, 16), 16);
        assert_eq!(align_offset(15, 16), 16);
        assert_eq!(align_offset(16, 16), 16);
    }
}
