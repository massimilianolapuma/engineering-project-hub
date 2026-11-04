import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/*
 * examples/prometheus/fetch-hub-metrics.sh replaces the textfile-collector file only with a real
 * metrics file: a login redirect or an HTML page keeps the previous file and exits non-zero.
 */
const PREVIOUS = '# HELP hub_info previous\n# TYPE hub_info gauge\nhub_info 1\n';
const FRESH = '# HELP hub_info fresh\n# TYPE hub_info gauge\nhub_info 1\n';
let server: Server;
let base: string;
let dir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok') res.writeHead(200, { 'Content-Type': 'text/plain' }).end(FRESH);
    else if (req.url === '/login')
      res.writeHead(302, { Location: '/cdn-cgi/access/login' }).end('<html>login</html>');
    else if (req.url === '/html')
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html></html>');
    else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = await mkdtemp(join(tmpdir(), 'eph-fetch-'));
  await writeFile(join(dir, 'hub.prom'), PREVIOUS);
});

const run = (path: string) =>
  new Promise<number>((resolve) => {
    const child = spawn('sh', ['examples/prometheus/fetch-hub-metrics.sh'], {
      env: { ...process.env, HUB_METRICS_URL: `${base}${path}`, TEXTFILE_DIR: dir },
      stdio: 'ignore',
    });
    child.on('close', (code) => resolve(code ?? -1));
  });

describe('fetch-hub-metrics.sh', () => {
  it('replaces the file with a fresh metrics file', async () => {
    expect(await run('/ok')).toBe(0);
    expect(await readFile(join(dir, 'hub.prom'), 'utf8')).toBe(FRESH);
    expect(await readdir(dir)).toEqual(['hub.prom']);
  });

  it.each(['/login', '/html', '/missing'])('keeps the previous file on %s', async (path) => {
    expect(await run(path)).not.toBe(0);
    expect(await readFile(join(dir, 'hub.prom'), 'utf8')).toBe(PREVIOUS);
    expect(await readdir(dir)).toEqual(['hub.prom']);
  });
});
