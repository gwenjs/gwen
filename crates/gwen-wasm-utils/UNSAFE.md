# Unsafe sites

This crate has no `unsafe` site. `pnpm check:unsafe` checks this file.

The ring pointer is `&raw const` on the channel static. That does not create a reference, so the old `static_mut_refs` allow is gone. `unsafe_site_u027_ring_ptr_matches_the_static` still checks that the export and the static are the same address.
