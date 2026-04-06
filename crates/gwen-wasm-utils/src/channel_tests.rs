//! Tests for the `gwen_channel!()` macro.

#[cfg(test)]
#[allow(static_mut_refs)]
mod tests {
    use crate::gwen_channel;

    /// Verify the generated static buffer has the correct size:
    /// `HEADER_BYTES (8) + capacity (4) * item_size (8) = 40` bytes.
    #[test]
    fn static_buffer_size_equals_header_plus_slots() {
        use crate::ring::HEADER_BYTES;
        gwen_channel!(ping, 4, 8);
        let expected = HEADER_BYTES + 4 * 8;
        let actual = unsafe { GWEN_CHANNEL_PING.len() };
        assert_eq!(actual, expected, "buffer must be HEADER_BYTES + capacity * item_size");
    }

    /// Verify the ptr export returns a non-zero address
    /// (not address 0 which is the WASM shadow stack).
    #[test]
    fn ring_ptr_is_nonzero() {
        gwen_channel!(events, 16, 12);
        let ptr = gwen_events_ring_ptr();
        assert_ne!(ptr, 0, "ptr must point into the data segment, never address 0");
    }

    /// Verify cap and item_size exports match the macro arguments.
    #[test]
    fn ring_cap_and_item_size_match_macro_args() {
        gwen_channel!(cmds, 32, 20);
        assert_eq!(gwen_cmds_ring_cap(), 32, "ring_cap must match macro capacity arg");
        assert_eq!(gwen_cmds_ring_item_size(), 20, "ring_item_size must match macro item_size arg");
    }

    /// Verify that `version = N` generates `gwen_plugin_api_version()`.
    #[test]
    fn version_export_is_generated_when_requested() {
        gwen_channel!(versioned, 8, 4, version = 1_000_002);
        assert_eq!(gwen_plugin_api_version(), 1_000_002, "version must be encoded as major * 1_000_000 + minor * 1_000 + patch");
    }

    /// Verify that two channels have distinct addresses.
    #[test]
    fn two_channels_have_distinct_addresses() {
        gwen_channel!(alpha, 4, 8);
        gwen_channel!(beta, 4, 8);
        let a = gwen_alpha_ring_ptr() as usize;
        let b = gwen_beta_ring_ptr() as usize;
        assert_ne!(a, b, "two channels must not share the same address");
    }
}
