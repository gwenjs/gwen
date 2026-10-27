//! Rapier's `unsync-callbacks` feature drops the `Sync` bound on callbacks.
//!
//! Autoref picks `ViaSync` when the type is `Sync`, and `ViaAny` otherwise.
//! The variant is fixed at compile time and read at runtime.

#![cfg(any(feature = "physics2d", feature = "physics3d"))]

use std::marker::PhantomData;

#[derive(Debug, PartialEq, Eq)]
enum Callback {
    Sync,
    NotSync,
}

struct Probe<T: ?Sized>(PhantomData<T>);

trait ViaSync {
    fn kind(&self) -> Callback {
        Callback::Sync
    }
}

impl<T: ?Sized + Sync> ViaSync for Probe<T> {}

trait ViaAny {
    fn kind(&self) -> Callback {
        Callback::NotSync
    }
}

impl<T: ?Sized> ViaAny for &Probe<T> {}

macro_rules! probe {
    ($t:ty) => {{
        let p = Probe::<$t>(PhantomData);
        (&p).kind()
    }};
}

/// The probe reports a `Sync` type as `Sync`. A constant `NotSync` would hide a missing feature.
#[test]
fn probe_reports_a_sync_type_as_sync() {
    assert_eq!(probe!(u32), Callback::Sync);
}

#[cfg(feature = "physics2d")]
#[test]
fn physics2d_event_handler_need_not_be_sync() {
    assert_eq!(
        probe!(dyn rapier2d::pipeline::EventHandler),
        Callback::NotSync,
        "dyn rapier2d::pipeline::EventHandler must not require Sync when the unsync-callbacks Cargo feature is enabled"
    );
}

#[cfg(feature = "physics3d")]
#[test]
fn physics3d_event_handler_need_not_be_sync() {
    assert_eq!(
        probe!(dyn rapier3d::pipeline::EventHandler),
        Callback::NotSync,
        "dyn rapier3d::pipeline::EventHandler must not require Sync when the unsync-callbacks Cargo feature is enabled"
    );
}

#[cfg(feature = "physics2d")]
#[test]
fn physics2d_physics_hooks_need_not_be_sync() {
    assert_eq!(
        probe!(dyn rapier2d::pipeline::PhysicsHooks),
        Callback::NotSync,
        "dyn rapier2d::pipeline::PhysicsHooks must not require Sync when the unsync-callbacks Cargo feature is enabled"
    );
}

#[cfg(feature = "physics3d")]
#[test]
fn physics3d_physics_hooks_need_not_be_sync() {
    assert_eq!(
        probe!(dyn rapier3d::pipeline::PhysicsHooks),
        Callback::NotSync,
        "dyn rapier3d::pipeline::PhysicsHooks must not require Sync when the unsync-callbacks Cargo feature is enabled"
    );
}
