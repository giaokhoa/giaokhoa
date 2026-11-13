import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProgramDataset, PROGRAM_DATASETS } from './program-datasets';


const EXPECTED_RECORDS: Readonly<Record<string, number>> = {
  toan: 314,
  nguvan: 238,
  'tienganh-1-2': 16,
  'tienganh-3-12': 102,
  daoduc: 40,
  gdcd: 40,
  gdktpl: 36,
  tnxh: 48,
  khoahoc: 32,
  'lsdl-th': 49,
  'lsdl-thcs': 64,
  lichsu: 110,
  diali: 63,
  khtn: 131,
  vatli: 82,
  hoahoc: 94,
  sinhhoc: 133,
  tinhoc: 115,
  congnghe: 121,
  gdtc: 22,
  amnhac: 116,
  mithuat: 100,
  hdtn: 39,
  'hdtn-hn': 66,
};

describe('Dataset GDPT 2018 đã vendor — gác tính đầy đủ (issue #161)', () => {
  it('manifest có đúng 24 dataset và khớp hai chiều với file trên đĩa', () => {
    expect(PROGRAM_DATASETS).toHaveLength(24);
    const onDisk = readdirSync(join(__dirname, 'program-data'))
      .filter((name) => name.endsWith('.json'))
      .sort();
    const inManifest = PROGRAM_DATASETS.map((d) => d.fileName).sort();
    expect(inManifest).toEqual(onDisk);
  });

  it('số bản ghi từng dataset và tổng toàn bộ khớp bảng đã kiểm chứng (2.171)', () => {
    let total = 0;
    for (const def of PROGRAM_DATASETS) {
      const file = loadProgramDataset(def);
      expect(
        file.records.length,
        `dataset ${def.key} (${def.fileName}) lệch số bản ghi đã kiểm chứng`,
      ).toBe(EXPECTED_RECORDS[def.key]);
      total += file.records.length;
    }
    expect(total).toBe(2171);
  });

  it('24 dataset resolve về đúng 22 môn đích phân biệt', () => {
    const slugs = new Set(PROGRAM_DATASETS.map((d) => d.slug));
    expect(slugs.size).toBe(22);
  });
});
