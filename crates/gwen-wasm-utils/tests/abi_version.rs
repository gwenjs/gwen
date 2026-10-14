//! `gwen_plugin_abi!` emits `gwen_plugin_api_version` and returns the crate constant.

mod declared {
    gwen_wasm_utils::gwen_plugin_abi!();
}

#[test]
fn gwen_plugin_abi_returns_the_crate_constant() {
    assert_eq!(
        declared::gwen_plugin_api_version(),
        gwen_wasm_utils::GWEN_PLUGIN_API_VERSION
    );
}
