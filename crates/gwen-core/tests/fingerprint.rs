//! Observable fields of the core ABI fingerprint.

use gwen_core::fingerprint::{
    fnv1a32, gwen_abi_fingerprint, parse_u32, try_parse_u32, FINGERPRINT, GWEN_CORE_ABI_VERSION,
};
use gwen_core::gwen_core_abi;

fn field(fingerprint: &str, index: usize) -> &str {
    fingerprint.split(';').nth(index).unwrap_or_default()
}

#[test]
fn fingerprint_carries_the_abi_number() {
    assert_eq!(field(FINGERPRINT, 0), "gwen-core");
    assert_eq!(FINGERPRINT.split(';').count(), 4);
    assert_eq!(GWEN_CORE_ABI_VERSION, 2);
    assert_eq!(
        field(FINGERPRINT, 2),
        format!("abi={GWEN_CORE_ABI_VERSION}")
    );
}

#[test]
fn fingerprint_names_the_variant_of_this_build() {
    #[cfg(feature = "build-tools")]
    let expected = "variant=build-tools";
    #[cfg(all(feature = "physics3d", not(feature = "build-tools")))]
    let expected = "variant=physics3d";
    #[cfg(feature = "physics2d")]
    let expected = "variant=physics2d";
    #[cfg(not(any(feature = "physics2d", feature = "physics3d")))]
    let expected = "variant=light";
    assert_eq!(field(FINGERPRINT, 1), expected);
}

#[test]
fn export_is_the_fnv1a_of_the_fingerprint() {
    assert_eq!(fnv1a32(b""), 0x811c9dc5);
    assert_eq!(fnv1a32(b"a"), 0xe40c292c);
    assert_eq!(fnv1a32(b"foobar"), 0xbf9cf968);
    assert_eq!(gwen_abi_fingerprint(), fnv1a32(FINGERPRINT.as_bytes()));
}

#[test]
fn a_different_abi_number_changes_the_hash() {
    assert_ne!(
        fnv1a32(b"gwen-core;variant=light;abi=1;profile=release"),
        fnv1a32(b"gwen-core;variant=light;abi=2;profile=release"),
    );
}

#[test]
fn parse_u32_reads_the_macro_value() {
    assert_eq!(try_parse_u32(""), None);
    assert_eq!(try_parse_u32("x"), None);
    assert_eq!(try_parse_u32("12a"), None);
    assert_eq!(try_parse_u32("4294967295"), Some(u32::MAX));
    assert_eq!(try_parse_u32("4294967296"), None);
    assert_eq!(try_parse_u32("99999999999"), None);
    assert_eq!(try_parse_u32("0"), Some(0));
    assert_eq!(try_parse_u32("10"), Some(10));
    assert_eq!(parse_u32(gwen_core_abi!()), GWEN_CORE_ABI_VERSION);
    assert_eq!(parse_u32("0"), 0);
    assert_eq!(parse_u32("4294967295"), u32::MAX);
}

#[test]
fn profile_is_release_without_debug_assertions() {
    #[cfg(debug_assertions)]
    let expected = "profile=dev";
    #[cfg(not(debug_assertions))]
    let expected = "profile=release";
    assert_eq!(field(FINGERPRINT, 3), expected);
}
