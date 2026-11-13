
export type AggregationStrategy =
  | 'natural' | 'mean' | 'weightedmean' | 'simpleweightedmean'
  | 'median' | 'lowest' | 'highest' | 'mode' | 'sum';

export const AGGREGATIONS: AggregationStrategy[] = [
  'natural', 'mean', 'weightedmean', 'simpleweightedmean', 'median', 'lowest', 'highest', 'mode', 'sum',
];

export interface CalcItemInput {
  itemId: string;
  gradeMin: number;
  gradeMax: number;
  grade: number | null;
  excluded?: boolean;
  extraCredit?: boolean;
  weightOverride?: boolean;
  weight?: number;
  aggregationCoef?: number;
  multiplicator?: number;
  offset?: number;
  frozen?: boolean;
}

export interface CategoryCalcInput {
  aggregation: AggregationStrategy;
  gradeMin: number;
  gradeMax: number;
  dropLow?: number;
  keepHigh?: number;
  aggregateOnlyGraded?: boolean;
  items: CalcItemInput[];
}

export interface CategoryCalcResult {
  finalGrade: number | null;
  gradeMin: number;
  gradeMax: number;
  weights: Record<string, number>;
  fraction: number | null;
}

const EPS = 1e-9;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function adjustedGrade(item: CalcItemInput): number | null {
  if (item.grade === null || item.grade === undefined) return null;
  if (item.frozen) return clamp(item.grade, item.gradeMin, item.gradeMax);
  const mult = item.multiplicator ?? 1;
  const off = item.offset ?? 0;
  return clamp(item.grade * mult + off, item.gradeMin, item.gradeMax);
}

function norm(item: CalcItemInput, adjusted: number): number {
  const range = item.gradeMax - item.gradeMin;
  if (range <= 0) return 0;
  return (adjusted - item.gradeMin) / range;
}

interface Prepared {
  item: CalcItemInput;
  adjusted: number;
  fraction: number;
  isExtra: boolean;
}

export function naturalWeights(items: CalcItemInput[]): Record<string, number> {
  const nonExtra = items.filter((i) => !i.extraCredit);
  const weights: Record<string, number> = {};
  const overridden = nonExtra.filter((i) => i.weightOverride);
  const rest = nonExtra.filter((i) => !i.weightOverride);
  const usedByOverride = overridden.reduce((s, i) => s + (i.weight ?? 0), 0);
  for (const i of overridden) weights[i.itemId] = i.weight ?? 0;
  const remaining = Math.max(0, 100 - usedByOverride);
  const restRange = rest.reduce((s, i) => s + Math.max(0, i.gradeMax - i.gradeMin), 0);
  for (const i of rest) {
    weights[i.itemId] = restRange > 0 ? (remaining * Math.max(0, i.gradeMax - i.gradeMin)) / restRange : (rest.length ? remaining / rest.length : 0);
  }
  const nonExtraRange = nonExtra.reduce((s, i) => s + Math.max(0, i.gradeMax - i.gradeMin), 0);
  for (const i of items) {
    if (i.extraCredit) {
      weights[i.itemId] = i.weightOverride ? (i.weight ?? 0)
        : nonExtraRange > 0 ? (100 * Math.max(0, i.gradeMax - i.gradeMin)) / nonExtraRange : 0;
    }
  }
  return weights;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mode(values: number[]): number {
  const counts = new Map<string, { value: number; count: number }>();
  for (const v of values) {
    const key = v.toFixed(9);
    const entry = counts.get(key) ?? { value: v, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  let best: { value: number; count: number } | undefined;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.value ?? 0;
}

export function calculateCategory(input: CategoryCalcInput): CategoryCalcResult {
  const dropLow = Math.max(0, input.dropLow ?? 0);
  const keepHigh = Math.max(0, input.keepHigh ?? 0);

  const prepared: Prepared[] = [];
  for (const item of input.items) {
    if (item.excluded) continue;
    const adjusted = adjustedGrade(item);
    if (adjusted === null) {
      if (input.aggregateOnlyGraded) continue;
      prepared.push({ item, adjusted: item.gradeMin, fraction: 0, isExtra: !!item.extraCredit });
    } else {
      prepared.push({ item, adjusted, fraction: norm(item, adjusted), isExtra: !!item.extraCredit });
    }
  }

  const nonExtraAll = input.items.filter((i) => !i.excluded && !i.extraCredit);
  const structuralRange = nonExtraAll.reduce((s, i) => s + Math.max(0, i.gradeMax - i.gradeMin), 0);

  let weights: Record<string, number> = {};
  if (input.aggregation === 'natural') {
    weights = naturalWeights(prepared.map((p) => p.item));
  }

  if (prepared.length === 0) {
    const gradeMax = input.aggregation === 'natural' || input.aggregation === 'sum'
      ? input.gradeMin + structuralRange : input.gradeMax;
    return { finalGrade: null, gradeMin: input.gradeMin, gradeMax, weights, fraction: null };
  }

  let main = prepared.filter((p) => !p.isExtra);
  const extras = prepared.filter((p) => p.isExtra);
  if (keepHigh > 0 && main.length > keepHigh) {
    main = [...main].sort((a, b) => b.fraction - a.fraction).slice(0, keepHigh);
  }
  if (dropLow > 0 && main.length > dropLow) {
    main = [...main].sort((a, b) => a.fraction - b.fraction).slice(dropLow);
  }

  let fraction: number | null = null;
  let gradeMax = input.gradeMax;
  let gradeMin = input.gradeMin;

  switch (input.aggregation) {
    case 'natural': {
      gradeMin = input.gradeMin;
      gradeMax = input.gradeMin + structuralRange;
      const anyOverride = main.some((p) => p.item.weightOverride) || extras.some((p) => p.item.weightOverride);
      if (!anyOverride) {
        const denom = main.reduce((s, p) => s + Math.max(0, p.item.gradeMax - p.item.gradeMin), 0);
        const numer = main.reduce((s, p) => s + (p.adjusted - p.item.gradeMin), 0)
          + extras.reduce((s, p) => s + (p.adjusted - p.item.gradeMin), 0);
        fraction = denom > 0 ? numer / denom : (extras.length ? 1 : null);
        if (fraction === null) break;
      } else {
        const w = naturalWeights([...main, ...extras].map((p) => p.item));
        weights = w;
        const numer = main.reduce((s, p) => s + p.fraction * (w[p.item.itemId] ?? 0), 0)
          + extras.reduce((s, p) => s + p.fraction * (w[p.item.itemId] ?? 0), 0);
        fraction = numer / 100;
      }
      break;
    }
    case 'sum': {
      gradeMin = input.gradeMin;
      gradeMax = input.gradeMin + structuralRange;
      const total = main.reduce((s, p) => s + (p.adjusted - p.item.gradeMin), 0)
        + extras.reduce((s, p) => s + (p.adjusted - p.item.gradeMin), 0);
      fraction = structuralRange > 0 ? total / structuralRange : null;
      if (fraction !== null) {
        const finalGrade = clamp(input.gradeMin + total, gradeMin, gradeMax);
        return { finalGrade, gradeMin, gradeMax, weights, fraction: structuralRange > 0 ? (finalGrade - gradeMin) / structuralRange : 0 };
      }
      break;
    }
    case 'mean': {
      if (main.length) fraction = main.reduce((s, p) => s + p.fraction, 0) / main.length;
      break;
    }
    case 'weightedmean': {
      const denom = main.reduce((s, p) => s + (p.item.aggregationCoef ?? p.item.weight ?? 1), 0);
      if (main.length && denom > 0) {
        fraction = main.reduce((s, p) => s + p.fraction * (p.item.aggregationCoef ?? p.item.weight ?? 1), 0) / denom;
      }
      break;
    }
    case 'simpleweightedmean': {
      const denom = main.reduce((s, p) => s + Math.max(0, p.item.gradeMax - p.item.gradeMin), 0);
      if (main.length && denom > 0) {
        fraction = main.reduce((s, p) => s + p.fraction * Math.max(0, p.item.gradeMax - p.item.gradeMin), 0) / denom;
      }
      break;
    }
    case 'median': if (main.length) fraction = median(main.map((p) => p.fraction)); break;
    case 'lowest': if (main.length) fraction = Math.min(...main.map((p) => p.fraction)); break;
    case 'highest': if (main.length) fraction = Math.max(...main.map((p) => p.fraction)); break;
    case 'mode': if (main.length) fraction = mode(main.map((p) => p.fraction)); break;
  }

  if (fraction === null) return { finalGrade: null, gradeMin, gradeMax, weights, fraction: null };
  const capped = clamp(fraction, 0, 1);
  const finalGrade = gradeMin + capped * (gradeMax - gradeMin);
  void EPS;
  return { finalGrade, gradeMin, gradeMax, weights, fraction: capped };
}

export function letterForGrade(
  finalGrade: number, gradeMin: number, gradeMax: number,
  letters: { letter: string; lowerBoundary: number }[],
): string | null {
  if (!letters.length || gradeMax <= gradeMin) return null;
  const pct = ((finalGrade - gradeMin) / (gradeMax - gradeMin)) * 100;
  const sorted = [...letters].sort((a, b) => b.lowerBoundary - a.lowerBoundary);
  for (const l of sorted) {
    if (pct >= l.lowerBoundary - EPS) return l.letter;
  }
  return null;
}
