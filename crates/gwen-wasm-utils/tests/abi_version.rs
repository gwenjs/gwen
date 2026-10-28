//! One module declares both macros. A channel arm that also emitted
//! `gwen_plugin_api_version` would be a second definition of that function.

mod declared {
    gwen_wasm_utils::gwen_channel!(events, 8, 4);
    gwen_wasm_utils::gwen_plugin_abi!();
}

#[test]
fn one_module_calls_the_abi_version_and_a_channel_export() {
    assert_eq!(gwen_wasm_utils::GWEN_PLUGIN_API_VERSION, 2_001_000);
    assert_eq!(
        declared::gwen_plugin_api_version(),
        gwen_wasm_utils::GWEN_PLUGIN_API_VERSION
    );
    assert_eq!(declared::gwen_events_ring_cap(), 8);
}
