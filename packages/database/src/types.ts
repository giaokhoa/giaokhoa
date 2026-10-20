import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema/index.js';
import type { fileBlobs, files, fileSources, fileUses } from './schema/files.js';
import type {
  curricula,
  curriculumNodes,
  learningOutcomes,
  questionLearningOutcomes,
  questionSubjects,
  subjects,
} from './schema/curriculum.js';
import type {
  question,
  questionBankEntries,
  questionVersions,
  stimuli,
} from './schema/questions.js';

export type Database = NodePgDatabase<typeof schema>;

export type FileRow = typeof files.$inferSelect;
export type FileInsert = typeof files.$inferInsert;
export type FileBlobRow = typeof fileBlobs.$inferSelect;
export type FileUseRow = typeof fileUses.$inferSelect;
export type FileSourceRow = typeof fileSources.$inferSelect;

export type SubjectRow = typeof subjects.$inferSelect;
export type SubjectInsert = typeof subjects.$inferInsert;
export type CurriculumRow = typeof curricula.$inferSelect;
export type CurriculumInsert = typeof curricula.$inferInsert;
export type CurriculumNodeRow = typeof curriculumNodes.$inferSelect;
export type CurriculumNodeInsert = typeof curriculumNodes.$inferInsert;
export type LearningOutcomeRow = typeof learningOutcomes.$inferSelect;
export type LearningOutcomeInsert = typeof learningOutcomes.$inferInsert;
export type QuestionSubjectRow = typeof questionSubjects.$inferSelect;
export type QuestionLearningOutcomeRow = typeof questionLearningOutcomes.$inferSelect;

export type QuestionRow = typeof question.$inferSelect;
export type QuestionInsert = typeof question.$inferInsert;
export type QuestionBankEntryRow = typeof questionBankEntries.$inferSelect;
export type QuestionVersionRow = typeof questionVersions.$inferSelect;
export type StimulusRow = typeof stimuli.$inferSelect;
export type StimulusInsert = typeof stimuli.$inferInsert;
