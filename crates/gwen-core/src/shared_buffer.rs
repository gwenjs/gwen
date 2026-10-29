//! Shared buffers owned by one engine.
//!
//! The address handed to the host is `ptr.as_ptr() as usize`.
//! Later access uses the stored [`NonNull`], never an integer cast back to a pointer.

use rustc_hash::FxHashMap;
use std::alloc::Layout;
use std::ptr::NonNull;

use crate::ecs::error::CoreError;

const ALIGN: usize = 8;

/// One live allocation. `ptr` keeps the provenance from `alloc_zeroed`.
struct Allocation {
    ptr: NonNull<u8>,
    layout: Layout,
}

/// Allocations created by [`crate::bindings::Engine::alloc_shared_buffer`].
pub(crate) struct SharedBuffers {
    live: FxHashMap<usize, Allocation>,
}

impl SharedBuffers {
    pub(crate) fn new() -> Self {
        Self {
            live: FxHashMap::default(),
        }
    }

    /// Zeroed buffer of `len` bytes, aligned to 8.
    ///
    /// Returns 0 when `len` is 0, the layout is rejected, or allocation fails.
    pub(crate) fn alloc(&mut self, len: usize) -> usize {
        if len == 0 {
            return 0;
        }
        let Ok(layout) = Layout::from_size_align(len, ALIGN) else {
            return 0;
        };
        // SAFETY: `layout` has a non-zero size and an alignment of 8. [U-001]
        let allocated = unsafe { std::alloc::alloc_zeroed(layout) };
        let Some(ptr) = NonNull::new(allocated) else {
            return 0;
        };
        let addr = ptr.as_ptr() as usize;
        self.live.insert(addr, Allocation { ptr, layout });
        addr
    }

    /// Release the live allocation at `addr` when `len` is the recorded length.
    ///
    /// `addr == 0` or `len == 0` does nothing. An unknown address, a second
    /// free, or a wrong length leaves the registry unchanged.
    ///
    /// # Errors
    ///
    /// [`CoreError::InvalidSharedBuffer`] with `len: 0` when `addr` is not the
    /// start of a live allocation, or with the recorded length when `len` differs.
    pub(crate) fn free(&mut self, addr: usize, len: usize) -> Result<(), CoreError> {
        if addr == 0 || len == 0 {
            return Ok(());
        }
        let Some(alloc) = self.live.get(&addr) else {
            return Err(CoreError::InvalidSharedBuffer { ptr: addr, len: 0 });
        };
        let recorded = alloc.layout.size();
        if recorded != len {
            return Err(CoreError::InvalidSharedBuffer {
                ptr: addr,
                len: recorded,
            });
        }
        self.release(addr);
        Ok(())
    }

    /// Recorded byte length and alignment when `addr` is the start of a live allocation.
    #[cfg_attr(
        not(any(test, feature = "physics3d")),
        allow(
            dead_code,
            reason = "physics3d overlap and the shared-buffer tests call this lookup"
        )
    )]
    pub(crate) fn recorded(&self, addr: usize) -> Option<(usize, usize)> {
        self.live
            .get(&addr)
            .map(|alloc| (alloc.layout.size(), alloc.layout.align()))
    }

    /// Exactly `min_len` bytes at the start of the live allocation `addr`.
    ///
    /// # Errors
    ///
    /// [`CoreError::InvalidSharedBuffer`] with `len: 0` when `addr` is not that
    /// start, or with the recorded length when it is shorter than `min_len`.
    pub(crate) fn bytes_mut(
        &mut self,
        addr: usize,
        min_len: usize,
    ) -> Result<&mut [u8], CoreError> {
        let ptr = {
            let Some(alloc) = self.live.get(&addr) else {
                return Err(CoreError::InvalidSharedBuffer { ptr: addr, len: 0 });
            };
            let recorded = alloc.layout.size();
            if min_len > recorded {
                return Err(CoreError::InvalidSharedBuffer {
                    ptr: addr,
                    len: recorded,
                });
            }
            alloc.ptr
        };
        // SAFETY: `ptr` is the `NonNull` stored for `addr`. `min_len` is at most
        // that allocation's size. This slice is the only borrow of those bytes
        // and ends with `&mut self`. [U-003]
        Ok(unsafe { std::slice::from_raw_parts_mut(ptr.as_ptr(), min_len) })
    }

    /// `count` slots of `u32` at `addr`.
    ///
    /// The byte length is `count * 4` computed in `u64`, then narrowed to
    /// `usize`. A length that does not fit asks for `usize::MAX` bytes, so a
    /// live allocation is refused with its recorded length. A cast that fails
    /// is the same error.
    ///
    /// # Errors
    ///
    /// [`CoreError::InvalidSharedBuffer`] with `len: 0` when `addr` is not the
    /// start of a live allocation, or with the recorded length when the
    /// allocation is too short or the bytes cannot be viewed as `u32` slots.
    #[cfg_attr(
        not(any(test, feature = "physics3d")),
        allow(
            dead_code,
            reason = "physics3d overlap and the shared-buffer tests call this view"
        )
    )]
    pub(crate) fn u32_slots_mut(
        &mut self,
        addr: usize,
        count: u32,
    ) -> Result<&mut [u32], CoreError> {
        let Some((recorded, _)) = self.recorded(addr) else {
            return Err(CoreError::InvalidSharedBuffer { ptr: addr, len: 0 });
        };
        let needed = usize::try_from(u64::from(count) * 4).unwrap_or(usize::MAX);
        let bytes = self.bytes_mut(addr, needed)?;
        bytemuck::try_cast_slice_mut(bytes).map_err(|_| CoreError::InvalidSharedBuffer {
            ptr: addr,
            len: recorded,
        })
    }

    /// Remove `addr` and deallocate it. A missing entry does nothing.
    fn release(&mut self, addr: usize) {
        let Some(alloc) = self.live.remove(&addr) else {
            return;
        };
        // SAFETY: `alloc.ptr` and `alloc.layout` are the pair `alloc_zeroed`
        // returned. The map entry was the only record, and it is removed
        // before this free, so a second `release` does not deallocate it. [U-002]
        unsafe { std::alloc::dealloc(alloc.ptr.as_ptr(), alloc.layout) };
    }
}

impl Drop for SharedBuffers {
    fn drop(&mut self) {
        while let Some(addr) = self.live.keys().next().copied() {
            self.release(addr);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SharedBuffers;
    use crate::ecs::error::CoreError;

    #[test]
    fn unsafe_site_u003_u32_slots_round_trip() -> Result<(), CoreError> {
        let mut buffers = SharedBuffers::new();
        let addr = buffers.alloc(16);
        assert_ne!(addr, 0);
        let slots = buffers.u32_slots_mut(addr, 4)?;
        slots.copy_from_slice(&[1, 2, 3, 4]);
        let slots = buffers.u32_slots_mut(addr, 4)?;
        assert_eq!(slots, &[1, 2, 3, 4]);
        let empty = buffers.u32_slots_mut(addr, 0)?.len();
        assert_eq!(empty, 0);
        assert_eq!(
            buffers.u32_slots_mut(addr, 5).map(|slots| slots.len()),
            Err(CoreError::InvalidSharedBuffer { ptr: addr, len: 16 })
        );
        assert_eq!(
            buffers.u32_slots_mut(addr + 4, 1).map(|slots| slots.len()),
            Err(CoreError::InvalidSharedBuffer {
                ptr: addr + 4,
                len: 0
            })
        );
        assert_eq!(buffers.free(addr, 16), Ok(()));
        assert_eq!(
            buffers.u32_slots_mut(addr, 4).map(|slots| slots.len()),
            Err(CoreError::InvalidSharedBuffer { ptr: addr, len: 0 })
        );
        Ok(())
    }

    #[test]
    fn alloc_returns_zero_for_a_zero_length_and_a_non_zero_aligned_address_otherwise() {
        let mut buffers = SharedBuffers::new();
        assert_eq!(buffers.alloc(0), 0);
        let addr = buffers.alloc(16);
        assert_ne!(addr, 0);
        assert_eq!(addr % 8, 0);
    }

    #[test]
    fn free_refuses_an_unknown_address_a_second_free_and_a_wrong_length() -> Result<(), CoreError> {
        let mut buffers = SharedBuffers::new();
        assert_eq!(
            buffers.free(0x1000, 16),
            Err(CoreError::InvalidSharedBuffer {
                ptr: 0x1000,
                len: 0
            })
        );
        let addr = buffers.alloc(16);
        assert_ne!(addr, 0);
        assert_eq!(
            buffers.free(addr, 8),
            Err(CoreError::InvalidSharedBuffer { ptr: addr, len: 16 })
        );
        let slots = buffers.u32_slots_mut(addr, 4)?;
        slots[0] = 9;
        assert_eq!(slots[0], 9);
        assert_eq!(buffers.free(0, 16), Ok(()));
        assert_eq!(buffers.free(addr, 0), Ok(()));
        assert_eq!(buffers.free(addr, 16), Ok(()));
        assert_eq!(
            buffers.free(addr, 16),
            Err(CoreError::InvalidSharedBuffer { ptr: addr, len: 0 })
        );
        Ok(())
    }

    #[test]
    fn bytes_mut_accepts_the_exact_length_and_refuses_one_more() -> Result<(), CoreError> {
        let mut buffers = SharedBuffers::new();
        let addr = buffers.alloc(16);
        assert_ne!(addr, 0);
        assert_eq!(buffers.bytes_mut(addr, 16).map(|bytes| bytes.len()), Ok(16));
        assert_eq!(
            buffers.bytes_mut(addr, 17).map(|bytes| bytes.len()),
            Err(CoreError::InvalidSharedBuffer { ptr: addr, len: 16 })
        );
        let empty = buffers.bytes_mut(addr, 0)?.len();
        assert_eq!(empty, 0);
        Ok(())
    }
}
