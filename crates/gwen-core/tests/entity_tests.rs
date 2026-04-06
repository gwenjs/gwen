#[cfg(test)]
mod tests {
    use gwen_core::entity::{EntityId, EntityManager};

    #[test]
    fn test_allocate_sequential() {
        let mut em = EntityManager::new(100);

        let e1 = em.create_entity();
        let e2 = em.create_entity();
        let e3 = em.create_entity();

        assert_eq!(e1.index(), 0);
        assert_eq!(e2.index(), 1);
        assert_eq!(e3.index(), 2);
        assert_eq!(e1.generation(), 0);
        assert_eq!(em.count_entities(), 3);
    }

    #[test]
    fn test_deallocate_and_reuse() {
        let mut em = EntityManager::new(100);

        let _e1 = em.create_entity();
        let e2 = em.create_entity();
        let _e3 = em.create_entity();

        assert!(em.delete_entity(e2));
        assert!(!em.is_alive(e2));
        assert_eq!(em.count_entities(), 2);

        // Allocate should reuse e2's slot
        let e4 = em.create_entity();
        assert_eq!(e4.index(), e2.index());
        assert_eq!(e4.generation(), e2.generation() + 1);
    }

    #[test]
    fn test_stale_id_detection() {
        let mut em = EntityManager::new(100);

        let e1 = em.create_entity();
        let old_id = e1;

        em.delete_entity(e1);

        // Old ID should be detected as stale
        assert!(!em.is_alive(old_id));

        // Reuse slot - generation increments
        let e2 = em.create_entity();
        assert_eq!(e2.index(), old_id.index());
        assert_ne!(e2.generation(), old_id.generation());
    }

    #[test]
    fn test_is_alive() {
        let mut em = EntityManager::new(100);

        let e1 = em.create_entity();
        assert!(em.is_alive(e1));

        em.delete_entity(e1);
        assert!(!em.is_alive(e1));
    }

    #[test]
    fn test_count_entities() {
        let mut em = EntityManager::new(100);

        assert_eq!(em.count_entities(), 0);

        let _e1 = em.create_entity();
        assert_eq!(em.count_entities(), 1);

        let _e2 = em.create_entity();
        assert_eq!(em.count_entities(), 2);

        let e3 = em.create_entity();
        assert_eq!(em.count_entities(), 3);

        em.delete_entity(e3);
        assert_eq!(em.count_entities(), 2);
    }

    #[test]
    fn test_iter_entities() {
        let mut em = EntityManager::new(100);

        let e1 = em.create_entity();
        let e2 = em.create_entity();
        let e3 = em.create_entity();

        em.delete_entity(e2);

        let ids: Vec<_> = em.iter_entities().collect();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&e1));
        assert!(ids.contains(&e3));
        assert!(!ids.contains(&e2));
    }

    #[test]
    fn test_allocate_10k() {
        let mut em = EntityManager::new(10000);

        let start = std::time::Instant::now();
        for _ in 0..10000 {
            let _ = em.create_entity();
        }
        let elapsed = start.elapsed();

        assert_eq!(em.count_entities(), 10000);
        assert!(
            elapsed.as_millis() < 100,
            "10K allocations took {}ms",
            elapsed.as_millis()
        );
    }

    #[test]
    fn test_deallocate_1k() {
        let mut em = EntityManager::new(10000);

        let entities: Vec<_> = (0..1000).map(|_| em.create_entity()).collect();

        let start = std::time::Instant::now();
        for e in entities {
            em.delete_entity(e);
        }
        let elapsed = start.elapsed();

        assert_eq!(em.count_entities(), 0);
        assert!(
            elapsed.as_millis() < 50,
            "1K deallocations took {}ms",
            elapsed.as_millis()
        );
    }

    #[test]
    fn test_mixed_allocate_deallocate() {
        let mut em = EntityManager::new(10000);

        let mut entities = Vec::new();

        // Allocate 1000
        for _ in 0..1000 {
            entities.push(em.create_entity());
        }
        assert_eq!(em.count_entities(), 1000);

        // Delete first 500
        for &e in &entities[0..500] {
            em.delete_entity(e);
        }
        assert_eq!(em.count_entities(), 500);

        // Allocate 500 more (should reuse slots)
        for _ in 0..500 {
            entities.push(em.create_entity());
        }
        assert_eq!(em.count_entities(), 1000);
    }

    #[test]
    fn test_invalid_entity_id() {
        let mut em = EntityManager::new(100);

        let invalid = EntityId::from_parts(9999, 0);

        assert!(!em.is_alive(invalid));
        assert!(!em.delete_entity(invalid));
    }

    #[test]
    fn test_double_delete() {
        let mut em = EntityManager::new(100);

        let e = em.create_entity();
        assert!(em.delete_entity(e));
        assert!(!em.delete_entity(e)); // Second delete should fail
    }
}
