import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';


type Declaration = { prefix: string; className: string; file: string };

function collectControllerFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectControllerFiles(full, out);
    } else if (entry.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out;
}

function collectDeclarations(): Declaration[] {
  const modulesDir = join(__dirname, '..', 'modules');
  const declarations: Declaration[] = [];
  const controllerPattern =
    /@Controller\(\s*\{[^}]*?path:\s*['"`]([^'"`]+)['"`][^}]*\}\)[\s\S]*?export\s+class\s+(\w+)/g;
  for (const file of collectControllerFiles(modulesDir)) {
    const text = readFileSync(file, 'utf-8');
    for (const match of text.matchAll(controllerPattern)) {
      declarations.push({ prefix: match[1], className: match[2], file });
    }
  }
  return declarations;
}

describe('Sở hữu tiền tố controller', () => {
  const declarations = collectDeclarations();

  it('mỗi tiền tố đầy đủ chỉ có đúng một lớp controller khai báo', () => {
    const byPrefix = new Map<string, Declaration[]>();
    for (const declaration of declarations) {
      const existing = byPrefix.get(declaration.prefix) ?? [];
      existing.push(declaration);
      byPrefix.set(declaration.prefix, existing);
    }
    const duplicates = [...byPrefix.entries()].filter(([, owners]) => owners.length > 1);
    expect(
      duplicates,
      duplicates.length > 0
        ? `Tiền tố bị khai trùng: ${duplicates.map(([prefix, owners]) => `${prefix} do ${owners.map((o) => o.className).join(', ')} khai`).join('; ')}`
        : 'Không có tiền tố trùng',
    ).toEqual([]);
  });

  it("tiền tố trơ `courses` chỉ còn module courses sở hữu", () => {
    const owners = declarations.filter((d) => d.prefix === 'courses');
    expect(owners.map((o) => o.className)).toEqual(['CoursesController']);
  });

  it("tiền tố `guardian` chỉ còn một lớp sở hữu", () => {
    const owners = declarations.filter((d) => d.prefix === 'guardian');
    expect(owners.map((o) => o.className)).toEqual(['GuardianController']);
  });
});
