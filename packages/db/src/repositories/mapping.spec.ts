import { describe, expect, it } from 'vitest';
import { applyDefined, pickDefined } from './mapping';

describe('applyDefined — chỉ ghi field có trong patch', () => {
  it('field undefined trong patch thì không chạm tới khóa đích', () => {
    const target: Record<string, unknown> = { name: 'giữ nguyên' };
    applyDefined(target, { name: undefined as string | undefined, note: 'mới' }, [
      ['name', 'name'],
      ['note', 'note'],
    ]);
    expect(target).toEqual({ name: 'giữ nguyên', note: 'mới' });
  });

  it('field mang null thì ghi null, không bỏ qua', () => {
    const target: Record<string, unknown> = { note: 'cũ' };
    applyDefined(target, { note: null as string | null }, [['note', 'note']]);
    expect(target).toEqual({ note: null });
  });

  it('giá trị falsy nhưng đã định nghĩa (false, 0, chuỗi rỗng) vẫn được ghi', () => {
    const target: Record<string, unknown> = {};
    applyDefined(
      target,
      { enabled: false, count: 0, label: '' },
      [
        ['enabled', 'enabled'],
        ['count', 'count'],
        ['label', 'label'],
      ],
    );
    expect(target).toEqual({ enabled: false, count: 0, label: '' });
  });

  it('ánh xạ khóa nguồn camelCase sang khóa đích snake_case', () => {
    const target: Record<string, unknown> = {};
    applyDefined(target, { courseId: 'c1', createdAt: 't1' }, [
      ['courseId', 'course_id'],
      ['createdAt', 'created_at'],
    ]);
    expect(target).toEqual({ course_id: 'c1', created_at: 't1' });
  });

  it('ghi các field đúng thứ tự trong danh sách, field sau thắng khi trùng khóa đích', () => {
    const target: Record<string, unknown> = {};
    applyDefined(target, { first: 'một', second: 'hai' }, [
      ['first', 'same'],
      ['second', 'same'],
    ]);
    expect(target).toEqual({ same: 'hai' });
    expect(Object.keys(target)).toEqual(['same']);
  });

  it('gán lại khóa đã có sẵn không đổi vị trí của khóa đó', () => {
    const target: Record<string, unknown> = { kept: 'cũ', other: 1 };
    applyDefined(target, { kept: 'mới', added: 2 }, [
      ['added', 'added'],
      ['kept', 'kept'],
    ]);
    expect(Object.keys(target)).toEqual(['kept', 'other', 'added']);
    expect(target).toEqual({ kept: 'mới', other: 1, added: 2 });
  });

  it('không đụng tới field không nằm trong danh sách', () => {
    const target: Record<string, unknown> = {};
    applyDefined(target, { kept: 'giữ', dropped: 'bỏ' }, [['kept', 'kept']]);
    expect(target).toEqual({ kept: 'giữ' });
  });

  it('transform chỉ chạy khi field đã định nghĩa, và nhận đúng giá trị null', () => {
    const target: Record<string, unknown> = {};
    const seen: unknown[] = [];
    applyDefined(
      target,
      { data: null as unknown[] | null, missing: undefined as string | undefined },
      [
        ['data', 'data', (value) => {
          seen.push(value);
          return value === null ? 'null-đã-biến-đổi' : 'khác';
        }],
        ['missing', 'missing', (value) => {
          seen.push(value);
          return 'không-được-gọi';
        }],
      ],
    );
    expect(target).toEqual({ data: 'null-đã-biến-đổi' });
    expect(seen).toEqual([null]);
  });

  it('transform dạng arrow nhận đúng giá trị đã định nghĩa khác null và trả về giá trị đã biến đổi', () => {
    const target: Record<string, unknown> = {};
    const seen: unknown[] = [];
    applyDefined(target, { data: [1, 2] }, [
      ['data', 'data', (value) => {
        seen.push(value);
        return JSON.stringify(value);
      }],
    ]);
    expect(seen).toEqual([[1, 2]]);
    expect(target).toEqual({ data: '[1,2]' });
  });
});

describe('pickDefined — chỉ lấy field có trong patch để spread', () => {
  it('field undefined trong patch thì không xuất hiện trong kết quả', () => {
    const picked = pickDefined({ name: undefined as string | undefined, note: 'mới' }, [
      ['name', 'name'],
      ['note', 'note'],
    ]);
    expect(picked).toEqual({ note: 'mới' });
    expect('name' in picked).toBe(false);
  });

  it('field mang null thì giữ null trong kết quả', () => {
    expect(pickDefined({ note: null as string | null }, [['note', 'note']])).toEqual({
      note: null,
    });
  });

  it('giá trị falsy nhưng đã định nghĩa (false, 0, chuỗi rỗng) vẫn được giữ', () => {
    expect(
      pickDefined({ enabled: false, count: 0, label: '' }, [
        ['enabled', 'enabled'],
        ['count', 'count'],
        ['label', 'label'],
      ]),
    ).toEqual({ enabled: false, count: 0, label: '' });
  });

  it('khóa kết quả theo đúng thứ tự trong danh sách field', () => {
    const picked = pickDefined({ b: 1, a: 2, c: undefined as number | undefined }, [
      ['a', 'a_key'],
      ['b', 'b_key'],
      ['c', 'c_key'],
    ]);
    expect(Object.keys(picked)).toEqual(['a_key', 'b_key']);
    expect(picked).toEqual({ a_key: 2, b_key: 1 });
  });

  it('trả về object rỗng khi mọi field đều undefined', () => {
    expect(
      pickDefined({ a: undefined as string | undefined }, [['a', 'a']]),
    ).toEqual({});
  });

  it('transform chỉ chạy khi field đã định nghĩa, và nhận đúng giá trị null', () => {
    const seen: unknown[] = [];
    const picked = pickDefined(
      { data: null as unknown[] | null, missing: undefined as string | undefined },
      [
        ['data', 'data', (value) => {
          seen.push(value);
          return value === null ? 'null-đã-biến-đổi' : 'khác';
        }],
        ['missing', 'missing', (value) => {
          seen.push(value);
          return 'không-được-gọi';
        }],
      ],
    );
    expect(picked).toEqual({ data: 'null-đã-biến-đổi' });
    expect(seen).toEqual([null]);
  });

  it('không làm thay đổi object nguồn', () => {
    const source = { name: 'giữ nguyên', note: undefined as string | undefined };
    pickDefined(source, [
      ['name', 'name'],
      ['note', 'note'],
    ]);
    expect(source).toEqual({ name: 'giữ nguyên', note: undefined });
  });

  it('transform dạng tham chiếu hàm trần nhận đúng giá trị đã định nghĩa khác null', () => {
    function prefixName(value: unknown): string {
      return `ten:${String(value)}`;
    }
    const picked = pickDefined({ name: 'Lan' }, [['name', 'name', prefixName]]);
    expect(picked).toEqual({ name: 'ten:Lan' });
  });

  it('transform trả về undefined thì khóa vẫn được đặt với giá trị undefined', () => {
    const picked = pickDefined({ name: 'Lan' }, [['name', 'name', () => undefined]]);
    expect('name' in picked).toBe(true);
    expect(picked.name).toBeUndefined();
  });
});
