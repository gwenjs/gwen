use wasm_bindgen::prelude::wasm_bindgen;

#[macro_export]
macro_rules! gwen_core_abi {
    () => {
        "1"
    };
}

pub const GWEN_CORE_ABI_VERSION: u32 = 0;
pub const FINGERPRINT: &str = "";

pub const fn fnv1a32(_: &[u8]) -> u32 {
    0
}

pub const fn try_parse_u32(_: &str) -> Option<u32> {
    Some(0)
}

pub const fn parse_u32(_: &str) -> u32 {
    0
}

#[wasm_bindgen]
pub fn gwen_abi_fingerprint() -> u32 {
    1
}
