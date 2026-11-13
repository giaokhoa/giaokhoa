import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MESSAGE_PROVIDERS, providerByName } from './notification-providers';


const WORKER_SRC_ROOT = join(__dirname, '../../../../worker/src');

interface MirrorEntry { name: string; component: string; mandatoryInApp: boolean }

function extractWorkerMirror(): Map<string, MirrorEntry> {
  const source = readFileSync(join(WORKER_SRC_ROOT, 'notification-delivery.service.ts'), 'utf-8');
  const start = source.indexOf('export const WORKER_PROVIDERS');
  expect(start, 'WORKER_PROVIDERS must exist in worker notification-delivery.service.ts').toBeGreaterThanOrEqual(0);
  const block = source.slice(start, source.indexOf('};', start));
  const mirror = new Map<string, MirrorEntry>();
  for (const match of block.matchAll(/([a-z0-9_]+): \{([^}]*)\}/g)) {
    const key = match[1];
    const raw = match[2];
    const props = [...raw.matchAll(/(\w+):/g)].map((m) => m[1]).sort();
    expect(props, `WORKER_PROVIDERS.${key} must carry exactly the three parity fields`).toEqual(['component', 'mandatoryInApp', 'name']);
    const name = /name: '([a-z0-9_]+)'/.exec(raw)?.[1];
    const component = /component: '([a-z0-9_]+)'/.exec(raw)?.[1];
    const mandatory = /mandatoryInApp: (true|false)/.exec(raw)?.[1];
    expect(name, `WORKER_PROVIDERS.${key}.name must be a string literal`).toBeDefined();
    expect(component, `WORKER_PROVIDERS.${key}.component must be a string literal`).toBeDefined();
    expect(mandatory, `WORKER_PROVIDERS.${key}.mandatoryInApp must be a boolean literal`).toBeDefined();
    mirror.set(key, { name: name!, component: component!, mandatoryInApp: mandatory === 'true' });
  }
  return mirror;
}

describe('Đối chiếu thông báo: mirror worker so với registry API (issue #293)', () => {
  it('mirror worker là hình chiếu trung thực của registry API trên mọi trường luật trong phạm vi', () => {
    const mirror = extractWorkerMirror();
    expect(mirror.size).toBeGreaterThan(0);
    expect(MESSAGE_PROVIDERS.length).toBeGreaterThan(0);
    for (const [key, law] of mirror) {
      expect(law.name).toBe(key);
      const registryEntry = providerByName(key);
      expect(registryEntry, `WORKER_PROVIDERS.${key} must exist in the API registry`).toBeDefined();
      expect(law.component).toBe(registryEntry!.component);
      expect(law.mandatoryInApp).toBe(registryEntry!.mandatoryInApp ?? false);
    }
  });

  it('mọi provider phát qua deliverInApp trong mã worker đều đã đăng ký trong mirror', () => {
    const mirror = extractWorkerMirror();
    const emitted = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.ts')) continue;
        if (entry.name.endsWith('.spec.ts')) continue;
        const text = readFileSync(full, 'utf-8');
        for (const match of text.matchAll(/deliverInApp\(\s*[^,]+,\s*'([a-z0-9_]+)'/g)) {
          emitted.add(match[1]);
        }
      }
    };
    walk(WORKER_SRC_ROOT);
    expect(emitted.size).toBeGreaterThan(0);
    for (const name of emitted) {
      expect(mirror.has(name), `worker emits '${name}' via deliverInApp but it is missing from WORKER_PROVIDERS`).toBe(true);
    }
  });
});
