import { describe, expect, it } from 'vitest';
import { readZipEntry, ZipError } from '../../collector/src/util/zip';
import { makeZip } from '../helpers/factories';

const JSON_TEXT = '{"hello":"world"}';

describe('readZipEntry', () => {
  it('reads a deflated entry', () => {
    const zip = makeZip([{ name: 'quality-summary.json', data: JSON_TEXT, method: 8 }]);
    expect(readZipEntry(zip, 'quality-summary.json', 1024)).toBe(JSON_TEXT);
  });
  it('reads a stored entry', () => {
    const zip = makeZip([
      { name: 'other.txt', data: 'x', method: 8 },
      { name: 'quality-summary.json', data: JSON_TEXT, method: 0 },
    ]);
    expect(readZipEntry(zip, 'quality-summary.json', 1024)).toBe(JSON_TEXT);
  });
  it('throws when entry absent', () => {
    const zip = makeZip([{ name: 'other.txt', data: 'x' }]);
    expect(() => readZipEntry(zip, 'quality-summary.json', 1024)).toThrow(ZipError);
  });
  it('throws when uncompressed size > maxBytes', () => {
    const zip = makeZip([{ name: 'quality-summary.json', data: 'a'.repeat(5000) }]);
    expect(() => readZipEntry(zip, 'quality-summary.json', 1000)).toThrow(ZipError);
  });
  it('does not match "../quality-summary.json"', () => {
    const zip = makeZip([{ name: '../quality-summary.json', data: JSON_TEXT }]);
    expect(() => readZipEntry(zip, 'quality-summary.json', 1024)).toThrow(ZipError);
  });
  it('throws on truncated archive', () => {
    const zip = makeZip([{ name: 'quality-summary.json', data: JSON_TEXT }]);
    expect(() =>
      readZipEntry(zip.subarray(0, zip.length - 10), 'quality-summary.json', 1024),
    ).toThrow(ZipError);
    expect(() => readZipEntry(new Uint8Array(5), 'quality-summary.json', 1024)).toThrow(ZipError);
  });
  it('throws on unsupported compression method', () => {
    const zip = makeZip([{ name: 'quality-summary.json', data: JSON_TEXT }]);
    // Patch the central directory method (offset 10 in the central header) to 12 (bzip2).
    const buf = Buffer.from(zip);
    const cen = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buf.writeUInt16LE(12, cen + 10);
    expect(() => readZipEntry(new Uint8Array(buf), 'quality-summary.json', 1024)).toThrow(ZipError);
  });
});
