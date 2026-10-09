#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable,
    clippy::todo,
    clippy::unimplemented,
    reason = "test-only code"
)]
use gwen_core::bindings::Engine;

#[test]
fn stats_json_omits_frame_and_elapsed() {
    let mut engine = match Engine::new(4) {
        Ok(engine) => engine,
        Err(err) => {
            assert_eq!(err.code(), "created");
            return;
        }
    };
    assert_eq!(engine.stats(), "{\"entities\":0}");

    match engine.create_entity() {
        Ok(_) => {}
        Err(err) => {
            assert_eq!(err.code(), "created");
            return;
        }
    }
    assert_eq!(engine.stats(), "{\"entities\":1}");
}
