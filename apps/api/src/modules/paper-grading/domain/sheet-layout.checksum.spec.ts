import { describe, expect, it } from 'vitest';
import {
  sbdCodeChecksumOk, sbdCodeForIndex, sbdIndexForCode,
  studentCodeChecksumOk, studentCodeForIndex, studentIndexForCode,
} from './sheet-layout';

const LONG = { timeout: 300_000 };

function mutations(code: string): string[] {
  const out: string[] = [];
  for (let pos = 0; pos < code.length; pos++) {
    for (let a = 0; a <= 9; a++) {
      if (String(a) === code[pos]) continue;
      out.push(`${code.slice(0, pos)}${a}${code.slice(pos + 1)}`);
    }
  }
  return out;
}

describe('Chữ số kiểm CAM-0 — bao phủ đột biến một chữ số toàn diện', () => {
  it('mã học viên (4 chữ số): mọi đột biến của mọi mã hợp lệ đều bị từ chối', LONG, () => {
    let checked = 0;
    let leaks = 0;
    for (let index = 0; index <= 998; index++) {
      const code = studentCodeForIndex(index);
      expect(studentCodeChecksumOk(code)).toBe(true);
      expect(studentIndexForCode(code)).toBe(index);
      for (const mutated of mutations(code)) {
        checked++;
        if (studentCodeChecksumOk(mutated) || studentIndexForCode(mutated) !== null) leaks++;
      }
    }
    console.log(`[CAM-0 checksum] student codes: ${checked} mutations checked, ${leaks} leaks`);
    expect(checked).toBe(999 * 4 * 9);
    expect(leaks).toBe(0);
  });

  it('mã SBD (8 chữ số): mọi đột biến trên toàn bộ bao phủ (vị trí, chữ số nguồn, chữ số đích) đều bị từ chối', LONG, () => {
    let checked = 0;
    let leaks = 0;
    const checkCode = (code: string) => {
      expect(sbdCodeChecksumOk(code)).toBe(true);
      for (const mutated of mutations(code)) {
        checked++;
        if (sbdCodeChecksumOk(mutated) || sbdIndexForCode(mutated) !== null) leaks++;
      }
    };
    for (let index = 0; index < 10_000; index++) checkCode(sbdCodeForIndex(index));
    for (let pos = 0; pos < 7; pos++) {
      for (let d = 1; d <= 9; d++) {
        const body = Array.from({ length: 7 }, (_, k) => (k === pos ? String(d) : '0')).join('');
        const index = Number(body) - 1;
        if (index < 0) continue;
        checkCode(sbdCodeForIndex(index));
      }
    }
    console.log(`[CAM-0 checksum] SBD codes: ${checked} mutations checked, ${leaks} leaks`);
    expect(checked).toBe((10_000 + 7 * 9) * 8 * 9);
    expect(leaks).toBe(0);
  });

  it('va chạm danh sách: đột biến tại các vị trí từng rò rỉ không bao giờ thành mã thành viên khác trong danh sách', LONG, () => {
    const classRoster = new Set(Array.from({ length: 45 }, (_, i) => studentCodeForIndex(i)));
    let classChecked = 0;
    for (let index = 0; index < 45; index++) {
      const code = studentCodeForIndex(index);
      for (const delta of [2, 4, 6, 8]) {
        const mutated = `${code[0]}${(Number(code[1]) + delta) % 10}${code.slice(2)}`;
        classChecked++;
        expect(classRoster.has(mutated), `mutated class code ${mutated} (from ${code}) must not be a roster code`).toBe(false);
        expect(studentCodeChecksumOk(mutated)).toBe(false);
      }
    }
    const sbdRoster = new Set(Array.from({ length: 45 }, (_, i) => sbdCodeForIndex(i)));
    let sbdChecked = 0;
    for (let index = 0; index < 45; index++) {
      const code = sbdCodeForIndex(index);
      for (const pos of [1, 6]) {
        for (const delta of [2, 4, 6, 8]) {
          const mutated = `${code.slice(0, pos)}${(Number(code[pos]) + delta) % 10}${code.slice(pos + 1)}`;
          sbdChecked++;
          expect(sbdRoster.has(mutated), `mutated SBD ${mutated} (from ${code}) must not be a roster code`).toBe(false);
          expect(sbdCodeChecksumOk(mutated)).toBe(false);
        }
      }
    }
    console.log(`[CAM-0 checksum] roster collision: class ${classChecked} + SBD ${sbdChecked} targeted mutations, 0 collisions`);
  });

  it('hoán vị kề: lớp thoát duy nhất là cặp chữ số lệch đúng 5 (giới hạn đã khai)', LONG, () => {
    const checkTranspositions = (code: string, ok: (c: string) => boolean) => {
      for (let pos = 0; pos < code.length - 1; pos++) {
        const a = Number(code[pos]);
        const b = Number(code[pos + 1]);
        if (a === b) continue;
        const swapped = `${code.slice(0, pos)}${b}${a}${code.slice(pos + 2)}`;
        if (ok(swapped)) expect(Math.abs(a - b), `transposition ${code} -> ${swapped} escaped`).toBe(5);
      }
    };
    for (let index = 0; index <= 998; index++) checkTranspositions(studentCodeForIndex(index), studentCodeChecksumOk);
    for (let index = 0; index < 10_000; index++) checkTranspositions(sbdCodeForIndex(index), sbdCodeChecksumOk);
  });

  it('cặp biên danh sách: hoán vị hai chữ số cuối không bao giờ rơi vào mã khác trong danh sách trừ khi hai chữ số lệch đúng 5', LONG, () => {
    expect(sbdCodeForIndex(0)).toBe('00000017');
    expect(sbdCodeChecksumOk('00000071')).toBe(false);
    expect(sbdCodeChecksumOk('00000091')).toBe(false);

    const checkEdge = (codes: string[], ok: (c: string) => boolean, label: string) => {
      const roster = new Set(codes);
      let checked = 0;
      let declaredClass = 0;
      for (const code of codes) {
        const a = Number(code[code.length - 2]);
        const b = Number(code[code.length - 1]);
        if (a === b) continue;
        const swapped = `${code.slice(0, -2)}${b}${a}`;
        if (Math.abs(a - b) === 5) { declaredClass++; continue; }
        checked++;
        expect(ok(swapped), `${label} edge transposition ${code} -> ${swapped} must fail the checksum`).toBe(false);
        expect(roster.has(swapped), `${label} edge transposition ${code} -> ${swapped} must not be a roster code`).toBe(false);
      }
      console.log(`[CAM-0 checksum] ${label} roster edge pair: ${checked} non-±5 transpositions checked, 0 leaks; ${declaredClass} in the declared ±5 class`);
      expect(checked).toBeGreaterThan(0);
    };
    checkEdge(Array.from({ length: 999 }, (_, i) => studentCodeForIndex(i)), studentCodeChecksumOk, 'student codes');
    checkEdge(Array.from({ length: 5_000 }, (_, i) => sbdCodeForIndex(i)), sbdCodeChecksumOk, 'SBD codes');
  });
});
