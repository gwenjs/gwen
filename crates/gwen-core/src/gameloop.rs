//! Game loop
//!
//! Frame-based orchestration of entity updates and system execution.

use crate::events::EventBus;

/// Frame timing information
#[derive(Debug, Clone, Copy)]
pub struct FrameTiming {
    frame_count: u64,
    total_elapsed: f32,
    frame_delta: f32,
    target_fps: u32,
}

impl FrameTiming {
    /// Create new frame timing
    pub fn new(target_fps: u32) -> Self {
        FrameTiming {
            frame_count: 0,
            total_elapsed: 0.0,
            frame_delta: 0.0,
            target_fps,
        }
    }

    /// Get current frame number
    pub fn frame_count(&self) -> u64 {
        self.frame_count
    }

    /// Get total elapsed time in seconds
    pub fn total_elapsed(&self) -> f32 {
        self.total_elapsed
    }

    /// Get delta time for current frame in seconds
    pub fn frame_delta(&self) -> f32 {
        self.frame_delta
    }

    /// Get target FPS
    pub fn target_fps(&self) -> u32 {
        self.target_fps
    }

    /// Get target frame time in seconds
    pub fn target_frame_time(&self) -> f32 {
        if self.target_fps == 0 {
            0.0
        } else {
            1.0 / (self.target_fps as f32)
        }
    }

    /// Update timing for frame
    fn update(&mut self, delta: f32) {
        self.frame_delta = delta;
        self.total_elapsed += delta;
        self.frame_count += 1;
    }
}

impl Default for FrameTiming {
    fn default() -> Self {
        Self::new(60) // 60 FPS default
    }
}

/// Game loop controller - orchestrates frame updates
pub struct GameLoop {
    timing: FrameTiming,
    event_bus: EventBus,
    accumulated_time: f32,
}

impl GameLoop {
    /// Create a new game loop with target FPS
    pub fn new(target_fps: u32) -> Self {
        GameLoop {
            timing: FrameTiming::new(target_fps),
            event_bus: EventBus::new(),
            accumulated_time: 0.0,
        }
    }

    /// Process a frame with given delta time (in seconds)
    pub fn tick(&mut self, delta_seconds: f32) {
        // Clamp delta to reasonable values
        let delta = delta_seconds.clamp(0.0, 0.1); // Max 100ms per frame

        self.accumulated_time += delta;
        self.timing.update(delta);
    }

    /// Process accumulated events
    pub fn process_events(&mut self) {
        self.event_bus.process_events();
    }

    /// Get current frame timing information
    pub fn timing(&self) -> FrameTiming {
        self.timing
    }

    /// Get frame count
    pub fn frame_count(&self) -> u64 {
        self.timing.frame_count
    }

    /// Get current delta time
    pub fn delta_time(&self) -> f32 {
        self.timing.frame_delta
    }

    /// Get total elapsed time
    pub fn total_time(&self) -> f32 {
        self.timing.total_elapsed
    }

    /// Check if should cap frame
    pub fn should_cap_frame(&self) -> bool {
        let target_frame_time = self.timing.target_frame_time();
        target_frame_time > 0.0 && self.accumulated_time < target_frame_time
    }

    /// Get sleep time needed to hit target FPS (in milliseconds)
    pub fn sleep_time_ms(&self) -> f32 {
        let target_frame_time = self.timing.target_frame_time();
        if target_frame_time == 0.0 {
            return 0.0;
        }

        let sleep_duration = (target_frame_time - self.accumulated_time).max(0.0);
        sleep_duration * 1000.0
    }

    /// Reset accumulated time (call after sleep)
    pub fn reset_frame(&mut self) {
        self.accumulated_time = 0.0;
    }

    /// Get event bus reference
    pub fn event_bus(&self) -> &EventBus {
        &self.event_bus
    }

    /// Get mutable event bus reference
    pub fn event_bus_mut(&mut self) -> &mut EventBus {
        &mut self.event_bus
    }

    /// Check if enough time has passed for next fixed timestep
    pub fn should_fixed_update(&self, fixed_timestep: f32) -> bool {
        self.accumulated_time >= fixed_timestep
    }
}

impl Default for GameLoop {
    fn default() -> Self {
        Self::new(60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_frame_timing_creation() {
        let timing = FrameTiming::new(60);
        assert_eq!(timing.frame_count(), 0);
        assert_eq!(timing.total_elapsed(), 0.0);
        assert_eq!(timing.target_fps(), 60);
    }

    #[test]
    fn test_target_frame_time() {
        let timing = FrameTiming::new(60);
        assert!((timing.target_frame_time() - 1.0 / 60.0).abs() < 0.0001);
    }

    #[test]
    fn test_target_frame_time_zero_fps() {
        let timing = FrameTiming::new(0);
        assert_eq!(timing.target_frame_time(), 0.0);
    }

    #[test]
    fn test_gameloop_creation() {
        let loop_obj = GameLoop::new(60);
        assert_eq!(loop_obj.frame_count(), 0);
        assert_eq!(loop_obj.delta_time(), 0.0);
    }

    #[test]
    fn test_gameloop_tick() {
        let mut loop_obj = GameLoop::new(60);
        loop_obj.tick(0.016); // ~60 FPS

        assert_eq!(loop_obj.frame_count(), 1);
        assert!((loop_obj.delta_time() - 0.016).abs() < 0.0001);
    }

    #[test]
    fn test_gameloop_delta_clamping() {
        let mut loop_obj = GameLoop::new(60);
        loop_obj.tick(1.0); // Very large delta

        // Should be clamped to 0.1
        assert!((loop_obj.delta_time() - 0.1).abs() < 0.0001);
    }

    #[test]
    fn test_gameloop_negative_delta_clamping() {
        let mut loop_obj = GameLoop::new(60);
        loop_obj.tick(-1.0); // Negative delta

        // Should be clamped to 0.0
        assert_eq!(loop_obj.delta_time(), 0.0);
    }

    #[test]
    fn test_gameloop_accumulated_time() {
        let mut loop_obj = GameLoop::new(60);

        loop_obj.tick(0.008);
        assert!((loop_obj.total_time() - 0.008).abs() < 0.0001);

        loop_obj.tick(0.008);
        assert!((loop_obj.total_time() - 0.016).abs() < 0.0001);
    }

    #[test]
    fn test_sleep_time_calculation() {
        let mut loop_obj = GameLoop::new(60);
        let target_frame_time = 1.0 / 60.0;

        loop_obj.tick(target_frame_time / 2.0);
        let sleep_ms = loop_obj.sleep_time_ms();

        // Should be roughly half the target frame time in ms
        let expected_sleep_ms = (target_frame_time / 2.0) * 1000.0;
        assert!((sleep_ms - expected_sleep_ms).abs() < 1.0);
    }

    #[test]
    fn test_fixed_update_timing() {
        let mut loop_obj = GameLoop::new(60);
        let fixed_dt = 0.016; // 16ms fixed timestep

        assert!(!loop_obj.should_fixed_update(fixed_dt));

        loop_obj.tick(0.008);
        assert!(!loop_obj.should_fixed_update(fixed_dt));

        loop_obj.tick(0.008);
        assert!(loop_obj.should_fixed_update(fixed_dt));
    }

    #[test]
    fn test_frame_reset() {
        let mut loop_obj = GameLoop::new(60);
        loop_obj.tick(0.016);

        assert_eq!(loop_obj.frame_count(), 1);
        loop_obj.reset_frame();
        // Frame count should still be 1
        assert_eq!(loop_obj.frame_count(), 1);
    }

    #[test]
    fn test_default_gameloop() {
        let loop_obj = GameLoop::default();
        assert_eq!(loop_obj.timing().target_fps(), 60);
    }
}
