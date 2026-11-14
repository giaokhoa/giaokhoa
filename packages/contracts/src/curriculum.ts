import { z } from 'zod';
import { courseSectionItemOutcomeSchema, datasetImportCountFields, datasetImportSchema, datasetStatusFields } from './common.js';
import { uuidIdSchema } from './ids.js';


export const curriculumNodeKindSchema = z.enum(['strand', 'topic', 'lesson']);
export type CurriculumNodeKind = z.infer<typeof curriculumNodeKindSchema>;

const positionSchema = z.number().int().positive();
const durationPeriodsSchema = z.number().int().min(0).nullable();
const durationPercentSchema = z.number().min(0).max(100).nullable();

export const createSubjectSchema = z.strictObject({
  contextId: uuidIdSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
  position: positionSchema.optional(),
});
export type CreateSubject = z.infer<typeof createSubjectSchema>;

export const updateSubjectSchema = z.strictObject({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  position: positionSchema.optional(),
});
export type UpdateSubject = z.infer<typeof updateSubjectSchema>;

export const createCurriculumSchema = z.strictObject({
  subjectId: uuidIdSchema,
  grade: z.number().int().min(1).max(12),
});
export type CreateCurriculum = z.infer<typeof createCurriculumSchema>;

export const updateCurriculumSchema = z.strictObject({
  grade: z.number().int().min(1).max(12).optional(),
});
export type UpdateCurriculum = z.infer<typeof updateCurriculumSchema>;

const curriculumNodeDetailFields = {
  kind: curriculumNodeKindSchema.optional(),
  position: positionSchema.optional(),
  durationPeriods: durationPeriodsSchema.optional(),
  durationPercent: durationPercentSchema.optional(),
};

export const createCurriculumNodeSchema = z.strictObject({
  curriculumId: uuidIdSchema,
  parentId: uuidIdSchema.nullable().optional(),
  title: z.string().min(1),
  ...curriculumNodeDetailFields,
});
export type CreateCurriculumNode = z.infer<typeof createCurriculumNodeSchema>;

export const updateCurriculumNodeSchema = z.strictObject({
  parentId: uuidIdSchema.nullable().optional(),
  title: z.string().min(1).optional(),
  ...curriculumNodeDetailFields,
});
export type UpdateCurriculumNode = z.infer<typeof updateCurriculumNodeSchema>;

export const outcomeSourceKindSchema = z.enum(['program', 'derived']);
export type OutcomeSourceKind = z.infer<typeof outcomeSourceKindSchema>;

const learningOutcomeSourceFields = {
  position: positionSchema.optional(),
  sourceKind: outcomeSourceKindSchema.optional(),
  sourceRef: z.string().min(1).nullable().optional(),
  derivedFromId: uuidIdSchema.nullable().optional(),
};

export const createLearningOutcomeSchema = z.strictObject({
  nodeId: uuidIdSchema,
  content: z.string().min(1),
  ...learningOutcomeSourceFields,
});
export type CreateLearningOutcome = z.infer<typeof createLearningOutcomeSchema>;

export const updateLearningOutcomeSchema = z.strictObject({
  content: z.string().min(1).optional(),
  ...learningOutcomeSourceFields,
});
export type UpdateLearningOutcome = z.infer<typeof updateLearningOutcomeSchema>;

export const cognitiveLevelSchema = z.enum(['biet', 'hieu', 'van_dung', 'van_dung_cao']);
export type CognitiveLevel = z.infer<typeof cognitiveLevelSchema>;

export const attachQuestionSubjectSchema = z.strictObject({
  subjectId: uuidIdSchema,
});
export type AttachQuestionSubject = z.infer<typeof attachQuestionSubjectSchema>;

export const attachQuestionOutcomeSchema = z.strictObject({
  outcomeId: uuidIdSchema,
  cognitiveLevel: cognitiveLevelSchema,
});
export type AttachQuestionOutcome = z.infer<typeof attachQuestionOutcomeSchema>;

export const updateQuestionOutcomeLinkSchema = z.strictObject({
  cognitiveLevel: cognitiveLevelSchema,
});
export type UpdateQuestionOutcomeLink = z.infer<typeof updateQuestionOutcomeLinkSchema>;

export const importProgramDatasetSchema = datasetImportSchema;
export type ImportProgramDataset = z.infer<typeof importProgramDatasetSchema>;

export const programDatasetStatusSchema = z.object({
  ...datasetStatusFields,
  grades: z.array(z.number().int()),
  totalRecords: z.number().int(),
  importedRecords: z.number().int(),
  subjectId: uuidIdSchema.nullable(),
  lastImportedAt: z.string().nullable(),
});
export type ProgramDatasetStatus = z.infer<typeof programDatasetStatusSchema>;

export const programImportChangeKindSchema = z.enum(['text-changed', 'added', 'removed', 'moved', 'revived']);
export type ProgramImportChangeKind = z.infer<typeof programImportChangeKindSchema>;

export const programImportChangeSchema = z.object({
  recordId: z.string(),
  position: z.number().int(),
  kind: programImportChangeKindSchema,
  oldText: z.string().optional(),
  newText: z.string().optional(),
  shiftSuspected: z.boolean().optional(),
  identicalTextAmbiguous: z.boolean().optional(),
  linkedQuestions: z.number().int().optional(),
  linkedBookMappings: z.number().int().optional(),
});
export type ProgramImportChange = z.infer<typeof programImportChangeSchema>;

export const programImportResultSchema = z.object({
  datasetKey: z.string(),
  ...datasetImportCountFields,
  outcomesWritten: z.number().int(),
  orphanedNodes: z.number().int(),
  retiredOutcomes: z.number().int(),
  changeCounts: z.object({
    textChanged: z.number().int(),
    added: z.number().int(),
    removed: z.number().int(),
    moved: z.number().int(),
    revived: z.number().int(),
    shiftSuspected: z.number().int(),
  }),
  changes: z.array(programImportChangeSchema),
  changesOmitted: z.number().int(),
});
export type ProgramImportResult = z.infer<typeof programImportResultSchema>;

export const courseSectionFrameOutcomeSchema = courseSectionItemOutcomeSchema;
export type CourseSectionFrameOutcome = z.infer<typeof courseSectionFrameOutcomeSchema>;

export const courseSectionFrameSchema = z.object({
  nodeId: uuidIdSchema.nullable(),
  nodeTitle: z.string(),
  outcomes: z.array(courseSectionFrameOutcomeSchema),
});
export type CourseSectionFrame = z.infer<typeof courseSectionFrameSchema>;

export const applyCurriculumFrameSchema = z.strictObject({
  curriculumId: uuidIdSchema,
  nodeIds: z.array(uuidIdSchema).min(1),
  insertAtSection: z.number().int().min(1).optional(),
});
export type ApplyCurriculumFrame = z.infer<typeof applyCurriculumFrameSchema>;

