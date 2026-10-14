/**
 * A stored (uncompressed) ZIP, for "Download selected".
 *
 * Images and video are already compressed, so compressing again would only
 * spend time. Names are the caller's and must already be safe basenames.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(data: Uint8Array): number {
  let value = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    value = CRC_TABLE[(value ^ data[index]) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; day: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function u16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function u32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

export function uniqueZipName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }

  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  let suffix = 2;
  while (used.has(`${stem}-${suffix}${ext}`)) suffix += 1;
  const next = `${stem}-${suffix}${ext}`;
  used.add(next);
  return next;
}

export function buildZip(entries: readonly ZipEntry[], now = new Date()): Uint8Array {
  const { time, day } = dosDateTime(now);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const checksum = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30);
    u32(local, 0, 0x04034b50);
    u16(local, 4, 20);
    u16(local, 6, 0x0800);
    u16(local, 8, 0);
    u16(local, 10, time);
    u16(local, 12, day);
    u32(local, 14, checksum);
    u32(local, 18, size);
    u32(local, 22, size);
    u16(local, 26, name.length);
    u16(local, 28, 0);
    locals.push(local, name, entry.data);

    const central = new Uint8Array(46);
    u32(central, 0, 0x02014b50);
    u16(central, 4, 20);
    u16(central, 6, 20);
    u16(central, 8, 0x0800);
    u16(central, 10, 0);
    u16(central, 12, time);
    u16(central, 14, day);
    u32(central, 16, checksum);
    u32(central, 20, size);
    u32(central, 24, size);
    u16(central, 28, name.length);
    u32(central, 42, offset);
    centrals.push(central, name);

    offset += local.length + name.length + size;
  }

  const directory = concat(centrals);
  const end = new Uint8Array(22);
  u32(end, 0, 0x06054b50);
  u16(end, 8, entries.length);
  u16(end, 10, entries.length);
  u32(end, 12, directory.length);
  u32(end, 16, offset);

  return concat([...locals, directory, end]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
