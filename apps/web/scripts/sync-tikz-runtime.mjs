import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const UPSTREAM = 'jmckalex/mp-tikz-wasm';
const VERSION = '0.3.1';
const SHA256 = '24b0cd291a18ead46c8c09f78bedbf82fd965acb87cc5f1fb447fd38f353c152';
const RELEASE_URL = `https://github.com/${UPSTREAM}/releases/download/v${VERSION}/mp-tikz-wasm-${VERSION}.tar.gz`;
const STAMP = `${VERSION} ${SHA256} browser-worker-v1`;

const webRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(webRoot, '../..');
const publicRoot = join(repoRoot, '.cache', 'web-public');
const target = join(publicRoot, 'vendor', 'tikz-runtime', `v${VERSION}`);
const stamp = join(target, '.release');

async function isCurrent() {
  try {
    return (
      (await readFile(stamp, 'utf8')).trim() === STAMP &&
      (await readFile(join(target, 'index.js'))).length > 0 &&
      (await readFile(join(target, 'browser-worker.js'))).length > 0 &&
      (await readFile(join(target, 'bundles', 'index.json'))).length > 0
    );
  } catch {
    return false;
  }
}

if (await isCurrent()) process.exit(0);

const temporary = await mkdtemp(join(tmpdir(), 'giaokhoa-tikz-'));
try {
  const archive = join(temporary, 'runtime.tar.gz');
  const extracted = join(temporary, 'extracted');
  const staging = join(temporary, 'runtime');

  const response = await fetch(RELEASE_URL);
  if (!response.ok) {
    throw new Error(`Không thể tải ${UPSTREAM} v${VERSION}: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== SHA256) {
    throw new Error(`Checksum ${UPSTREAM} không khớp: ${digest}`);
  }

  await writeFile(archive, bytes);
  await mkdir(extracted, { recursive: true });
  await execFileAsync('tar', ['-xzf', archive, '-C', extracted]);

  const releaseRoot = join(extracted, `mp-tikz-wasm-${VERSION}`);
  await cp(join(releaseRoot, 'dist'), staging, {
    recursive: true,
    filter: (sourcePath) => !basename(sourcePath).startsWith('._'),
  });
  await cp(join(releaseRoot, 'LICENSE'), join(staging, 'LICENSE'));
  await cp(join(releaseRoot, 'NOTICE.md'), join(staging, 'NOTICE.md'));
  await cp(join(releaseRoot, 'licenses'), join(staging, 'licenses'), {
    recursive: true,
    filter: (sourcePath) => !basename(sourcePath).startsWith('._'),
  });

  await writeFile(
    join(staging, 'browser-worker.js'),
    `import { MetaPost } from './index.js';

let engine;
let queue = Promise.resolve();
let activeRequestId;

const post = (message) => self.postMessage(message);
const errorMessage = (error) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);

self.onmessage = (event) => {
  const request = event.data;

  if (request.op === 'init') {
    void (async () => {
      try {
        engine = await MetaPost.create({ ...request.options, worker: false });
        engine.on('progress', (data) =>
          post({ event: 'progress', id: activeRequestId, data }),
        );
        engine.on('log', (data) => post({ event: 'log', id: activeRequestId, data }));
        post({ id: request.id, ok: true });
      } catch (error) {
        post({ id: request.id, ok: false, error: errorMessage(error) });
      }
    })();
    return;
  }

  if (request.op !== 'latex') return;

  const run = async () => {
    if (!engine) {
      post({ id: request.id, ok: false, error: 'TikZ runtime chưa khởi tạo.' });
      return;
    }

    activeRequestId = request.id;
    post({ event: 'started', id: request.id });
    try {
      const result = await engine.latex(request.source, request.options);
      post({ id: request.id, ok: true, result });
    } catch (error) {
      post({ id: request.id, ok: false, error: errorMessage(error) });
    } finally {
      activeRequestId = undefined;
    }
  };

  queue = queue.then(run, run);
};
`,
  );

  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(staging, target, { recursive: true });
  await writeFile(stamp, `${STAMP}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
