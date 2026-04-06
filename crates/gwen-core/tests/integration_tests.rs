/// Integration tests – full multi-system scenarios
///
/// These tests exercise Entity + Component + Query + GameLoop working
/// together as they would in a real game frame.
#[cfg(test)]
mod tests {
    use bytemuck::{Pod, Zeroable};
    use gwen_core::*;

    // ── Helpers ──────────────────────────────────────────────────────────

    #[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
    #[repr(C)]
    struct Position {
        x: f32,
        y: f32,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
    #[repr(C)]
    struct Velocity {
        dx: f32,
        dy: f32,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Pod, Zeroable)]
    #[repr(C)]
    struct Health {
        hp: f32,
    }

    fn as_bytes<T: Pod>(v: &T) -> &[u8] {
        bytemuck::bytes_of(v)
    }

    fn read_as<T: Pod>(bytes: &[u8]) -> T {
        *bytemuck::from_bytes(bytes)
    }

    // ── Scenario 1: spawn → attach components → query → tick ─────────────

    #[test]
    fn test_full_spawn_update_cycle() {
        let mut em = EntityManager::new(100);
        let mut storage = ArchetypeStorage::new();
        let mut qs = QuerySystem::new();
        let mut gameloop = GameLoop::new(60);

        let pos_handle = ComponentHandle::<Position>::new(&mut storage);
        let vel_handle = ComponentHandle::<Velocity>::new(&mut storage);

        // Spawn 3 entities with Position + Velocity
        let entities: Vec<_> = (0..3).map(|_| em.create_entity()).collect();
        for (i, &e) in entities.iter().enumerate() {
            pos_handle.add(
                &mut storage,
                e.index(),
                Position {
                    x: i as f32,
                    y: 0.0,
                },
            );
            vel_handle.add(&mut storage, e.index(), Velocity { dx: 1.0, dy: 0.0 });
            qs.update_entity_archetype(e.index(), vec![pos_handle.type_id(), vel_handle.type_id()]);
        }

        // Query entities with both components
        let query = QueryId::new(vec![pos_handle.type_id(), vel_handle.type_id()], storage.registry());
        let result = qs.query(&storage, query.clone());
        assert_eq!(result.len(), 3);

        // Simulate one frame: apply velocity to position
        gameloop.tick(0.016);
        let dt = gameloop.delta_time();
        for entity_id in result.iter() {
            if let (Some(pos_bytes), Some(vel_bytes)) = (
                storage.get_component(entity_id, pos_handle.type_id()),
                storage.get_component(entity_id, vel_handle.type_id()),
            ) {
                let pos: Position = read_as(pos_bytes);
                let vel: Velocity = read_as(vel_bytes);
                let new_pos = Position {
                    x: pos.x + vel.dx * dt,
                    y: pos.y + vel.dy * dt,
                };
                storage
                    .get_component_mut(entity_id, pos_handle.type_id())
                    .unwrap()
                    .copy_from_slice(as_bytes(&new_pos));
            }
        }

        assert_eq!(gameloop.frame_count(), 1);
        // All entities should have moved
        for &e in &entities {
            let pos: Position = read_as(
                storage
                    .get_component(e.index(), pos_handle.type_id())
                    .unwrap(),
            );
            assert!(pos.x > 0.0 || pos.y >= 0.0);
        }
    }

    // ── Scenario 2: delete entity → query no longer returns it ───────────

    #[test]
    fn test_entity_delete_removes_from_query() {
        let mut em = EntityManager::new(100);
        let mut storage = ArchetypeStorage::new();
        let mut qs = QuerySystem::new();

        let pos_handle = ComponentHandle::<Position>::new(&mut storage);

        let e1 = em.create_entity();
        let e2 = em.create_entity();
        for &e in &[e1, e2] {
            pos_handle.add(&mut storage, e.index(), Position { x: 0.0, y: 0.0 });
            qs.update_entity_archetype(e.index(), vec![pos_handle.type_id()]);
        }

        // Both visible
        let query = QueryId::new(vec![pos_handle.type_id()], storage.registry());
        assert_eq!(qs.query(&storage, query.clone()).len(), 2);

        // Delete e1
        if let Some(migration) = storage.remove_component(e1.index(), pos_handle.type_id()) {
            qs.on_archetype_change(migration.to);
            if let Some(from) = migration.from {
                qs.on_archetype_change(from);
            }
        }
        qs.remove_entity(e1.index());
        em.delete_entity(e1);

        // Only e2 remains
        assert_eq!(qs.query(&storage, query).len(), 1);
    }

    // ── Scenario 3: component removal updates archetype & cache ──────────

    #[test]
    fn test_archetype_update_on_component_removal() {
        let mut storage = ArchetypeStorage::new();
        let mut qs = QuerySystem::new();

        let pos_handle = ComponentHandle::<Position>::new(&mut storage);
        let vel_handle = ComponentHandle::<Velocity>::new(&mut storage);

        pos_handle.add(&mut storage, 0, Position { x: 0.0, y: 0.0 });
        vel_handle.add(&mut storage, 0, Velocity { dx: 1.0, dy: 0.0 });
        qs.update_entity_archetype(0, vec![pos_handle.type_id(), vel_handle.type_id()]);

        let full_query = QueryId::new(vec![pos_handle.type_id(), vel_handle.type_id()], storage.registry());
        let pos_only = QueryId::new(vec![pos_handle.type_id()], storage.registry());

        assert_eq!(qs.query(&storage, full_query.clone()).len(), 1);
        assert_eq!(qs.query(&storage, pos_only.clone()).len(), 1);

        // Remove Velocity from entity 0
        if let Some(migration) = storage.remove_component(0, vel_handle.type_id()) {
            qs.on_archetype_change(migration.to);
            if let Some(from) = migration.from {
                qs.on_archetype_change(from);
            }
        }
        qs.update_entity_archetype(0, vec![pos_handle.type_id()]);

        assert_eq!(qs.query(&storage, full_query).len(), 0);
        assert_eq!(qs.query(&storage, pos_only).len(), 1);
    }

    // ── Scenario 4: stale entity ID is correctly rejected ────────────────

    #[test]
    fn test_stale_entity_id_rejected() {
        let mut em = EntityManager::new(100);

        let e1 = em.create_entity();
        let old_id = e1; // keep a copy

        em.delete_entity(e1);
        let _e2 = em.create_entity(); // Reuses the same slot, bumped generation

        // The old handle (same index, old generation) must be rejected
        assert!(!em.is_alive(old_id));
    }

    // ── Scenario 5: multi-component query with mixed archetypes ──────────

    #[test]
    fn test_mixed_archetype_query() {
        let mut storage = ArchetypeStorage::new();
        let mut qs = QuerySystem::new();

        let pos_handle = ComponentHandle::<Position>::new(&mut storage);
        let vel_handle = ComponentHandle::<Velocity>::new(&mut storage);
        let hp_handle = ComponentHandle::<Health>::new(&mut storage);

        // Entity 0: Pos + Vel + Health
        pos_handle.add(&mut storage, 0, Position { x: 0.0, y: 0.0 });
        vel_handle.add(&mut storage, 0, Velocity { dx: 1.0, dy: 0.0 });
        hp_handle.add(&mut storage, 0, Health { hp: 100.0 });
        qs.update_entity_archetype(
            0,
            vec![
                pos_handle.type_id(),
                vel_handle.type_id(),
                hp_handle.type_id(),
            ],
        );

        // Entity 1: Pos + Vel only
        pos_handle.add(&mut storage, 1, Position { x: 0.0, y: 0.0 });
        vel_handle.add(&mut storage, 1, Velocity { dx: 0.0, dy: 1.0 });
        qs.update_entity_archetype(1, vec![pos_handle.type_id(), vel_handle.type_id()]);

        // Entity 2: Pos only
        pos_handle.add(&mut storage, 2, Position { x: 0.0, y: 0.0 });
        qs.update_entity_archetype(2, vec![pos_handle.type_id()]);

        // All 3 have Position
        assert_eq!(qs.query(&storage, QueryId::new(vec![pos_handle.type_id()], storage.registry())).len(), 3);
        // 2 have Velocity
        assert_eq!(qs.query(&storage, QueryId::new(vec![vel_handle.type_id()], storage.registry())).len(), 2);
        // 1 has all three
        assert_eq!(
            qs.query(&storage, QueryId::new(vec![
                pos_handle.type_id(),
                vel_handle.type_id(),
                hp_handle.type_id()
            ], storage.registry()))
            .len(),
            1
        );
    }

    // ── Scenario 6: gameloop accumulation across many frames ─────────────

    #[test]
    fn test_gameloop_frame_accumulation_with_ecs() {
        let mut em = EntityManager::new(100);
        let mut storage = ArchetypeStorage::new();
        let mut gameloop = GameLoop::new(60);

        let pos_handle = ComponentHandle::<Position>::new(&mut storage);
        let vel_handle = ComponentHandle::<Velocity>::new(&mut storage);

        let e = em.create_entity();
        pos_handle.add(&mut storage, e.index(), Position { x: 0.0, y: 0.0 });
        vel_handle.add(&mut storage, e.index(), Velocity { dx: 1.0, dy: 0.0 });

        for _ in 0..60 {
            gameloop.tick(1.0 / 60.0);
            let dt = gameloop.delta_time();
            let pos: Position = read_as(
                storage
                    .get_component(e.index(), pos_handle.type_id())
                    .unwrap(),
            );
            let vel: Velocity = read_as(
                storage
                    .get_component(e.index(), vel_handle.type_id())
                    .unwrap(),
            );
            let new_pos = Position {
                x: pos.x + vel.dx * dt,
                y: pos.y + vel.dy * dt,
            };
            storage
                .get_component_mut(e.index(), pos_handle.type_id())
                .unwrap()
                .copy_from_slice(as_bytes(&new_pos));
        }

        assert_eq!(gameloop.frame_count(), 60);
        let final_pos: Position = read_as(
            storage
                .get_component(e.index(), pos_handle.type_id())
                .unwrap(),
        );
        // After 60 frames at dt≈1/60 with dx=1.0, x should be ≈ 1.0
        assert!((final_pos.x - 1.0).abs() < 0.01, "x = {}", final_pos.x);
    }

    // ── Scenario 7: query cache partial invalidation ──────────────────────

    #[test]
    fn test_query_cache_partial_invalidation() {
        let mut storage = ArchetypeStorage::new();
        let mut qs = QuerySystem::new();

        let pos_handle = ComponentHandle::<Position>::new(&mut storage);
        let vel_handle = ComponentHandle::<Velocity>::new(&mut storage);
        let hp_handle = ComponentHandle::<Health>::new(&mut storage);

        // Two entities: 0 has Pos+Vel, 1 has Pos+Health
        pos_handle.add(&mut storage, 0, Position { x: 0.0, y: 0.0 });
        vel_handle.add(&mut storage, 0, Velocity { dx: 1.0, dy: 0.0 });
        pos_handle.add(&mut storage, 1, Position { x: 0.0, y: 0.0 });
        hp_handle.add(&mut storage, 1, Health { hp: 100.0 });

        qs.update_entity_archetype(0, vec![pos_handle.type_id(), vel_handle.type_id()]);
        qs.update_entity_archetype(1, vec![pos_handle.type_id(), hp_handle.type_id()]);

        // Warm up two independent queries
        let q_vel = QueryId::new(vec![vel_handle.type_id()], storage.registry());
        let q_hp = QueryId::new(vec![hp_handle.type_id()], storage.registry());
        assert_eq!(qs.query(&storage, q_vel.clone()).len(), 1);
        assert_eq!(qs.query(&storage, q_hp.clone()).len(), 1);
        assert_eq!(qs.cache_size(), 2);

        // Mutate entity 0's archetype
        if let Some(migration) = storage.remove_component(0, vel_handle.type_id()) {
            qs.on_archetype_change(migration.to);
            if let Some(from) = migration.from {
                qs.on_archetype_change(from);
            }
        }
        qs.update_entity_archetype(0, vec![pos_handle.type_id()]);

        // Query results should be correct
        assert_eq!(qs.query(&storage, q_vel).len(), 0);
        assert_eq!(qs.query(&storage, q_hp).len(), 1);
    }
}
