//! BitSet for component matching.
//!
//! Provides a fixed-size 128-bit set for efficient component mask matching.

/// A 128-bit set for component matching.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Hash)]
#[repr(C)]
pub struct BitSet128 {
    low: u64,
    high: u64,
}

impl BitSet128 {
    /// Create a new empty BitSet128.
    #[inline]
    pub fn new() -> Self {
        Self { low: 0, high: 0 }
    }

    /// Set a bit at the given index.
    /// 
    /// # Panics
    /// Panics if index >= 128.
    #[inline]
    pub fn set(&mut self, index: u8) {
        assert!(index < 128, "BitSet128 index out of bounds: {}", index);
        if index < 64 {
            self.low |= 1 << index;
        } else {
            self.high |= 1 << (index - 64);
        }
    }

    /// Check if a bit is set.
    /// 
    /// # Panics
    /// Panics if index >= 128.
    #[inline]
    pub fn contains(&self, index: u8) -> bool {
        assert!(index < 128, "BitSet128 index out of bounds: {}", index);
        if index < 64 {
            (self.low & (1 << index)) != 0
        } else {
            (self.high & (1 << (index - 64))) != 0
        }
    }

    /// Check if this set contains all bits set in another set.
    #[inline]
    pub fn contains_all(&self, other: &Self) -> bool {
        (self.low & other.low) == other.low && (self.high & other.high) == other.high
    }

    /// Check if this set is empty.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.low == 0 && self.high == 0
    }

    /// Clear all bits.
    #[inline]
    pub fn clear(&mut self) {
        self.low = 0;
        self.high = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bitset_set_contains() {
        let mut bs = BitSet128::new();
        assert!(!bs.contains(0));
        assert!(!bs.contains(63));
        assert!(!bs.contains(64));
        assert!(!bs.contains(127));

        bs.set(0);
        bs.set(64);
        bs.set(127);

        assert!(bs.contains(0));
        assert!(!bs.contains(63));
        assert!(bs.contains(64));
        assert!(bs.contains(127));
    }

    #[test]
    fn test_bitset_contains_all() {
        let mut bs1 = BitSet128::new();
        bs1.set(10);
        bs1.set(70);
        bs1.set(100);

        let mut bs2 = BitSet128::new();
        bs2.set(10);
        bs2.set(100);

        assert!(bs1.contains_all(&bs2));
        assert!(!bs2.contains_all(&bs1));

        bs2.set(5);
        assert!(!bs1.contains_all(&bs2));
    }

    #[test]
    #[should_panic]
    fn test_bitset_out_of_bounds() {
        let mut bs = BitSet128::new();
        bs.set(128);
    }
}
