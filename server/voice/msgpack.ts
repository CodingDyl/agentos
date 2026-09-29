/**
 * A small MessagePack encoder, for the one thing that needs it: Fish Audio's
 * official SDK sends both `/v1/tts` and `/v1/asr` as `application/msgpack`, and
 * `/v1/asr` takes the audio as a binary field, which JSON cannot carry.
 *
 * Encode only, and only the types a request needs: null, booleans, numbers,
 * strings, binary, arrays and plain objects. It writes the shortest form, the
 * same as the library the SDK uses, and is checked byte-for-byte against it in
 * the tests.
 */

export type MsgpackValue = null | undefined | boolean | number | string | Uint8Array | MsgpackValue[] | { [key: string]: MsgpackValue };

/**
 * The length prefix for strings, binary, arrays and maps: a single byte when
 * the length fits the "fix" form, otherwise a tag followed by 1, 2 or 4 bytes.
 */
function header(length: number, fix: { max: number; base: number }, widths: [number, number][]): Buffer {
  if (length <= fix.max) return Buffer.from([fix.base | length]);

  for (const [limit, tag] of widths) {
    if (length > limit) continue;
    const size = limit === 0xff ? 1 : limit === 0xffff ? 2 : 4;
    const head = Buffer.alloc(1 + size);
    head[0] = tag;
    if (size === 1) head.writeUInt8(length, 1);
    else if (size === 2) head.writeUInt16BE(length, 1);
    else head.writeUInt32BE(length, 1);
    return head;
  }

  throw new RangeError("Value too large for MessagePack");
}

function encodeInteger(value: number): Buffer {
  if (value >= 0) {
    if (value <= 0x7f) return Buffer.from([value]);
    if (value <= 0xff) return Buffer.from([0xcc, value]);
    if (value <= 0xffff) {
      const buffer = Buffer.alloc(3);
      buffer[0] = 0xcd;
      buffer.writeUInt16BE(value, 1);
      return buffer;
    }
    if (value <= 0xffffffff) {
      const buffer = Buffer.alloc(5);
      buffer[0] = 0xce;
      buffer.writeUInt32BE(value, 1);
      return buffer;
    }
    const buffer = Buffer.alloc(9);
    buffer[0] = 0xcf;
    buffer.writeBigUInt64BE(BigInt(value), 1);
    return buffer;
  }

  if (value >= -32) return Buffer.from([value & 0xff]);
  if (value >= -0x80) return Buffer.from([0xd0, value & 0xff]);
  if (value >= -0x8000) {
    const buffer = Buffer.alloc(3);
    buffer[0] = 0xd1;
    buffer.writeInt16BE(value, 1);
    return buffer;
  }
  if (value >= -0x80000000) {
    const buffer = Buffer.alloc(5);
    buffer[0] = 0xd2;
    buffer.writeInt32BE(value, 1);
    return buffer;
  }
  const buffer = Buffer.alloc(9);
  buffer[0] = 0xd3;
  buffer.writeBigInt64BE(BigInt(value), 1);
  return buffer;
}

function encodeValue(value: MsgpackValue, out: Buffer[]): void {
  if (value === null || value === undefined) {
    out.push(Buffer.from([0xc0]));
  } else if (typeof value === "boolean") {
    out.push(Buffer.from([value ? 0xc3 : 0xc2]));
  } else if (typeof value === "number") {
    if (Number.isInteger(value)) {
      out.push(encodeInteger(value));
    } else {
      const buffer = Buffer.alloc(9);
      buffer[0] = 0xcb;
      buffer.writeDoubleBE(value, 1);
      out.push(buffer);
    }
  } else if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    out.push(header(bytes.length, { max: 31, base: 0xa0 }, [[0xff, 0xd9], [0xffff, 0xda], [0xffffffff, 0xdb]]), bytes);
  } else if (value instanceof Uint8Array) {
    // Binary has no "fix" form: the smallest is bin8.
    out.push(header(value.length, { max: -1, base: 0 }, [[0xff, 0xc4], [0xffff, 0xc5], [0xffffffff, 0xc6]]), Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  } else if (Array.isArray(value)) {
    out.push(header(value.length, { max: 15, base: 0x90 }, [[0xffff, 0xdc], [0xffffffff, 0xdd]]));
    for (const item of value) encodeValue(item, out);
  } else {
    const entries = Object.entries(value);
    out.push(header(entries.length, { max: 15, base: 0x80 }, [[0xffff, 0xde], [0xffffffff, 0xdf]]));
    for (const [key, item] of entries) {
      encodeValue(key, out);
      encodeValue(item, out);
    }
  }
}

export function encodeMsgpack(value: MsgpackValue): Buffer {
  const out: Buffer[] = [];
  encodeValue(value, out);
  return Buffer.concat(out);
}
