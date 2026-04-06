#[cfg(test)]
mod tests {
    use gwen_core::*;
    use gwen_core::allocator::LinearAllocator;

    // === Edge Cases ===

    #[test]
    fn test_entity_manager_max_capacity() {
        let mut em = EntityManager::new(10);

        // Allocate max entities
        for _ in 0..10 {
            let _ = em.create_entity();
        }
        assert_eq!(em.count_entities(), 10);
    }

    #[test]
    fn test_entity_manager_exceeds_capacity() {
        let _em = EntityManager::new(5);

        // Should panic on 6th entity
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut em_copy = EntityManager::new(5);
            for _ in 0..6 {
                em_copy.create_entity();
            }
        }));

        assert!(result.is_err());
    }

    #[test]
    fn test_component_zero_size() {
        let mut storage = ArchetypeStorage::new();
        use bytemuck::{Pod, Zeroable};
        #[derive(Clone, Copy, Pod, Zeroable)]
        #[repr(C)]
        struct Unit;
        let handle = ComponentHandle::<Unit>::new(&mut storage);

        // Zero-sized types should still work
        handle.add(&mut storage, 0, Unit);
        assert!(handle.has(&storage, 0));
    }

    #[test]
    fn test_allocator_fragmentation_prevention() {
        let mut alloc = LinearAllocator::new(1000);

        // Allocate, deallocate, allocate - should reuse same space
        alloc.allocate(100, 1);
        alloc.reset();
        alloc.allocate(100, 1);

        // Should use exact same memory
        assert_eq!(alloc.used(), 100);
    }

    #[test]
    fn test_query_no_entities() {
        let mut storage = ArchetypeStorage::new();
        let mut qs = QuerySystem::new();
        let c0 = ComponentTypeId::from_raw(0);
        storage.register_raw(c0, 4);
        let query = QueryId::new(vec![c0], storage.registry());

        let result = qs.query(&storage, query);
        assert_eq!(result.len(), 0);
    }

    // === Error Handling ===

    #[test]
    fn test_delete_already_deleted_entity() {
        let mut em = EntityManager::new(100);

        let e = em.create_entity();
        assert!(em.delete_entity(e));
        assert!(!em.delete_entity(e)); // Second delete fails
    }

    #[test]
    fn test_component_on_nonexistent_entity() {
        let storage = ArchetypeStorage::new();
        // Should not find component on entity that doesn't exist
        assert!(!storage.has_component(9999, ComponentTypeId::from_raw(0)));
    }

    #[test]
    fn test_query_empty_requirements() {
        let mut storage = ArchetypeStorage::new();
        let mut qs = QuerySystem::new();

        // Add entities with different archetypes
        storage.add_component(0, ComponentTypeId::from_raw(0), &[0; 4]);
        storage.add_component(1, ComponentTypeId::from_raw(1), &[0; 4]);

        // Empty query should match all
        let query = QueryId::new(vec![], storage.registry());
        let result = qs.query(&storage, query);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_gameloop_extreme_delta() {
        let mut loop_obj = GameLoop::new(60);

        // Very large delta
        loop_obj.tick(10.0);
        assert_eq!(loop_obj.delta_time(), 0.1); // Clamped to 100ms

        // Negative delta
        loop_obj.tick(-5.0);
        assert_eq!(loop_obj.delta_time(), 0.0); // Clamped to 0
    }

    // === Integration Tests ===

    #[test]
    fn test_entity_component_workflow() {
        let mut em = EntityManager::new(100);
        let mut storage = ArchetypeStorage::new();
        use bytemuck::{Pod, Zeroable};

        #[derive(Clone, Copy, Pod, Zeroable)]
        #[repr(C)]
        #[allow(dead_code)]
        struct Position {
            x: f32,
            y: f32,
        }

        impl gwen_core::events::Event for Position {
            fn as_any(&self) -> &dyn std::any::Any {
                self
            }
        }

        let handle = ComponentHandle::<Position>::new(&mut storage);

        let e = em.create_entity();
        handle.add(&mut storage, e.index(), Position { x: 1.0, y: 2.0 });

        assert!(handle.has(&storage, e.index()));
    }

    #[test]
    fn test_multiple_systems_lifecycle() {
        let mut em = EntityManager::new(100);
        let _storage = ArchetypeStorage::new();
        let _qs = QuerySystem::new();
        let mut loop_obj = GameLoop::new(60);

        // Create entity
        let _e = em.create_entity();

        // Update game loop
        loop_obj.tick(0.016);

        // Verify frame updated
        assert_eq!(loop_obj.frame_count(), 1);
        assert!(loop_obj.delta_time() > 0.0);
    }

    #[test]
    fn test_entity_reuse_across_frames() {
        let mut em = EntityManager::new(100);
        let mut loop_obj = GameLoop::new(60);

        let e1 = em.create_entity();
        loop_obj.tick(0.016);

        em.delete_entity(e1);
        let e2 = em.create_entity();

        // Should have reused slot
        assert_eq!(e1.index(), e2.index());
    }

    #[test]
    fn test_archetype_persistence() {
        let mut storage = ArchetypeStorage::new();
        let mut qs = QuerySystem::new();
        let c0 = ComponentTypeId::from_raw(0);
        let c1 = ComponentTypeId::from_raw(1);
        storage.register_raw(c0, 4);
        storage.register_raw(c1, 4);

        // Update archetype
        storage.add_component(0, c0, &[0; 4]);
        storage.add_component(0, c1, &[0; 4]);

        // Query should find it
        let query = QueryId::new(vec![c0], storage.registry());
        let result = qs.query(&storage, query);

        assert_eq!(result.len(), 1);
    }

    // === Stress Tests ===

    #[test]
    fn test_1k_entity_lifecycle() {
        let mut em = EntityManager::new(10000);

        let mut entities = Vec::new();
        for _ in 0..1000 {
            entities.push(em.create_entity());
        }

        assert_eq!(em.count_entities(), 1000);

        for e in entities {
            em.delete_entity(e);
        }

        assert_eq!(em.count_entities(), 0);
    }

    #[test]
    fn test_allocator_many_small_allocations() {
        let mut alloc = LinearAllocator::new(1024 * 1024);

        for _ in 0..10000 {
            let _ = alloc.allocate(8, 1);
        }

        assert!(alloc.used() > 0);
    }

    #[test]
    fn test_query_multiple_types() {
        let mut storage = ArchetypeStorage::new();
        let mut qs = QuerySystem::new();
        let c0 = ComponentTypeId::from_raw(0);
        let c1 = ComponentTypeId::from_raw(1);
        let c2 = ComponentTypeId::from_raw(2);
        storage.register_raw(c0, 4);
        storage.register_raw(c1, 4);
        storage.register_raw(c2, 4);

        // Create entities with different combinations
        storage.add_component(0, c0, &[0; 4]);
        storage.add_component(0, c1, &[0; 4]);
        storage.add_component(0, c2, &[0; 4]);

        storage.add_component(1, c0, &[0; 4]);
        storage.add_component(1, c1, &[0; 4]);
        
        storage.add_component(2, c0, &[0; 4]);

        // Query for [0, 1]
        let query = QueryId::new(vec![c0, c1], storage.registry());

        let result = qs.query(&storage, query);
        assert_eq!(result.len(), 2); // Entities 0 and 1
    }

    // === Performance Tests ===

    #[test]
    fn test_component_storage_large_entity_set() {
        let mut storage = ArchetypeStorage::new();
        let handle = ComponentHandle::<u32>::new(&mut storage);

        // Add components to many entities
        for i in 0..1000 {
            handle.add(&mut storage, i, i);
        }

        // Query should be fast
        let start = std::time::Instant::now();
        for i in 0..1000 {
            let _ = handle.get(&storage, i);
        }
        let elapsed = start.elapsed();

        assert!(elapsed.as_millis() < 200);
    }

    #[test]
    fn test_gameloop_frame_accumulation() {
        let mut loop_obj = GameLoop::new(60);

        // Accumulate frames
        for _ in 0..100 {
            loop_obj.tick(0.016);
        }

        assert_eq!(loop_obj.frame_count(), 100);
        assert!(loop_obj.total_time() > 1.5);
    }

    #[test]
    fn test_allocator_reset_performance() {
        let mut alloc = LinearAllocator::new(10000);

        let start = std::time::Instant::now();
        for _ in 0..1000 {
            for _ in 0..10 {
                alloc.allocate(8, 1);
            }
            alloc.reset();
        }
        let elapsed = start.elapsed();

        assert!(elapsed.as_millis() < 500);
    }
}
