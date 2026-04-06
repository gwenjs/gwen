#[cfg(test)]
mod tests {
    use crate::ring::{raw, HEADER_BYTES};

    const STRIDE: usize = 11;

    fn make_ring(n: usize, stride: usize) -> Vec<u8> {
        vec![0u8; HEADER_BYTES + n * stride]
    }

    #[test]
    fn initial_write_head_is_zero() {
        let buf = make_ring(4, STRIDE);
        assert_eq!(raw::write_head(&buf), 0);
    }

    #[test]
    fn initial_read_head_is_zero() {
        let buf = make_ring(4, STRIDE);
        assert_eq!(raw::read_head(&buf), 0);
    }

    #[test]
    fn first_write_offset_points_to_header_end() {
        let buf = make_ring(4, STRIDE);
        let offset = raw::next_write_offset(&buf, STRIDE);
        assert_eq!(offset, Some(HEADER_BYTES));
    }

    #[test]
    fn advance_increments_write_head() {
        let mut buf = make_ring(4, STRIDE);
        raw::advance(&mut buf, STRIDE);
        assert_eq!(raw::write_head(&buf), 1);
    }

    #[test]
    fn advance_wraps_at_capacity() {
        let capacity = 3;
        let mut buf = make_ring(capacity, STRIDE);
        for _ in 0..capacity {
            raw::advance(&mut buf, STRIDE);
        }
        assert_eq!(raw::write_head(&buf), 0);
    }

    #[test]
    fn write_offset_advances_by_stride_each_call() {
        let mut buf = make_ring(4, STRIDE);
        let o0 = raw::next_write_offset(&buf, STRIDE).unwrap();
        raw::advance(&mut buf, STRIDE);
        let o1 = raw::next_write_offset(&buf, STRIDE).unwrap();
        raw::advance(&mut buf, STRIDE);
        let o2 = raw::next_write_offset(&buf, STRIDE).unwrap();
        assert_eq!(o0, HEADER_BYTES);
        assert_eq!(o1, HEADER_BYTES + STRIDE);
        assert_eq!(o2, HEADER_BYTES + 2 * STRIDE);
    }

    #[test]
    fn ring_returns_none_when_full() {
        let capacity = 2;
        let mut buf = make_ring(capacity, STRIDE);
        assert!(raw::next_write_offset(&buf, STRIDE).is_some());
        raw::advance(&mut buf, STRIDE);
        assert_eq!(raw::next_write_offset(&buf, STRIDE), None);
    }

    #[test]
    fn empty_ring_capacity_returns_none() {
        let buf = make_ring(0, STRIDE);
        assert_eq!(raw::next_write_offset(&buf, STRIDE), None);
    }

    #[test]
    fn zero_stride_does_not_panic() {
        let buf = make_ring(4, STRIDE);
        let result = raw::next_write_offset(&buf, 0);
        assert_eq!(result, None);
    }
}
