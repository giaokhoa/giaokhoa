import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

export default async function setup(project: TestProject) {
  const directory = await mkdtemp(join(tmpdir(), 'giaokhoa-api-vitest-'));
  project.provide('fileStorageDirectory', directory);
  return async () => rm(directory, { recursive: true, force: true });
}

declare module 'vitest' {
  export interface ProvidedContext {
    fileStorageDirectory: string;
  }
}
