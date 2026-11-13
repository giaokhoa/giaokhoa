import { PNG } from 'pngjs';
import { decode as jpegDecode } from 'jpeg-js';
import jsQR from 'jsqr';
import {
  FIDUCIAL_CENTERS, TEMPLATE_HEIGHT, TEMPLATE_WIDTH, codeChecksumOk,
  type CodeCellGeometry, type SheetGeometry,
} from './sheet-layout';

export interface GrayImage {
  width: number;
  height: number;
  gray: Uint8Array;
}

export interface OmrThresholds {
  fillDensity: number;
  blankDensity: number;
  minMargin: number;
}

export const DEFAULT_OMR_THRESHOLDS: OmrThresholds = { fillDensity: 0.42, blankDensity: 0.16, minMargin: 0.1 };

export const QUALITY_MIN_BLUR_VARIANCE = 55;
export const QUALITY_MAX_GLARE_RATIO = 0.25;
export const QUALITY_MIN_MEAN = 45;

const MAX_WORK_WIDTH = 1860;

function toGray(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): GrayImage {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4]!, g = rgba[i * 4 + 1]!, b = rgba[i * 4 + 2]!;
    gray[i] = (r * 299 + g * 587 + b * 114) / 1000;
  }
  return { width, height, gray };
}

function downscale(img: GrayImage, maxWidth: number): GrayImage {
  if (img.width <= maxWidth) return img;
  const scale = maxWidth / img.width;
  const width = maxWidth;
  const height = Math.round(img.height * scale);
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      gray[y * width + x] = img.gray[sy * img.width + sx]!;
    }
  }
  return { width, height, gray };
}

export function decodeImage(data: Buffer): GrayImage {
  let img: GrayImage;
  if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    const png = PNG.sync.read(data);
    img = toGray(png.data, png.width, png.height);
  } else if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8) {
    const decoded = jpegDecode(data, { useTArray: true, formatAsRGBA: true });
    if (!decoded || !decoded.data) throw new Error('jpeg decode failed');
    img = toGray(decoded.data, decoded.width, decoded.height);
  } else {
    throw new Error('unsupported image format (expected JPEG or PNG)');
  }
  return downscale(img, MAX_WORK_WIDTH);
}

export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of gray) hist[v]!++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0, wB = 0, best = -1, threshold = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i]!;
    const mF = (sum - sumB) / wF;
    const mB = sumB / wB;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = i; }
  }
  return threshold;
}

interface FiducialHit { x: number; y: number; area: number }

interface FiducialCriteria {
  roiScale: number;
  minFill: number;
  minRatio: number;
  maxRatio: number;
}

const FIDUCIAL_STRICT: FiducialCriteria = { roiScale: 0.2, minFill: 0.75, minRatio: 0.6, maxRatio: 1.7 };
const FIDUCIAL_RELAXED: FiducialCriteria = { roiScale: 0.26, minFill: 0.55, minRatio: 0.45, maxRatio: 2.2 };
const FIDUCIAL_AREA_ARBITRATION = 2;
const FIDUCIAL_QUAD_RESIDUAL_MAX = 0.05;

function findFiducialInRoi(img: GrayImage, threshold: number, cx: number, cy: number, criteria: FiducialCriteria): FiducialHit | null {
  const roiW = Math.round(img.width * criteria.roiScale);
  const roiH = Math.round(img.height * criteria.roiScale);
  const x0 = Math.max(0, Math.min(img.width - roiW, Math.round(cx - roiW / 2)));
  const y0 = Math.max(0, Math.min(img.height - roiH, Math.round(cy - roiH / 2)));
  const visited = new Uint8Array(roiW * roiH);
  let best: (FiducialHit & { fill: number; ratio: number }) | null = null;
  const stack: number[] = [];
  for (let y = 0; y < roiH; y++) {
    for (let x = 0; x < roiW; x++) {
      const idx = y * roiW + x;
      if (visited[idx]) continue;
      visited[idx] = 1;
      if (img.gray[(y0 + y) * img.width + (x0 + x)]! >= threshold) continue;
      let area = 0, sumX = 0, sumY = 0, minX = x, maxX = x, minY = y, maxY = y;
      stack.length = 0;
      stack.push(idx);
      while (stack.length) {
        const cur = stack.pop()!;
        const px = cur % roiW, py = Math.floor(cur / roiW);
        area++; sumX += px; sumY += py;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        const neighbours = [cur - 1, cur + 1, cur - roiW, cur + roiW];
        for (const n of neighbours) {
          if (n < 0 || n >= roiW * roiH || visited[n]) continue;
          const nx = n % roiW;
          if (Math.abs(nx - px) > 1) continue;
          visited[n] = 1;
          const gx = x0 + nx, gy = y0 + Math.floor(n / roiW);
          if (img.gray[gy * img.width + gx]! < threshold) stack.push(n);
        }
      }
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      const fill = area / (bw * bh);
      const ratio = bw / bh;
      const sideOk = bw >= img.width * 0.008 && bw <= img.width * 0.09 && bh >= img.height * 0.006 && bh <= img.height * 0.07;
      if (sideOk && fill >= criteria.minFill && ratio >= criteria.minRatio && ratio <= criteria.maxRatio) {
        if (!best || area > best.area) best = { x: x0 + sumX / area, y: y0 + sumY / area, area, fill, ratio };
      }
    }
  }
  return best;
}

export function computeHomography(src: { x: number; y: number }[], dst: { x: number; y: number }[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[pivot]![col]!)) pivot = r;
    [A[col], A[pivot]] = [A[pivot]!, A[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    const div = A[col]![col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = A[r]![col]! / div;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) A[r]![c]! -= factor * A[col]![c]!;
      b[r]! -= factor * b[col]!;
    }
  }
  const h = A.map((row, i) => b[i]! / row[i]!);
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

function applyHomography(h: number[], x: number, y: number): { x: number; y: number } {
  const w = h[6]! * x + h[7]! * y + h[8]!;
  return { x: (h[0]! * x + h[1]! * y + h[2]!) / w, y: (h[3]! * x + h[4]! * y + h[5]!) / w };
}

export function warpToTemplate(img: GrayImage, srcPoints: { x: number; y: number }[]): GrayImage {
  const dst = FIDUCIAL_CENTERS.map((p) => ({ x: p.x, y: p.y }));
  const forward = computeHomography(srcPoints, dst);
  const [a, b, c, d, e, f, g, hh, i] = forward as [number, number, number, number, number, number, number, number, number];
  const det = a * (e * i - f * hh) - b * (d * i - f * g) + c * (d * hh - e * g);
  const inv = [
    (e * i - f * hh) / det, (c * hh - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * hh - e * g) / det, (b * g - a * hh) / det, (a * e - b * d) / det,
  ];
  const out = new Uint8Array(TEMPLATE_WIDTH * TEMPLATE_HEIGHT);
  for (let y = 0; y < TEMPLATE_HEIGHT; y++) {
    for (let x = 0; x < TEMPLATE_WIDTH; x++) {
      const s = applyHomography(inv, x, y);
      if (s.x < 0 || s.y < 0 || s.x >= img.width - 1 || s.y >= img.height - 1) {
        out[y * TEMPLATE_WIDTH + x] = 255;
        continue;
      }
      const x0 = Math.floor(s.x), y0 = Math.floor(s.y);
      const fx = s.x - x0, fy = s.y - y0;
      const p00 = img.gray[y0 * img.width + x0]!, p10 = img.gray[y0 * img.width + x0 + 1]!;
      const p01 = img.gray[(y0 + 1) * img.width + x0]!, p11 = img.gray[(y0 + 1) * img.width + x0 + 1]!;
      out[y * TEMPLATE_WIDTH + x] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
    }
  }
  return { width: TEMPLATE_WIDTH, height: TEMPLATE_HEIGHT, gray: out };
}

export function laplacianVariance(img: GrayImage): number {
  const x0 = Math.floor(img.width * 0.1), x1 = Math.floor(img.width * 0.9);
  const y0 = Math.floor(img.height * 0.1), y1 = Math.floor(img.height * 0.9);
  let sum = 0, sumSq = 0, count = 0;
  for (let y = y0 + 1; y < y1 - 1; y += 2) {
    for (let x = x0 + 1; x < x1 - 1; x += 2) {
      const idx = y * img.width + x;
      const lap = 4 * img.gray[idx]! - img.gray[idx - 1]! - img.gray[idx + 1]! - img.gray[idx - img.width]! - img.gray[idx + img.width]!;
      sum += lap; sumSq += lap * lap; count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function diskOffsets(radius: number): { dx: number; dy: number }[] {
  const offsets: { dx: number; dy: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) offsets.push({ dx, dy });
    }
  }
  return offsets;
}
const DISK9 = diskOffsets(9);
const DISK7 = diskOffsets(7);
const DISK4 = diskOffsets(4);

function diskQuadrants(disk: { dx: number; dy: number }[]): { dx: number; dy: number }[][] {
  const quads: { dx: number; dy: number }[][] = [[], [], [], []];
  for (const o of disk) quads[(o.dx >= 0 ? 1 : 0) + (o.dy >= 0 ? 2 : 0)]!.push(o);
  return quads;
}
const DISK9_QUADRANTS = diskQuadrants(DISK9);
const DISK7_QUADRANTS = diskQuadrants(DISK7);

const MIN_QUADRANT_COVERAGE = 0.45;
const MIN_CENTER_COVERAGE = 0.5;

function meanDisk(img: GrayImage, cx: number, cy: number, offsets: { dx: number; dy: number }[]): number {
  let sum = 0, n = 0;
  for (const { dx, dy } of offsets) {
    const x = Math.round(cx + dx), y = Math.round(cy + dy);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
    sum += img.gray[y * img.width + x]!;
    n++;
  }
  return n === 0 ? 255 : sum / n;
}

function medianOf(img: GrayImage): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of img.gray) hist[v]!++;
  const target = img.gray.length / 2;
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]!; if (acc >= target) return i; }
  return 255;
}

export interface BubbleDecision {
  densities: number[];
  chosen: number | null;
  state: 'filled' | 'blank' | 'ambiguous';
  margin: number;
}

export function decideBubbles(densities: readonly number[], t: OmrThresholds): BubbleDecision {
  const sorted = densities.map((d, i) => ({ d, i })).sort((a, b) => b.d - a.d);
  const top = sorted[0]!, second = sorted[1] ?? { d: 0, i: -1 };
  const margin = top.d - second.d;
  const rounded = densities.map((d) => Math.round(d * 1000) / 1000);
  if (top.d <= t.blankDensity) return { densities: rounded, chosen: null, state: 'blank', margin: Math.round(margin * 1000) / 1000 };
  if (top.d >= t.fillDensity && second.d < t.fillDensity && margin >= t.minMargin) {
    return { densities: rounded, chosen: top.i, state: 'filled', margin: Math.round(margin * 1000) / 1000 };
  }
  return { densities: rounded, chosen: null, state: 'ambiguous', margin: Math.round(margin * 1000) / 1000 };
}

export interface SheetReading {
  slot: number;
  densities: number[];
  chosen: number | null;
  state: 'filled' | 'blank' | 'ambiguous';
  margin: number;
  resolvedBy: 'omr' | null;
  pairChoices?: (number | null)[];
}

export interface ProcessedSheet {
  warped: GrayImage;
  quality: { blurVariance: number; glareRatio: number; fiducialCount: number };
  qualityOk: boolean;
  qualityReasons: string[];
  qrText: string | null;
  readings: SheetReading[];
  bubbleCode: { code: string; checksumOk: boolean } | null;
  variantCode: { code: string } | null;
}

export function processSheetImage(data: Buffer, geometry: SheetGeometry, thresholds: OmrThresholds = DEFAULT_OMR_THRESHOLDS, pairSlots?: ReadonlySet<number>): ProcessedSheet {
  const img = decodeImage(data);
  const threshold = otsuThreshold(img.gray);
  const srcPoints: { x: number; y: number }[] = [];
  let fiducialCount = 0;
  for (const corner of FIDUCIAL_CENTERS) {
    const expected = {
      x: (corner.x / TEMPLATE_WIDTH) * img.width,
      y: (corner.y / TEMPLATE_HEIGHT) * img.height,
    };
    const strict = findFiducialInRoi(img, threshold, expected.x, expected.y, FIDUCIAL_STRICT);
    const relaxed = findFiducialInRoi(img, threshold, expected.x, expected.y, FIDUCIAL_RELAXED);
    let hit: FiducialHit | null = strict;
    if (relaxed && (!strict || relaxed.area > strict.area * FIDUCIAL_AREA_ARBITRATION)) hit = relaxed;
    if (hit) { fiducialCount++; srcPoints.push(hit); } else srcPoints.push(expected);
  }
  if (fiducialCount === 4) {
    const [tl, tr, bl, br] = srcPoints as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
    const residual = Math.hypot(tl.x + br.x - tr.x - bl.x, tl.y + br.y - tr.y - bl.y) / 2;
    if (residual > img.width * FIDUCIAL_QUAD_RESIDUAL_MAX) fiducialCount = 3;
  }
  if (fiducialCount < 4) {
    return {
      warped: img,
      quality: { blurVariance: 0, glareRatio: 0, fiducialCount },
      qualityOk: false,
      qualityReasons: ['missing_fiducials'],
      qrText: null, readings: [], bubbleCode: null, variantCode: null,
    };
  }
  const warped = warpToTemplate(img, srcPoints);
  const blurVariance = laplacianVariance(warped);
  let glare = 0, totalMean = 0;
  for (let i = 0; i < warped.gray.length; i += 7) {
    if (warped.gray[i]! >= 250) glare++;
    totalMean += warped.gray[i]!;
  }
  const samples = Math.ceil(warped.gray.length / 7);
  const glareRatio = glare / samples;
  const mean = totalMean / samples;
  const qualityReasons: string[] = [];
  if (blurVariance < QUALITY_MIN_BLUR_VARIANCE) qualityReasons.push('blurry');
  if (glareRatio > QUALITY_MAX_GLARE_RATIO) qualityReasons.push('glare');
  if (mean < QUALITY_MIN_MEAN) qualityReasons.push('too_dark');

  const paper = medianOf(warped);
  let inkSum = 0;
  for (const c of FIDUCIAL_CENTERS) inkSum += meanDisk(warped, c.x, c.y, DISK7);
  const ink = inkSum / FIDUCIAL_CENTERS.length;
  const range = Math.max(30, paper - ink);
  const densityAt = (cx: number, cy: number, offsets: { dx: number; dy: number }[]) => {
    const mean = meanDisk(warped, cx, cy, offsets);
    return Math.min(1, Math.max(0, (paper - mean) / range));
  };

  const uniformFill = (cx: number, cy: number, quads: { dx: number; dy: number }[][], topDensity: number): boolean => {
    let min = Infinity;
    for (const offs of quads) min = Math.min(min, densityAt(cx, cy, offs));
    if (min < topDensity * MIN_QUADRANT_COVERAGE) return false;
    return densityAt(cx, cy, DISK4) >= topDensity * MIN_CENTER_COVERAGE;
  };

  const readings: SheetReading[] = geometry.rows.map((row) => {
    const densities = row.centers.map((c) => densityAt(c.x, c.y, DISK9));
    const decision = decideBubbles(densities, thresholds);
    if (pairSlots?.has(row.slot)) {
      const pairChoices: (number | null)[] = [];
      let state: 'filled' | 'blank' | 'ambiguous' = 'blank';
      let minMargin = Infinity;
      for (let k = 0; k * 2 + 1 < densities.length; k++) {
        const pair = [densities[k * 2]!, densities[k * 2 + 1]!];
        const pairDecision = decideBubbles(pair, thresholds);
        let pairChosen = pairDecision.chosen;
        let pairState = pairDecision.state;
        if (pairState === 'filled' && pairChosen !== null) {
          const c = row.centers[k * 2 + pairChosen]!;
          if (!uniformFill(c.x, c.y, DISK9_QUADRANTS, pair[pairChosen]!)) { pairState = 'ambiguous'; pairChosen = null; }
        }
        pairChoices.push(pairState === 'filled' ? pairChosen : null);
        if (pairState === 'ambiguous') state = 'ambiguous';
        else if (pairState === 'filled' && state !== 'ambiguous') state = 'filled';
        minMargin = Math.min(minMargin, pairDecision.margin);
      }
      return {
        slot: row.slot,
        densities: decision.densities,
        chosen: null,
        state,
        margin: Math.round(minMargin * 1000) / 1000,
        resolvedBy: state === 'ambiguous' ? null : 'omr',
        pairChoices,
      };
    }
    let chosen = decision.chosen;
    let state = decision.state;
    if (state === 'filled' && chosen !== null) {
      const c = row.centers[chosen]!;
      if (!uniformFill(c.x, c.y, DISK9_QUADRANTS, densities[chosen]!)) { state = 'ambiguous'; chosen = null; }
    }
    return {
      slot: row.slot,
      densities: decision.densities,
      chosen,
      state,
      margin: decision.margin,
      resolvedBy: state === 'ambiguous' ? null : 'omr',
    };
  });

  const readCodeGrid = (cells: CodeCellGeometry[]): string | null => {
    const digitCount = cells.reduce((max, c) => Math.max(max, c.digitIndex + 1), 0);
    const digitsByColumn: number[][] = Array.from({ length: digitCount }, () => []);
    const digitCenters: ({ x: number; y: number } | undefined)[][] = Array.from({ length: digitCount }, () => []);
    for (const cell of cells) {
      digitsByColumn[cell.digitIndex]![cell.value] = densityAt(cell.x, cell.y, DISK7);
      digitCenters[cell.digitIndex]![cell.value] = { x: cell.x, y: cell.y };
    }
    let code = '';
    for (let d = 0; d < digitCount; d++) {
      const densities = digitsByColumn[d]!;
      const decision = decideBubbles(densities, thresholds);
      if (decision.state !== 'filled' || decision.chosen === null) return null;
      const center = digitCenters[d]![decision.chosen];
      if (!center || !uniformFill(center.x, center.y, DISK7_QUADRANTS, densities[decision.chosen]!)) return null;
      code += String(decision.chosen);
    }
    return code.length === digitCount ? code : null;
  };

  const studentCode = readCodeGrid(geometry.codeCells);
  const bubbleCode = studentCode !== null
    ? { code: studentCode, checksumOk: codeChecksumOk(studentCode) }
    : null;

  const variantDigits = readCodeGrid(geometry.variantCodeCells);
  const variantCode = variantDigits !== null ? { code: variantDigits } : null;

  let qrText: string | null;
  try {
    const rgba = new Uint8ClampedArray(TEMPLATE_WIDTH * TEMPLATE_HEIGHT * 4);
    for (let i = 0; i < warped.gray.length; i++) {
      rgba[i * 4] = warped.gray[i]!; rgba[i * 4 + 1] = warped.gray[i]!; rgba[i * 4 + 2] = warped.gray[i]!; rgba[i * 4 + 3] = 255;
    }
    const found = jsQR(rgba, TEMPLATE_WIDTH, TEMPLATE_HEIGHT);
    qrText = found?.data ?? null;
  } catch { qrText = null; }

  return {
    warped,
    quality: { blurVariance: Math.round(blurVariance), glareRatio: Math.round(glareRatio * 1000) / 1000, fiducialCount },
    qualityOk: qualityReasons.length === 0,
    qualityReasons,
    qrText,
    readings,
    bubbleCode,
    variantCode,
  };
}

export function encodePng(img: GrayImage): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  for (let i = 0; i < img.gray.length; i++) {
    png.data[i * 4] = img.gray[i]!; png.data[i * 4 + 1] = img.gray[i]!; png.data[i * 4 + 2] = img.gray[i]!; png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}
