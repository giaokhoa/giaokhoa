import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveProgramDumpOutPath } from './export-program-dump';

describe('CLI xuất dump chương trình — file đích mặc định', () => {
  it('chạy không kèm đối số đầu ra thì đích mặc định là artifact program-data-dump/program-dump.sql ngay cạnh file CLI, không nhân đôi đoạn modules/curriculum', () => {
    const outPath = resolveProgramDumpOutPath([]);

    expect(outPath).toBe(join(__dirname, 'program-data-dump', 'program-dump.sql'));
    expect(outPath).not.toContain(join('modules', 'curriculum', 'modules', 'curriculum'));
    expect(existsSync(dirname(outPath))).toBe(true);
    expect(existsSync(outPath)).toBe(true);
  });
});
