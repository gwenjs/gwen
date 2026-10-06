/**
 * Hand-written community module. WAT:
 *
 * (module
 *   (import "gwen" "transform_buffer_ptr" (func $ptr (result i32)))
 *   (memory (export "memory") 1)
 *   (global $x (mut f32) (f32.const 0))
 *   (global $y (mut f32) (f32.const 0))
 *   (func (export "step") (param $dt f32)
 *     (global.set $x (f32.load (call $ptr)))
 *     (global.set $y (f32.load offset=4 (call $ptr))))
 *   (func (export "read_x") (result f32) (global.get $x))
 *   (func (export "read_y") (result f32) (global.get $y))
 *   (func (export "ptr") (result i32) (call $ptr))
 *   (func (export "scribble")
 *     (local $i i32)
 *     (local.set $i (i32.const 1024))
 *     (loop
 *       (f32.store (local.get $i) (f32.const 999))
 *       (local.set $i (i32.add (local.get $i) (i32.const 4)))
 *       (br_if 0 (i32.lt_u (local.get $i) (i32.const 3072)))))
 *   (func (export "grow") (result i32) (memory.grow (i32.const 1))))
 *
 * Export-form variant adds:
 *   (func (export "gwen_transforms_ptr") (result i32) (i32.const 1024))
 *
 * Start-cache variant:
 *   (global $cached (mut i32) (i32.const 0))
 *   (func $start (global.set $cached (call $ptr)))
 *   (start $start)
 *   (func (export "cached_ptr") (result i32) (global.get $cached))
 *   (func (export "ptr") (result i32) (call $ptr))
 *   (func (export "gwen_transforms_ptr") (result i32) (i32.const 1024))
 *
 * No-memory variant is `(module)`.
 */

const READER_HEX =
  "0061736d010000000110046000017f60017d006000017d600000021d01046777656e147472616e73666f726d5f6275666665725f707472000003070601020200030005030100010611027d0143000000000b7d0143000000000b073b07066d656d6f727902000473746570000106726561645f78000206726561645f790003037074720004087363726962626c6500050467726f7700060a4e06100010002a0200240010002a020424010b040023000b040023010b040010000b2501017f4180082100034020004300c07944380200200041046a21002000418018490d000b0b0600410140000b";

const EXPORT_HEX =
  "0061736d010000000110046000017f60017d006000017d600000021d01046777656e147472616e73666f726d5f6275666665725f70747200000308070102020003000005030100010611027d0143000000000b7d0143000000000b075108066d656d6f727902000473746570000106726561645f78000206726561645f790003037074720004087363726962626c6500050467726f770006136777656e5f7472616e73666f726d735f70747200070a5407100010002a0200240010002a020424010b040023000b040023010b040010000b2501017f4180082100034020004300c07944380200200041046a21002000418018490d000b0b0600410140000b05004180080b";

const START_HEX =
  "0061736d010000000108026000017f600000021d01046777656e147472616e73666f726d5f6275666665725f70747200000305040100000005030100010606017f0141000b073304066d656d6f727902000a6361636865645f7074720002037074720003136777656e5f7472616e73666f726d735f70747200040801010a18040600100024000b040023000b040010000b05004180080b";

function bytesFromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export const TRANSFORM_READER_WASM = bytesFromHex(READER_HEX);
export const TRANSFORM_READER_EXPORT_WASM = bytesFromHex(EXPORT_HEX);
export const TRANSFORM_READER_START_WASM = bytesFromHex(START_HEX);
export const NO_MEMORY_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

export function wasmDataUrl(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:application/wasm;base64,${btoa(binary)}`;
}
