#[cfg(test)]
mod tests {
    use crate::buffer::{read_u16_raw, read_u32_raw, write_u16_raw, write_u32_raw};

    #[test]
    fn roundtrip_u32_zero() {
        let mut buf = [0u8; 4];
        write_u32_raw(&mut buf, 0, 0);
        assert_eq!(read_u32_raw(&buf, 0), 0);
    }

    #[test]
    fn roundtrip_u32_max() {
        let mut buf = [0u8; 4];
        write_u32_raw(&mut buf, 0, u32::MAX);
        assert_eq!(read_u32_raw(&buf, 0), u32::MAX);
    }

    #[test]
    fn roundtrip_u32_known_value() {
        let mut buf = [0u8; 8];
        write_u32_raw(&mut buf, 4, 0x12345678);
        assert_eq!(buf[4], 0x78);
        assert_eq!(buf[5], 0x56);
        assert_eq!(buf[6], 0x34);
        assert_eq!(buf[7], 0x12);
        assert_eq!(read_u32_raw(&buf, 4), 0x12345678);
    }

    #[test]
    fn roundtrip_u32_does_not_overflow_neighbors() {
        let mut buf = [0xFFu8; 12];
        write_u32_raw(&mut buf, 4, 0x00000000);
        assert_eq!(&buf[0..4], &[0xFF, 0xFF, 0xFF, 0xFF]);
        assert_eq!(&buf[8..12], &[0xFF, 0xFF, 0xFF, 0xFF]);
        assert_eq!(&buf[4..8], &[0x00, 0x00, 0x00, 0x00]);
    }

    #[test]
    fn roundtrip_u16_zero() {
        let mut buf = [0u8; 2];
        write_u16_raw(&mut buf, 0, 0);
        assert_eq!(read_u16_raw(&buf, 0), 0);
    }

    #[test]
    fn roundtrip_u16_max() {
        let mut buf = [0u8; 2];
        write_u16_raw(&mut buf, 0, u16::MAX);
        assert_eq!(read_u16_raw(&buf, 0), u16::MAX);
    }

    #[test]
    fn u16_little_endian_byte_layout() {
        let mut buf = [0u8; 4];
        write_u16_raw(&mut buf, 0, 0x0102);
        assert_eq!(buf[0], 0x02);
        assert_eq!(buf[1], 0x01);
    }

    #[test]
    fn roundtrip_u16_at_offset() {
        let mut buf = [0u8; 6];
        write_u16_raw(&mut buf, 2, 0xABCD);
        assert_eq!(read_u16_raw(&buf, 2), 0xABCD);
        assert_eq!(&buf[0..2], &[0x00, 0x00]);
        assert_eq!(&buf[4..6], &[0x00, 0x00]);
    }
}
