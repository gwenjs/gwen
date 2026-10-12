# Unsafe sites

Each non-test `unsafe` site in this crate has one id. `pnpm check:unsafe` checks this table.

| id | file::fn | kind | invariant | upheld by | test |
| --- | --- | --- | --- | --- | --- |
| U-001 | src/bindings.rs::alloc_shared_buffer | raw-alloc | The layout size is non-zero and the alignment is 8. | `Layout::from_size_align` before the call | unsafe_site_u001_alloc_is_8_byte_aligned |
| U-002 | src/bindings.rs::free_shared_buffer | raw-alloc | `ptr` is the address recorded for that byte length, and the layout matches the allocation. | The registry rejects an unknown pointer, a second free, and a wrong length before `dealloc` | unsafe_site_u002_second_free_is_invalid |
| U-003 | src/bindings.rs::sync_transforms_to_buffer | ptr-arith | `offset + 32` stays inside the recorded allocation. | The length check returns `InvalidSharedBuffer` before the copy | unsafe_site_u003_short_sync_is_invalid |
| U-004 | src/bindings.rs::physics3d_init_navgrid_3d | ffi-ptr | A null or empty grid is not read. Any other call reads `width * height * depth` bytes and does not check that length. | Not checked. The missing check is the physics child of #52 | removed |
| U-005 | src/physics2d/world.rs::CollisionBufPtr | ffi-ptr | The pointer is used only on the thread that called `step`, and it is dropped before `step` returns. | `EventCollector` is built for that step and is not stored | removed |
| U-006 | src/physics2d/world.rs::CollisionBufPtr | ffi-ptr | The same pointer is not shared across threads. | Same step-local collector as U-005 | removed |
| U-007 | src/physics2d/world.rs::handle_collision_event | ffi-ptr | `buf` points at this world's event buffer and is exclusive for the step. | `CollisionEventBuffer::push` stops at `MAX_COLLISION_EVENTS` | unsafe_site_u007_event_buffer_fills_then_clears |
| U-008 | src/physics2d/pathfinding.rs::find_path_2d | static-mut | `count` is at most `MAX_PATH_NODES`, and this function is the only writer. | `path.len().min(MAX_PATH_NODES)` before the write | unsafe_site_u008_path_caps_at_max_nodes |
| U-009 | src/physics2d/pathfinding.rs::find_path_2d | static-mut | Two nodes fit in `PATH_BUFFER`. This function is the only writer. | The stub writes exactly two nodes. `physics2d` enables `pathfinding-2d`, so this branch is not compiled in a feature build | removed |
| U-010 | src/physics3d/world.rs::CollisionBufPtr3D | ffi-ptr | The pointer is used only on the thread that called `step`, and it is dropped before `step` returns. | `EventCollector3D` is built for that step and is not stored | removed |
| U-011 | src/physics3d/world.rs::CollisionBufPtr3D | ffi-ptr | The same pointer is not shared across threads. | Same step-local collector as U-010 | removed |
| U-012 | src/physics3d/world.rs::handle_collision_event | ffi-ptr | `buf` points at this world's event buffer and is exclusive for the step. | `CollisionEventBuffer3D::push` stops at `MAX_COLLISION_EVENTS_3D` | unsafe_site_u012_event_buffer_fills_then_clears |
| U-013 | src/physics3d/world.rs::overlap_shape | ffi-ptr | `out_ptr` is used as `max_results` u32 slots. This export does not check that length. | The composable caps the count at the scratch view in `spatial-queries.ts`. A raw call is the physics child of #52 | removed |
| U-014 | src/physics3d/world.rs::write_no_hit | ptr-arith | `buf` is `cc_state` and `base` is one controller slot inside it. | `base` is `slot * CC_STATE_STRIDE` and `slot` comes from the controller map | removed |
| U-015 | src/physics3d/world.rs::write_no_hit | ptr-arith | The five writes stay inside that slot. | `CC_STATE_STRIDE` is 5 and `base + 4` is the last index of the slot | removed |
| U-016 | src/physics3d/world.rs::character_controller_move | ptr-arith | `cc_state` is this world's buffer and `base` is one controller slot. | Same slot math as U-014, on the missing-body path | removed |
| U-017 | src/physics3d/world.rs::character_controller_move | ptr-arith | `cc_state` is this world's buffer and `base` is one controller slot. | Same slot math as U-014, on the missing-controller path | removed |
| U-018 | src/physics3d/world.rs::character_controller_move | ptr-arith | `cc_state` is this world's buffer and `base` is one controller slot. | Same slot math as U-014, on the missing-rigid-body path | removed |
| U-019 | src/physics3d/world.rs::character_controller_move | ptr-arith | `cc_state` is this world's buffer and `base` is one controller slot. | Same slot math as U-014, on the missing-collider path | removed |
| U-020 | src/physics3d/world.rs::character_controller_move | ptr-arith | `cc_state` is this world's buffer and `base` is one controller slot. | Same slot math as U-014, when the collider handle is absent from the set | removed |
| U-021 | src/physics3d/world.rs::character_controller_move | ptr-arith | `cc_state` is this world's buffer and `base` is one controller slot. | Same slot math as U-014, when the body disappears after the move | removed |
| U-022 | src/physics3d/world.rs::character_controller_move | ptr-arith | `cc_state` is this world's buffer and `base` is one controller slot. | Same slot math as U-014, on the grounded path | removed |
| U-023 | src/physics3d/world.rs::character_controller_move | ptr-arith | `cc_state` is this world's buffer and `base` is one controller slot. | Same slot math as U-014, when the move is not grounded | removed |
| U-024 | src/physics3d/pathfinding.rs::init_navgrid_3d | ffi-ptr | A null pointer or a zero cell count stores no grid and does not read. Otherwise the function reads `width * height * depth` bytes and does not check that length. | Not checked. The missing check is the physics child of #52 | removed |
| U-025 | src/physics3d/pathfinding.rs::init_navgrid_3d | ffi-ptr | After the null and zero checks, `ptr` is read for `len` bytes. | Same unchecked length as U-024 | removed |
| U-026 | src/physics3d/pathfinding.rs::install_navgrid | ffi-ptr | The test wrapper forwards the same pointer contract as `init_navgrid_3d`. | `install_navgrid` is `cfg(test)` and calls U-024 | removed |
