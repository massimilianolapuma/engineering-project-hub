import { inflateRawSync } from 'node:zlib';

/** Minimal read-only zip reader (stored + deflate) built on node:zlib; no dependency. */
export class ZipError extends Error {
  override readonly name = 'ZipError';
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

export function readZipEntry(zip: Uint8Array, name: string, maxBytes: number): string {
  const buf = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  if (buf.length < 22) throw new ZipError('archive too small');

  // EOCD is within the last 22 + 65535 bytes (trailing comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('end of central directory not found');

  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG)
      throw new ZipError('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > buf.length) throw new ZipError('corrupt central directory');
    const entryName = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (entryName !== name) continue;

    if (method !== 0 && method !== 8) throw new ZipError(`unsupported method ${method}`);
    if (size > maxBytes) throw new ZipError('entry too large');
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOC_SIG)
      throw new ZipError('corrupt local header');
    const dataStart =
      localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (dataStart + compSize > buf.length) throw new ZipError('truncated entry');
    const data = buf.subarray(dataStart, dataStart + compSize);
    try {
      const out = method === 0 ? data : inflateRawSync(data, { maxOutputLength: maxBytes });
      if (out.length > maxBytes) throw new ZipError('entry too large');
      return out.toString('utf8');
    } catch (e) {
      if (e instanceof ZipError) throw e;
      throw new ZipError('cannot inflate entry');
    }
  }
  throw new ZipError('entry not found');
}
