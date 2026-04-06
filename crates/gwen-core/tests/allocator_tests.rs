#[cfg(test)]
mod tests {
    use gwen_core::allocator::{Arena, LinearAllocator};

    #[test]
    fn test_allocate_single() {
        let mut alloc = LinearAllocator::new(1000);
        let _ptr = alloc.allocate(100, 1);
        assert_eq!(alloc.used(), 100);
    }

    #[test]
    fn test_allocate_multiple() {
        let mut alloc = LinearAllocator::new(1000);
        let _ptr1 = alloc.allocate(100, 1);
        let _ptr2 = alloc.allocate(100, 1);
        let _ptr3 = alloc.allocate(100, 1);
        assert_eq!(alloc.used(), 300);
    }

    #[test]
    fn test_alignment_8() {
        let mut alloc = LinearAllocator::new(1000);
        // First allocation: starts at 0 (already aligned)
        let _ptr1 = alloc.allocate(1, 8);
        assert_eq!(alloc.used(), 1);

        // Second allocation: offset=1, aligned to 8 = starts at 8
        let _ptr2 = alloc.allocate(1, 8);
        assert_eq!(alloc.used(), 9);
    }

    #[test]
    fn test_alignment_16() {
        let mut alloc = LinearAllocator::new(1000);
        let _ptr1 = alloc.allocate(1, 16);
        assert_eq!(alloc.used(), 1);
    }

    #[test]
    fn test_alignment_sequence() {
        let mut alloc = LinearAllocator::new(1000);

        let _ptr1 = alloc.allocate(1, 8);
        assert_eq!(alloc.used(), 1);

        let _ptr2 = alloc.allocate(1, 8);
        assert_eq!(alloc.used(), 9);

        let _ptr3 = alloc.allocate(10, 8);
        assert_eq!(alloc.used(), 26);
    }

    #[test]
    fn test_out_of_memory() {
        let mut alloc = LinearAllocator::new(100);
        let ptr1 = alloc.allocate(100, 1);
        assert!(ptr1.is_some());

        let ptr2 = alloc.allocate(1, 1);
        assert!(ptr2.is_none());
    }

    #[test]
    fn test_reset() {
        let mut alloc = LinearAllocator::new(1000);
        let _ptr1 = alloc.allocate(100, 1);
        assert_eq!(alloc.used(), 100);

        alloc.reset();
        assert_eq!(alloc.used(), 0);

        let _ptr2 = alloc.allocate(50, 1);
        assert_eq!(alloc.used(), 50);
    }

    #[test]
    fn test_free_space() {
        let mut alloc = LinearAllocator::new(1000);
        assert_eq!(alloc.free(), 1000);

        alloc.allocate(100, 1);
        assert_eq!(alloc.free(), 900);

        alloc.allocate(200, 1);
        assert_eq!(alloc.free(), 700);
    }

    #[test]
    fn test_capacity() {
        let alloc = LinearAllocator::new(1000);
        assert_eq!(alloc.capacity(), 1000);
    }

    #[test]
    fn test_utilization() {
        let mut alloc = LinearAllocator::new(1000);
        assert_eq!(alloc.utilization(), 0.0);

        alloc.allocate(500, 1);
        assert_eq!(alloc.utilization(), 0.5);

        alloc.allocate(500, 1);
        assert_eq!(alloc.utilization(), 1.0);
    }

    #[test]
    fn test_can_allocate() {
        let mut alloc = LinearAllocator::new(100);
        assert!(alloc.can_allocate(50, 1));

        alloc.allocate(50, 1);
        assert!(alloc.can_allocate(50, 1));

        alloc.allocate(50, 1);
        assert!(!alloc.can_allocate(1, 1));
    }

    #[test]
    fn test_arena_creation() {
        let arena = Arena::new("test".to_string(), 1000);
        assert_eq!(arena.name(), "test");
        assert_eq!(arena.capacity(), 1000);
    }

    #[test]
    fn test_arena_allocate() {
        let mut arena = Arena::new("test".to_string(), 1000);
        let ptr1 = arena.allocate(100);
        assert!(ptr1.is_some());

        let ptr2 = arena.allocate(100);
        assert!(ptr2.is_some());
    }

    #[test]
    fn test_arena_stats() {
        let mut arena = Arena::new("test".to_string(), 1000);
        let (used, free) = arena.stats();
        assert_eq!(used, 0);
        assert_eq!(free, 1000);

        arena.allocate(100);
        let (used, free) = arena.stats();
        assert_eq!(used, 100);
        assert_eq!(free, 900);
    }

    #[test]
    fn test_arena_reset() {
        let mut arena = Arena::new("test".to_string(), 1000);
        arena.allocate(100);

        let (used, _) = arena.stats();
        assert_eq!(used, 100);

        arena.reset();
        let (used, _) = arena.stats();
        assert_eq!(used, 0);
    }

    #[test]
    fn test_arena_utilization() {
        let mut arena = Arena::new("test".to_string(), 1000);
        assert_eq!(arena.utilization(), 0.0);

        arena.allocate(500);
        assert_eq!(arena.utilization(), 0.5);
    }

    #[test]
    fn test_allocate_zero_size() {
        let mut alloc = LinearAllocator::new(1000);
        let ptr = alloc.allocate(0, 8);
        assert!(ptr.is_none());
    }

    #[test]
    fn test_allocate_large_object() {
        let mut alloc = LinearAllocator::new(10000);
        let ptr = alloc.allocate(5000, 1);
        assert!(ptr.is_some());
        assert_eq!(alloc.used(), 5000);
    }

    #[test]
    fn test_performance_10k_small_allocations() {
        let mut alloc = LinearAllocator::new(1024 * 1024);

        let start = std::time::Instant::now();
        for _ in 0..10000 {
            let _ = alloc.allocate(8, 1);
        }
        let elapsed = start.elapsed();

        assert!(
            elapsed.as_millis() < 50,
            "10K allocations took {}ms",
            elapsed.as_millis()
        );
    }

    #[test]
    fn test_performance_multiple_resets() {
        let mut alloc = LinearAllocator::new(1000);

        let start = std::time::Instant::now();
        for _ in 0..1000 {
            alloc.allocate(100, 1);
            alloc.reset();
        }
        let elapsed = start.elapsed();

        assert!(
            elapsed.as_millis() < 100,
            "1K reset cycles took {}ms",
            elapsed.as_millis()
        );
    }

    #[test]
    fn test_no_fragmentation() {
        let mut alloc = LinearAllocator::new(1000);

        alloc.allocate(100, 1);
        alloc.reset();

        alloc.allocate(100, 1);
        alloc.reset();

        assert!(alloc.can_allocate(1000, 1));
    }

    #[test]
    fn test_arena_multiple() {
        let mut frame_arena = Arena::new("frame".to_string(), 5000);
        let mut entity_arena = Arena::new("entities".to_string(), 5000);

        frame_arena.allocate(100);
        entity_arena.allocate(200);

        let (frame_used, _) = frame_arena.stats();
        let (entity_used, _) = entity_arena.stats();

        assert_eq!(frame_used, 100);
        assert_eq!(entity_used, 200);
    }

    #[test]
    fn test_allocate_aligned_variants() {
        let mut alloc = LinearAllocator::new(1000);

        let ptr1 = alloc.allocate(10, 4);
        assert!(ptr1.is_some());

        let ptr2 = alloc.allocate(10, 16);
        assert!(ptr2.is_some());

        let ptr3 = alloc.allocate(10, 32);
        assert!(ptr3.is_some());
    }
}
