# Unsafe sites

Each non-test `unsafe` site in this crate has one id. `pnpm check:unsafe` checks this table.

| id | file::fn | kind | invariant | upheld by | test |
| --- | --- | --- | --- | --- | --- |
| U-027 | src/channel.rs::__gwen_channel_inner | static-mut | The macro takes the address of the zeroed channel with `&raw const` and does not create a reference. | `RingWriter` bounds-checks later writes | unsafe_site_u027_ring_ptr_matches_the_static |
