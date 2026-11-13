import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';


export interface BookRecordSource {
  document: string;
  volume: string;
  artifact: string;
  portal: string;
}

export interface BookRecord {
  id: string;
  subject: string;
  grade: number;
  volume: number;
  chapterNumber: number;
  chapter: string;
  lessonNumber: number | null;
  lesson: string;
  periods: number | null;
  programRecords: string[];
  source: BookRecordSource;
}

export interface BookDatasetFile {
  book: string;
  series: string;
  publisher: string;
  records: BookRecord[];
}

interface RawBookRecord {
  id: string;
  subject: string;
  grade: number;
  volume: number;
  chapter_number: number;
  chapter: string;
  lesson_number: number | null;
  lesson: string;
  periods: number | null;
  program_records: string[];
  source: BookRecordSource;
}

export interface BookDatasetDef {
  key: string;
  subjectName: string;
  slug: string;
  bookTitle: string;
  grade: number;
  programDatasetKey: string;
  fileName: string;
  attributionPublic: boolean;
}

export const BOOK_DATASETS: readonly BookDatasetDef[] = [
  { key: 'sgk-toan-1', subjectName: 'Toán', slug: 'toan', bookTitle: 'Toán 1', grade: 1, programDatasetKey: 'toan', fileName: 'book-toan-1.json', attributionPublic: true },
];

export function bookDatasetByKey(key: string): BookDatasetDef | undefined {
  return BOOK_DATASETS.find((d) => d.key === key);
}

export function loadBookDataset(def: BookDatasetDef): BookDatasetFile {
  const raw = JSON.parse(readFileSync(join(__dirname, 'book-data', def.fileName), 'utf8')) as {
    book: string; series: string; publisher: string; records: RawBookRecord[];
  };
  return {
    book: raw.book,
    series: raw.series,
    publisher: raw.publisher,
    records: raw.records.map((r) => ({
      id: r.id,
      subject: r.subject,
      grade: r.grade,
      volume: r.volume,
      chapterNumber: r.chapter_number,
      chapter: r.chapter,
      lessonNumber: r.lesson_number,
      lesson: r.lesson,
      periods: r.periods,
      programRecords: r.program_records,
      source: r.source,
    })),
  };
}

export function bookRecordHash(record: BookRecord): string {
  const canonical = JSON.stringify([
    record.id, record.subject, record.grade, record.volume,
    record.chapterNumber, record.chapter, record.lessonNumber, record.lesson,
    record.periods, record.programRecords, record.source,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function bookRecordSourceRef(record: BookRecord): string {
  return `${record.source.document} — ${record.source.volume} — bản ghi ${record.id}`;
}
