# Unsafe sites

Each non-test `unsafe` site in this crate has one id. `pnpm check:unsafe` checks this table.

| id | file::fn | kind | invariant | upheld by | test |
| --- | --- | --- | --- | --- | --- |
| U-001 | src/shared_buffer.rs::alloc | raw-alloc | The layout size is non-zero and the alignment is 8. | `Layout::from_size_align` before the call, and the registry stores that alignment | unsafe_site_u001_records_align_8 |
| U-002 | src/shared_buffer.rs::release | raw-alloc | `ptr` is the address recorded for that byte length, and the layout matches the allocation. | The registry rejects an unknown pointer, a second free, and a wrong length before `dealloc`, then frees with the recorded alignment | unsafe_site_u002_second_free_is_invalid |
| U-003 | src/shared_buffer.rs::bytes_mut | ptr-arith | The returned slice is `min_len` bytes and stays inside the recorded allocation. | The length check returns `InvalidSharedBuffer` before the slice is built | unsafe_site_u003_u32_slots_round_trip |
