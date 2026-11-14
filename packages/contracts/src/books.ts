import { z } from 'zod';
import { courseSectionItemOutcomeSchema, datasetImportCountFields, datasetImportSchema, datasetStatusFields } from './common.js';
import { uuidIdSchema } from './ids.js';

export const BOOK_KINDS = ['textbook', 'reference', 'workbook', 'other'] as const;
export type BookKind = (typeof BOOK_KINDS)[number];

export const importBookDatasetSchema = datasetImportSchema;
export type ImportBookDataset = z.infer<typeof importBookDatasetSchema>;

export const bookDatasetStatusSchema = z.object({
  ...datasetStatusFields,
  bookTitle: z.string(),
  grade: z.number().int(),
  totalRecords: z.number().int(),
  importedRecords: z.number().int(),
  mappedRecords: z.number().int(),
  bookId: uuidIdSchema.nullable(),
  subjectId: uuidIdSchema.nullable(),
  lastImportedAt: z.string().nullable(),
});
export type BookDatasetStatus = z.infer<typeof bookDatasetStatusSchema>;

export const bookImportResultSchema = z.object({
  datasetKey: z.string(),
  bookId: uuidIdSchema,
  ...datasetImportCountFields,
  mappingsWritten: z.number().int(),
});
export type BookImportResult = z.infer<typeof bookImportResultSchema>;

export const bookSchema = z.object({
  id: uuidIdSchema,
  kind: z.string(),
  title: z.string(),
  subjectId: uuidIdSchema.nullable(),
  grade: z.number().int().nullable(),
  series: z.string().nullable(),
  author: z.string().nullable(),
  publisher: z.string().nullable(),
  publishedYear: z.number().int().nullable(),
  isbn: z.string().nullable(),
  attributionPublic: z.boolean(),
  position: z.number().int(),
});
export type Book = z.infer<typeof bookSchema>;

export const bookMappingViewSchema = z.object({
  curriculumNodeId: uuidIdSchema.nullable(),
  learningOutcomeId: uuidIdSchema.nullable(),
  programRecordId: z.string().nullable(),
  targetTitle: z.string().nullable(),
});
export type BookMappingView = z.infer<typeof bookMappingViewSchema>;

export const bookLessonViewSchema = z.object({
  id: uuidIdSchema,
  title: z.string(),
  volume: z.number().int().nullable(),
  lessonNumber: z.number().int().nullable(),
  position: z.number().int(),
  recordId: z.string().nullable(),
  mappings: z.array(bookMappingViewSchema),
  outcomes: z.array(z.object({ outcomeId: uuidIdSchema, content: z.string() })),
});
export type BookLessonView = z.infer<typeof bookLessonViewSchema>;

export const bookChapterViewSchema = z.object({
  id: uuidIdSchema,
  title: z.string(),
  volume: z.number().int().nullable(),
  position: z.number().int(),
  lessons: z.array(bookLessonViewSchema),
});
export type BookChapterView = z.infer<typeof bookChapterViewSchema>;

export const bookTreeViewSchema = z.object({
  book: bookSchema,
  subject: z.object({ id: uuidIdSchema, name: z.string(), slug: z.string() }).nullable(),
  chapters: z.array(bookChapterViewSchema),
});
export type BookTreeView = z.infer<typeof bookTreeViewSchema>;

export const applyBookFrameSchema = z.strictObject({
  bookId: uuidIdSchema,
  chapterNodeIds: z.array(uuidIdSchema).min(1),
  insertAtSection: z.number().int().min(1).optional(),
});
export type ApplyBookFrame = z.infer<typeof applyBookFrameSchema>;

export const courseSectionBookItemOutcomeSchema = courseSectionItemOutcomeSchema;
export type CourseSectionBookItemOutcome = z.infer<typeof courseSectionBookItemOutcomeSchema>;

export const courseSectionBookItemSchema = z.object({
  nodeId: uuidIdSchema.nullable(),
  title: z.string(),
  outcomes: z.array(courseSectionBookItemOutcomeSchema),
});
export type CourseSectionBookItem = z.infer<typeof courseSectionBookItemSchema>;

export const courseSectionBookFrameSchema = z.object({
  nodeId: uuidIdSchema.nullable(),
  bookId: uuidIdSchema.nullable(),
  nodeTitle: z.string(),
  items: z.array(courseSectionBookItemSchema),
});
export type CourseSectionBookFrame = z.infer<typeof courseSectionBookFrameSchema>;
