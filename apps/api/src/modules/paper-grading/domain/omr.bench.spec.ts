import { describe, expect, it } from 'vitest';
import { computeSheetGeometry, sbdCodeForIndex, studentCodeForIndex } from './sheet-layout';
import { processSheetImage } from './omr';
import { renderSheetRgba, seededRandom, simulatePhoto, type SlotFill } from './sheet-render';

const OPTION_COUNTS_40 = Array.from({ length: 40 }, (_, i) => (i % 7 === 3 ? 2 : 4));
const LONG = { timeout: 600_000 };

describe('Tập nghiệm thu mô phỏng CAM-0', () => {
  it('độ chính xác: phiếu tô sạch đọc đúng ≥99.5% ô tròn, QR 100%', LONG, () => {
    const geometry = computeSheetGeometry(OPTION_COUNTS_40);
    let totalQuestions = 0, correctQuestions = 0, ambiguousOnClean = 0;
    let totalCells = 0, correctCells = 0;
    let qrOk = 0;
    const SHEETS = 10;
    for (let s = 0; s < SHEETS; s++) {
      const rand = seededRandom(1000 + s);
      const fills = new Map<number, SlotFill>();
      const truth = new Map<number, number | null>();
      geometry.rows.forEach((row) => {
        const optionCount = row.centers.length;
        if (rand() < 0.18) { truth.set(row.slot, null); return; }
        const choice = Math.floor(rand() * optionCount);
        fills.set(row.slot, { choice, style: 'full' });
        truth.set(row.slot, choice);
      });
      const qrText = `GKHQ1|quiz-${s}|A|user-${s}|chk${s}`;
      const sheet = renderSheetRgba({ geometry, qrText, bubbleCode: null, fills });
      const photo = simulatePhoto(sheet, { seed: 5000 + s, blurPasses: s % 3 === 0 ? 1 : 0 });
      const result = processSheetImage(photo, geometry);
      expect(result.qualityOk, `sheet ${s} should pass quality gate: ${result.qualityReasons.join(',')}`).toBe(true);
      if (result.qrText === qrText) qrOk++;
      for (const reading of result.readings) {
        totalQuestions++;
        const expected = truth.get(reading.slot) ?? null;
        if (reading.state === 'ambiguous') { ambiguousOnClean++; continue; }
        if (reading.chosen === expected) correctQuestions++;
        const expectedCells = reading.densities.map((_, k) => (expected === k ? 1 : 0));
        reading.densities.forEach((d, k) => {
          totalCells++;
          const cellFilled = d >= 0.42;
          const cellBlank = d <= 0.16;
          if ((expectedCells[k] === 1 && cellFilled) || (expectedCells[k] === 0 && cellBlank)) correctCells++;
        });
      }
    }
    const questionAccuracy = correctQuestions / totalQuestions;
    const cellAccuracy = correctCells / totalCells;
    console.log(`[CAM-0 bench] clean set: questions ${correctQuestions}/${totalQuestions} (${(questionAccuracy * 100).toFixed(2)}%), cells ${correctCells}/${totalCells} (${(cellAccuracy * 100).toFixed(2)}%), ambiguous-on-clean ${ambiguousOnClean}, QR ${qrOk}/${SHEETS}`);
    expect(cellAccuracy).toBeGreaterThanOrEqual(0.995);
    expect(questionAccuracy).toBeGreaterThanOrEqual(0.995);
    expect(qrOk).toBe(SHEETS);
  });

  it('mơ hồ: tô mờ, dấu tick, tô đôi và tẩy xoá đều được ghi nhận HẾT, không đoán gì', LONG, () => {
    const geometry = computeSheetGeometry(OPTION_COUNTS_40);
    const special: SlotFill[] = [
      { choice: 0, style: 'light' },
      { choice: 1, style: 'check' },
      { choice: 0, style: 'full', secondChoice: 2 },
      { choice: 1, style: 'erased' },
    ];
    let checked = 0;
    for (let round = 0; round < special.length; round++) {
      const fills = new Map<number, SlotFill>();
      for (let k = 0; k < 8; k++) {
        const row = geometry.rows[k]!;
        const base = special[round]!;
        const choice = (base.choice + k) % row.centers.length;
        const fill: SlotFill = { choice, style: base.style };
        if (base.secondChoice !== undefined) fill.secondChoice = (choice + 1) % row.centers.length;
        fills.set(k + 1, fill);
      }
      for (let slot = 9; slot <= 40; slot++) fills.set(slot, { choice: slot % 4, style: 'full' });
      const sheet = renderSheetRgba({ geometry, qrText: null, bubbleCode: '1018', fills });
      const photo = simulatePhoto(sheet, { seed: 9000 + round });
      const result = processSheetImage(photo, geometry);
      expect(result.qualityOk).toBe(true);
      for (let slot = 1; slot <= 8; slot++) {
        const reading = result.readings.find((r) => r.slot === slot)!;
        checked++;
        expect(reading.state, `round ${round} slot ${slot} (${special[round]!.style}) must be ambiguous, got ${reading.state} chosen=${reading.chosen}`).toBe('ambiguous');
        expect(reading.chosen).toBeNull();
      }
    }
    expect(checked).toBe(32);
  });

  it('định danh: mã ô tròn đọc chính xác; một chữ số sai duy nhất luôn bị phát hiện', LONG, () => {
    const geometry = computeSheetGeometry(OPTION_COUNTS_40);
    const fills = new Map<number, SlotFill>();
    for (let slot = 1; slot <= 40; slot++) fills.set(slot, { choice: slot % 4, style: 'full' });
    for (const index of [0, 4, 17, 42, 120]) {
      const code = studentCodeForIndex(index);
      const sheet = renderSheetRgba({ geometry, qrText: null, bubbleCode: code, fills });
      const photo = simulatePhoto(sheet, { seed: 7000 + index });
      const result = processSheetImage(photo, geometry);
      expect(result.bubbleCode?.code).toBe(code);
      expect(result.bubbleCode?.checksumOk).toBe(true);
    }
    for (const index of [3, 25, 88]) {
      const good = studentCodeForIndex(index);
      const wrongDigit = (Number(good[1]) + 3) % 10;
      const tampered = `${good[0]}${wrongDigit}${good[2]}${good[3]}`;
      const sheet = renderSheetRgba({ geometry, qrText: null, bubbleCode: tampered, fills });
      const photo = simulatePhoto(sheet, { seed: 8000 + index });
      const result = processSheetImage(photo, geometry);
      const accepted = result.bubbleCode !== null && result.bubbleCode.checksumOk;
      expect(accepted, `tampered code ${tampered} must not validate`).toBe(false);
    }
  });

  it('định danh toàn diện: MỌI vị trí thân × delta chẵn và lẻ đều bị phát hiện trên phiếu đã render (mã lớp)', LONG, () => {
    const geometry = computeSheetGeometry(OPTION_COUNTS_40);
    const fills = new Map<number, SlotFill>();
    for (let slot = 1; slot <= 40; slot++) fills.set(slot, { choice: slot % 4, style: 'full' });
    const good = studentCodeForIndex(44);
    let rendered = 0;
    for (let pos = 0; pos < 3; pos++) {
      for (const delta of [2, 3, 8]) {
        const tampered = `${good.slice(0, pos)}${(Number(good[pos]) + delta) % 10}${good.slice(pos + 1)}`;
        const sheet = renderSheetRgba({ geometry, qrText: null, bubbleCode: tampered, fills });
        const result = processSheetImage(simulatePhoto(sheet, { seed: 21000 + pos * 100 + delta }), geometry);
        rendered++;
        const accepted = result.bubbleCode !== null && result.bubbleCode.checksumOk;
        expect(accepted, `tampered class code ${tampered} (from ${good}, pos ${pos}, delta ${delta}) must not validate`).toBe(false);
        expect(result.bubbleCode?.code).toBe(tampered);
      }
    }
    expect(rendered).toBe(9);
  });

  it('cổng chất lượng: phiếu thiếu fiducial hoặc mờ nặng bị từ chối', LONG, () => {
    const geometry = computeSheetGeometry(OPTION_COUNTS_40);
    const fills = new Map<number, SlotFill>();
    for (let slot = 1; slot <= 40; slot++) fills.set(slot, { choice: 1, style: 'full' });
    const sheet = renderSheetRgba({ geometry, qrText: 'GKHQ1|q|A|u|c', bubbleCode: null, fills });
    const blurred = processSheetImage(simulatePhoto(sheet, { seed: 31337, blurPasses: 8 }), geometry);
    expect(blurred.qualityOk).toBe(false);
    expect(blurred.qualityReasons).toContain('blurry');
    const broken = renderSheetRgba({ geometry, qrText: 'GKHQ1|q|A|u|c', bubbleCode: null, fills });
    for (let y = 0; y < 260; y++) {
      for (let x = 0; x < 260; x++) {
        const i = (y * broken.width + x) * 4;
        broken.data[i] = 250; broken.data[i + 1] = 250; broken.data[i + 2] = 250;
      }
    }
    const missing = processSheetImage(simulatePhoto(broken, { seed: 4242 }), geometry);
    expect(missing.qualityOk).toBe(false);
    expect(missing.qualityReasons).toContain('missing_fiducials');
  });
});

describe('Luồng phiếu chung CAM-0 (lưới biến thể + mã SBD)', () => {
  const FILLS_40 = () => {
    const fills = new Map<number, SlotFill>();
    for (let slot = 1; slot <= 40; slot++) fills.set(slot, { choice: slot % 4, style: 'full' });
    return fills;
  };

  it('lưới biến thể: mã đề 4 chữ số tô sạch đọc chính xác', LONG, () => {
    const geometry = computeSheetGeometry(OPTION_COUNTS_40);
    for (const [seed, variant] of [[1101, '1001'], [1102, '0241'], [1103, '9876']] as const) {
      const sheet = renderSheetRgba({ geometry, qrText: null, bubbleCode: null, variantCode: variant, fills: FILLS_40() });
      const result = processSheetImage(simulatePhoto(sheet, { seed }), geometry);
      expect(result.qualityOk).toBe(true);
      expect(result.variantCode?.code).toBe(variant);
    }
  });

  it('lưới biến thể: một chữ số tô mờ làm cả mã không chắc chắn — không bao giờ đoán', LONG, () => {
    const geometry = computeSheetGeometry(OPTION_COUNTS_40);
    for (const lightDigit of [0, 2, 3]) {
      const sheet = renderSheetRgba({
        geometry, qrText: null, bubbleCode: null, variantCode: '1001', variantLightDigit: lightDigit, fills: FILLS_40(),
      });
      const result = processSheetImage(simulatePhoto(sheet, { seed: 1200 + lightDigit }), geometry);
      expect(result.qualityOk).toBe(true);
      expect(result.variantCode, `light digit ${lightDigit} must not be guessed`).toBeNull();
    }
    const blank = renderSheetRgba({ geometry, qrText: null, bubbleCode: null, variantCode: '', fills: FILLS_40() });
    const blankResult = processSheetImage(simulatePhoto(blank, { seed: 1299 }), geometry);
    expect(blankResult.variantCode).toBeNull();
  });

  it('lưới biến thể: mã sai nhưng tô sạch đọc nguyên văn (lớp định tuyến, không phải engine, từ chối nó)', LONG, () => {
    const geometry = computeSheetGeometry(OPTION_COUNTS_40);
    const sheet = renderSheetRgba({ geometry, qrText: null, bubbleCode: null, variantCode: '9999', fills: FILLS_40() });
    const result = processSheetImage(simulatePhoto(sheet, { seed: 1301 }), geometry);
    expect(result.variantCode?.code).toBe('9999');
  });

  it('định danh SBD: mã 8 chữ số đọc chính xác; một chữ số sai duy nhất luôn bị phát hiện', LONG, () => {
    const geometry = computeSheetGeometry(OPTION_COUNTS_40, 8);
    expect(geometry.codeDigits).toBe(8);
    const fills = FILLS_40();
    for (const index of [0, 4, 17, 42, 120, 999]) {
      const code = sbdCodeForIndex(index);
      expect(code).toMatch(/^\d{8}$/);
      const sheet = renderSheetRgba({ geometry, qrText: null, bubbleCode: code, fills });
      const result = processSheetImage(simulatePhoto(sheet, { seed: 17000 + index }), geometry);
      expect(result.bubbleCode?.code).toBe(code);
      expect(result.bubbleCode?.checksumOk).toBe(true);
    }
    for (const [index, pos] of [[3, 0], [25, 3], [88, 6], [7, 7]] as const) {
      const good = sbdCodeForIndex(index);
      const tampered = `${good.slice(0, pos)}${(Number(good[pos]) + 3) % 10}${good.slice(pos + 1)}`;
      const sheet = renderSheetRgba({ geometry, qrText: null, bubbleCode: tampered, fills });
      const result = processSheetImage(simulatePhoto(sheet, { seed: 18000 + index * 10 + pos }), geometry);
      const accepted = result.bubbleCode !== null && result.bubbleCode.checksumOk;
      expect(accepted, `tampered SBD ${tampered} must not validate`).toBe(false);
    }
  });

  it('định danh SBD toàn diện: MỌI vị trí thân × delta chẵn và lẻ đều bị phát hiện trên phiếu đã render', LONG, () => {
    const geometry = computeSheetGeometry(OPTION_COUNTS_40, 8);
    const fills = FILLS_40();
    const good = sbdCodeForIndex(12_345);
    let rendered = 0;
    for (let pos = 0; pos < 7; pos++) {
      for (const delta of [2, 3, 8]) {
        const tampered = `${good.slice(0, pos)}${(Number(good[pos]) + delta) % 10}${good.slice(pos + 1)}`;
        const sheet = renderSheetRgba({ geometry, qrText: null, bubbleCode: tampered, fills });
        const result = processSheetImage(simulatePhoto(sheet, { seed: 22000 + pos * 100 + delta }), geometry);
        rendered++;
        const accepted = result.bubbleCode !== null && result.bubbleCode.checksumOk;
        expect(accepted, `tampered SBD ${tampered} (from ${good}, pos ${pos}, delta ${delta}) must not validate`).toBe(false);
        expect(result.bubbleCode?.code).toBe(tampered);
      }
    }
    expect(rendered).toBe(21);
  });

  it('phiếu chung đầu-cuối: mã SBD + mã biến thể + đáp án đều đọc từ một ảnh', LONG, () => {
    const geometry = computeSheetGeometry(OPTION_COUNTS_40, 8);
    const fills = new Map<number, SlotFill>();
    const truth = new Map<number, number | null>();
    geometry.rows.forEach((row) => {
      const choice = row.slot % row.centers.length;
      fills.set(row.slot, { choice, style: 'full' });
      truth.set(row.slot, choice);
    });
    const code = sbdCodeForIndex(23);
    const sheet = renderSheetRgba({ geometry, qrText: null, bubbleCode: code, variantCode: '1002', fills });
    const result = processSheetImage(simulatePhoto(sheet, { seed: 19001 }), geometry);
    expect(result.qualityOk).toBe(true);
    expect(result.bubbleCode).toEqual({ code, checksumOk: true });
    expect(result.variantCode?.code).toBe('1002');
    for (const reading of result.readings) {
      expect(reading.state).toBe('filled');
      expect(reading.chosen).toBe(truth.get(reading.slot));
    }
  });
});
