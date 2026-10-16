#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]
#[cfg(test)]
mod tests {
    use gwen_core::*;

    // === Edge Cases ===

    #[test]
    fn test_entity_manager_max_capacity() {
        let mut em = EntityManager::new(10);

        // Allocate max entities
        for _ in 0..10 {
            em.create_entity().expect("entity limit");
        }
        assert_eq!(em.count_entities(), 10);
    }

    #[test]
    fn test_entity_manager_exceeds_capacity() {
        let mut em = EntityManager::new(5);

        for _ in 0..5 {
            em.create_entity().expect("entity limit");
        }

        let err = em
            .create_entity()
            .expect_err("6th create must hit the entity limit");
        assert_eq!(err, EcsError::EntityLimitReached { max: 5 });
        assert!(
            err.to_string().contains("limit"),
            "display must contain the word limit, got {err}"
        );
        assert_eq!(em.count_entities(), 5);
        assert!(em.is_alive(EntityId::from_parts(0, 0)));
    }

    #[test]
    fn test_entity_manager_reuses_free_slot_then_hits_limit() {
        let mut em = EntityManager::new(5);
        let mut ids = Vec::new();
        for _ in 0..5 {
            ids.push(em.create_entity().expect("entity limit"));
        }

        assert!(em.delete_entity(ids[0]));
        let reused = em.create_entity().expect("entity limit");
        assert_eq!(reused.index(), ids[0].index());

        assert_eq!(
            em.create_entity(),
            Err(EcsError::EntityLimitReached { max: 5 })
        );
        assert_eq!(em.count_entities(), 5);
    }

    // === Error Handling ===

    #[test]
    fn test_delete_already_deleted_entity() {
        let mut em = EntityManager::new(100);

        let e = em.create_entity().expect("entity limit");
        assert!(em.delete_entity(e));
        assert!(!em.delete_entity(e)); // Second delete fails
    }

    #[test]
    fn test_entity_reuse_across_frames() {
        let mut em = EntityManager::new(100);

        let e1 = em.create_entity().expect("entity limit");

        em.delete_entity(e1);
        let e2 = em.create_entity().expect("entity limit");

        // Should have reused slot
        assert_eq!(e1.index(), e2.index());
    }

    // === Stress Tests ===

    #[test]
    fn test_1k_entity_lifecycle() {
        let mut em = EntityManager::new(10000);

        let mut entities = Vec::new();
        for _ in 0..1000 {
            entities.push(em.create_entity().expect("entity limit"));
        }

        assert_eq!(em.count_entities(), 1000);

        for e in entities {
            em.delete_entity(e);
        }

        assert_eq!(em.count_entities(), 0);
    }
}
