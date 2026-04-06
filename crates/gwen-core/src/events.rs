//! Event bus
//!
//! Pub/sub event system for entity events.

use std::any::{Any, TypeId};
use std::collections::HashMap;

/// Trait for all events
pub trait Event: 'static {
    /// Cast to Any for downcasting
    fn as_any(&self) -> &dyn Any;
}

/// Type alias for event handlers
type EventHandler = Box<dyn Fn(&dyn Any)>;

/// Event bus - pub/sub system for events
pub struct EventBus {
    handlers: HashMap<TypeId, Vec<EventHandler>>,
    queue: Vec<Box<dyn Event>>,
}

impl EventBus {
    /// Create a new event bus
    pub fn new() -> Self {
        EventBus {
            handlers: HashMap::new(),
            queue: Vec::new(),
        }
    }

    /// Subscribe to an event type
    pub fn subscribe<E: Event>(&mut self, handler: impl Fn(&E) + 'static) {
        let type_id = TypeId::of::<E>();

        let wrapped: EventHandler = Box::new(move |event: &dyn Any| {
            if let Some(e) = event.downcast_ref::<E>() {
                handler(e);
            }
        });

        self.handlers.entry(type_id).or_default().push(wrapped);
    }

    /// Emit an event (queues for processing)
    pub fn emit<E: Event>(&mut self, event: E) {
        self.queue.push(Box::new(event));
    }

    /// Process all queued events
    pub fn process_events(&mut self) {
        let events = std::mem::take(&mut self.queue);

        for event in events {
            let type_id = event.as_any().type_id();

            if let Some(handlers) = self.handlers.get(&type_id) {
                for handler in handlers {
                    handler(event.as_any());
                }
            }
        }
    }

    /// Get count of handlers for event type
    pub fn handler_count<E: Event>(&self) -> usize {
        let type_id = TypeId::of::<E>();
        self.handlers.get(&type_id).map(|h| h.len()).unwrap_or(0)
    }

    /// Get count of queued events
    pub fn queue_size(&self) -> usize {
        self.queue.len()
    }

    /// Clear all queued events
    pub fn clear_queue(&mut self) {
        self.queue.clear();
    }

    /// Remove all handlers for event type
    pub fn unsubscribe_all<E: Event>(&mut self) {
        let type_id = TypeId::of::<E>();
        self.handlers.remove(&type_id);
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, PartialEq)]
    struct TestEvent {
        value: i32,
    }

    impl Event for TestEvent {
        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    #[derive(Debug, Clone)]
    struct OtherEvent {
        #[allow(dead_code)]
        name: String,
    }

    impl Event for OtherEvent {
        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    #[test]
    fn test_handler_count_single() {
        let mut bus = EventBus::new();
        bus.subscribe::<TestEvent>(|_: &TestEvent| {});
        assert_eq!(bus.handler_count::<TestEvent>(), 1);
    }

    #[test]
    fn test_handler_count_multiple() {
        let mut bus = EventBus::new();

        bus.subscribe::<TestEvent>(|_: &TestEvent| {});
        bus.subscribe::<TestEvent>(|_: &TestEvent| {});
        bus.subscribe::<TestEvent>(|_: &TestEvent| {});
        assert_eq!(bus.handler_count::<TestEvent>(), 3);
    }

    #[test]
    fn test_multiple_event_types_handlers() {
        let mut bus = EventBus::new();

        bus.subscribe::<TestEvent>(|_: &TestEvent| {});
        bus.subscribe::<TestEvent>(|_: &TestEvent| {});
        bus.subscribe::<OtherEvent>(|_: &OtherEvent| {});

        assert_eq!(bus.handler_count::<TestEvent>(), 2);
        assert_eq!(bus.handler_count::<OtherEvent>(), 1);
    }

    #[test]
    fn test_event_queue_size() {
        let mut bus = EventBus::new();

        assert_eq!(bus.queue_size(), 0);

        bus.emit(TestEvent { value: 1 });
        assert_eq!(bus.queue_size(), 1);

        bus.emit(TestEvent { value: 2 });
        bus.emit(TestEvent { value: 3 });
        assert_eq!(bus.queue_size(), 3);
    }

    #[test]
    fn test_clear_queue() {
        let mut bus = EventBus::new();

        bus.emit(TestEvent { value: 1 });
        bus.emit(TestEvent { value: 2 });
        assert_eq!(bus.queue_size(), 2);

        bus.clear_queue();
        assert_eq!(bus.queue_size(), 0);
    }

    #[test]
    fn test_unsubscribe_all() {
        let mut bus = EventBus::new();

        bus.subscribe::<TestEvent>(|_: &TestEvent| {});
        bus.subscribe::<TestEvent>(|_: &TestEvent| {});
        assert_eq!(bus.handler_count::<TestEvent>(), 2);

        bus.unsubscribe_all::<TestEvent>();
        assert_eq!(bus.handler_count::<TestEvent>(), 0);
    }

    #[test]
    fn test_process_empty_queue() {
        let mut bus = EventBus::new();
        bus.subscribe::<TestEvent>(|_: &TestEvent| {});
        bus.process_events(); // Should not panic
        assert_eq!(bus.queue_size(), 0);
    }

    #[test]
    fn test_process_events_with_no_handlers() {
        let mut bus = EventBus::new();

        bus.emit(TestEvent { value: 1 });
        bus.emit(TestEvent { value: 2 });
        assert_eq!(bus.queue_size(), 2);

        bus.process_events();
        assert_eq!(bus.queue_size(), 0);
    }

    #[test]
    fn test_default_creation() {
        let bus = EventBus::default();
        assert_eq!(bus.queue_size(), 0);
    }

    #[test]
    fn test_multiple_events_different_types() {
        let mut bus = EventBus::new();

        bus.emit(TestEvent { value: 1 });
        bus.emit(OtherEvent {
            name: "test".to_string(),
        });
        bus.emit(TestEvent { value: 2 });

        assert_eq!(bus.queue_size(), 3);

        bus.process_events();
        assert_eq!(bus.queue_size(), 0);
    }
}
