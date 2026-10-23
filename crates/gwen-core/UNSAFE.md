# Unsafe sites

Each non-test `unsafe` site in this crate has one id. `pnpm check:unsafe` checks this table.

| id | file::fn | kind | invariant | upheld by | test |
| --- | --- | --- | --- | --- | --- |
| U-001 | src/shared_buffer.rs::alloc | raw-alloc | The layout size is non-zero and the alignment is 8. | `Layout::from_size_align` before the call, and the registry stores that alignment | unsafe_site_u001_records_align_8 |
| U-002 | src/shared_buffer.rs::release | raw-alloc | `ptr` is the address recorded for that byte length, and the layout matches the allocation. | The registry rejects an unknown pointer, a second free, and a wrong length before `dealloc`, then frees with the recorded alignment | unsafe_site_u002_second_free_is_invalid |
| U-003 | src/shared_buffer.rs::bytes_mut | ptr-arith | The returned slice is `min_len` bytes and stays inside the recorded allocation. | The length check returns `InvalidSharedBuffer` before the slice is built | unsafe_site_u003_u32_slots_round_trip |
| U-004 | src/bindings.rs::physics3d_init_navgrid_3d | ffi-ptr | A null pointer is not read. Any other call reads `width * height * depth` bytes from `ptr`. | The cell count is validated (no zero dimension, `checked_mul`, at most `MAX_NAVGRID_CELLS`) before the read. The address cannot be checked: it comes from `__wbindgen_malloc`, which keeps no record this crate can read, so the caller must pass an address that holds that many bytes. | unsafe_site_u004_export_copies_cells |
| U-008 | src/physics2d/pathfinding.rs::find_path_2d | static-mut | `PATH_BUFFER` is a static mut written only by this function, and the write finishes before a caller reads it. | This function is the only writer of that static. | unsafe_site_u008_path_caps_at_max_nodes |
| U-024 | src/physics3d/pathfinding.rs::init_navgrid_3d | ffi-ptr | A null pointer stores no grid and does not read. Otherwise the function reads `width * height * depth` bytes. | The cell count is validated and capped before the read. The address is not checked: the caller must pass an address that holds that many bytes. | unsafe_site_u024_null_or_empty_stores_no_grid |
| U-025 | src/physics3d/pathfinding.rs::init_navgrid_3d | ffi-ptr | After the null check, `ptr` is read for `len` bytes. | `len` comes from `navgrid_cell_count`, which refuses a zero, overflowing or oversized count. The address is not checked. | unsafe_site_u025_read_copies_cells |
| U-026 | src/physics3d/pathfinding.rs::install_navgrid | ffi-ptr | The test wrapper forwards the same validated count as `init_navgrid_3d`. | The count is validated and capped by `init_navgrid_3d`. The test passes the address of a buffer that holds that many bytes. | unsafe_site_u026_install_copies_cells |
