import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = dirname(SRC_DIR);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function hasDefaultExport(source: string): boolean {
  const code = stripComments(source);
  return (
    /(^|\n)\s*export\s+default[\s(]/.test(code) ||
    /export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(code) ||
    /export\s*\{[^}]*\bdefault\b[^}]*\}\s*from/.test(code)
  );
}

function listRouteModuleFiles(): string[] {
  const files = new Set<string>();
  const collect = (source: string, baseDir: string) => {
    for (const match of stripComments(source).matchAll(/'([^']+\.tsx?)'/g)) {
      files.add(join(baseDir, match[1]));
    }
  };
  const appRoutesSource = readFileSync(join(SRC_DIR, 'routes.ts'), 'utf8');
  collect(appRoutesSource, '');
  for (const match of stripComments(appRoutesSource).matchAll(/from\s+'(\.\.\/features\/[a-z-]+\/routes)'/g)) {
    const configRel = match[1].replace(/^\.\.\//, '');
    collect(readFileSync(join(SRC_ROOT, `${configRel}.ts`), 'utf8'), dirname(configRel));
  }
  return [...files].sort();
}

const ROUTE_MODULE_FILES = listRouteModuleFiles();

describe('Gác route module (issue #406): mọi module đăng ký trong src/app/routes.ts đều có export mặc định', () => {
  it('suy ra đầy đủ danh sách module route từ chính routes.ts', () => {
    expect(ROUTE_MODULE_FILES.length).toBeGreaterThan(50);
    expect(ROUTE_MODULE_FILES).toContain('features/guardians/routes/admin-guardian-links.tsx');
  });

  for (const file of ROUTE_MODULE_FILES) {
    it(`module route ${file} có export mặc định`, () => {
      const source = readFileSync(join(SRC_ROOT, file), 'utf8');
      expect(
        hasDefaultExport(source),
        `Route module ${file} thiếu export mặc định — React Router framework mode sẽ không gắn được component cho route này`,
      ).toBe(true);
    });
  }
});
