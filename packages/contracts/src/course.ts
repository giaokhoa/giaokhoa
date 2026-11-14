import { z } from 'zod';
import { namedEntityInputFields } from './common.js';
import { uuidIdSchema } from './ids.js';
import { courseSectionFrameSchema } from './curriculum.js';
import { courseSectionBookFrameSchema } from './books.js';


export const GROUPMODE = { NOGROUPS: 0, SEPARATEGROUPS: 1, VISIBLEGROUPS: 2 } as const;
export const ENROL_STATUS = { ACTIVE: 0, SUSPENDED: 1, WITHDRAWN: 2 } as const;
export const COMPLETION_STATE = { INCOMPLETE: 0, COMPLETE: 1, COMPLETE_PASS: 2, COMPLETE_FAIL: 3 } as const;

export const courseCategorySchema = z.object({
  id: uuidIdSchema,
  name: z.string(),
  idNumber: z.string().nullable(),
  description: z.string(),
  parent: uuidIdSchema.nullable(),
  sortOrder: z.number().int(),
  path: z.string(),
  depth: z.number().int(),
  visible: z.boolean(),
});
export type CourseCategory = z.infer<typeof courseCategorySchema>;

export interface CourseCategoryTreeNode extends CourseCategory {
  children: CourseCategoryTreeNode[];
}
export const courseCategoryTreeNodeSchema: z.ZodType<CourseCategoryTreeNode> = courseCategorySchema.extend({
  children: z.lazy(() => z.array(courseCategoryTreeNodeSchema)),
});
export const courseCategoryTreeSchema = z.array(courseCategoryTreeNodeSchema);

export const courseSchema = z.object({
  id: uuidIdSchema,
  category: uuidIdSchema,
  fullName: z.string(),
  shortName: z.string(),
  idNumber: z.string(),
  summary: z.string(),
  format: z.string(),
  visible: z.boolean(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  groupMode: z.number().int(),
  groupModeForce: z.boolean().default(false),
  enableCompletion: z.boolean(),
  subjectId: uuidIdSchema.nullable().default(null),
  grade: z.number().int().nullable().default(null),
  isTemplate: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});
export type Course = z.infer<typeof courseSchema>;

export const courseItemStatusSchema = z.enum(['draft', 'open', 'scheduled']);
export type CourseItemStatus = z.infer<typeof courseItemStatusSchema>;

export const availabilityResultSchema = z.object({
  available: z.boolean(),
  visible: z.boolean(),
  failedDescriptions: z.array(z.string()),
});
export type AvailabilityResult = z.infer<typeof availabilityResultSchema>;

export const courseModuleSchema = z.object({
  id: uuidIdSchema,
  course: uuidIdSchema,
  section: uuidIdSchema,
  component: z.string(),
  instanceId: uuidIdSchema,
  name: z.string(),
  visible: z.boolean(),
  groupMode: z.number().int(),
  availability: z.unknown().nullable(),
  completion: z.number().int(),
  completionView: z.boolean(),
  completionManual: z.boolean(),
  sortOrder: z.number().int().default(0),
  openAt: z.string().nullable().default(null),
  status: courseItemStatusSchema.optional(),
  contextId: uuidIdSchema.optional(),
  availabilityResult: availabilityResultSchema.optional(),
});
export type CourseModule = z.infer<typeof courseModuleSchema>;

export const courseSectionSchema = z.object({
  id: uuidIdSchema,
  course: uuidIdSchema,
  section: z.number().int(),
  name: z.string().nullable(),
  summary: z.string(),
  visible: z.boolean(),
  availability: z.unknown().nullable(),
  openAt: z.string().nullable().default(null),
  status: courseItemStatusSchema.optional(),
  availabilityResult: availabilityResultSchema.optional(),
  frame: courseSectionFrameSchema.nullable().optional(),
  bookFrame: courseSectionBookFrameSchema.nullable().optional(),
  modules: z.array(courseModuleSchema),
});
export type CourseSection = z.infer<typeof courseSectionSchema>;

export const courseContentSchema = z.object({
  course: courseSchema,
  contextId: uuidIdSchema,
  customFields: z.array(z.object({ shortName: z.string(), value: z.string().nullable() })),
  sections: z.array(courseSectionSchema),
});
export type CourseContent = z.infer<typeof courseContentSchema>;

const namedEntityViewFields = {
  name: z.string(),
  idNumber: z.string(),
  description: z.string(),
};

export const courseGroupSchema = z.object({
  id: uuidIdSchema,
  courseId: uuidIdSchema,
  ...namedEntityViewFields,
  enrolmentKey: z.string().nullable().optional(),
});
export type CourseGroup = z.infer<typeof courseGroupSchema>;

export const cohortSchema = z.object({
  id: uuidIdSchema,
  ...namedEntityViewFields,
  contextId: uuidIdSchema,
  visible: z.boolean(),
});
export type Cohort = z.infer<typeof cohortSchema>;

export const courseGroupingSchema = z.object({
  id: uuidIdSchema,
  courseId: uuidIdSchema,
  ...namedEntityViewFields,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type CourseGrouping = z.infer<typeof courseGroupingSchema>;

export const enrolInstanceSchema = z.object({
  id: uuidIdSchema,
  courseId: uuidIdSchema,
  enrol: z.string(),
  status: z.number().int(),
  name: z.string().nullable(),
  roleId: uuidIdSchema.nullable(),
  customInt1: uuidIdSchema.nullable(),
  customInt2: uuidIdSchema.nullable(),
  customText1: z.string(),
  cost: z.number().int(),
  currency: z.string(),
  enrolmentKey: z.string().nullable().optional(),
  sendWelcomeMessage: z.boolean().optional(),
  welcomeMessage: z.string().nullable().optional(),
});
export type EnrolInstance = z.infer<typeof enrolInstanceSchema>;

export const userEnrolmentSchema = z.object({
  id: uuidIdSchema,
  enrolId: uuidIdSchema,
  userId: uuidIdSchema,
  status: z.number().int(),
  timeStart: z.string(),
  timeEnd: z.string().nullable(),
  enrolMethod: z.string().optional(),
});
export type UserEnrolment = z.infer<typeof userEnrolmentSchema>;

export const courseCompletionSchema = z.object({
  id: uuidIdSchema,
  userId: uuidIdSchema,
  course: uuidIdSchema,
  status: z.string(),
  timeCompleted: z.string().nullable(),
});
export type CourseCompletion = z.infer<typeof courseCompletionSchema>;

export const availabilityOps = ['&', '|', '!&', '!|'] as const;


export const createCourseCategorySchema = z.strictObject({
  ...namedEntityInputFields,
  parent: uuidIdSchema.optional(),
  visible: z.boolean().optional(),
});
export type CreateCourseCategory = z.infer<typeof createCourseCategorySchema>;

export const updateCourseCategorySchema = createCourseCategorySchema.partial();
export type UpdateCourseCategory = z.infer<typeof updateCourseCategorySchema>;

const courseGroupSubjectFields = {
  groupMode: z.number().int().optional(),
  groupModeForce: z.boolean().optional(),
  subjectId: uuidIdSchema.nullable().optional(),
  grade: z.number().int().min(1).max(12).nullable().optional(),
};

export const createCourseSchema = z.strictObject({
  fullName: z.string().min(1),
  shortName: z.string().min(1),
  category: uuidIdSchema,
  idNumber: z.string().optional(),
  summary: z.string().optional(),
  format: z.string().optional(),
  visible: z.boolean().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  ...courseGroupSubjectFields,
  classId: uuidIdSchema.nullable().optional(),
  formatOptions: z.record(z.string(), z.string()).optional(),
  customFields: z.record(z.string(), z.string()).optional(),
});
export type CreateCourse = z.infer<typeof createCourseSchema>;

export const updateCourseSchema = z.strictObject({
  fullName: z.string().optional(),
  shortName: z.string().optional(),
  category: uuidIdSchema.optional(),
  idNumber: z.string().optional(),
  summary: z.string().optional(),
  format: z.string().optional(),
  visible: z.boolean().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  ...courseGroupSubjectFields,
  isTemplate: z.boolean().optional(),
  formatOptions: z.record(z.string(), z.string()).optional(),
  customFields: z.record(z.string(), z.string()).optional(),
});
export type UpdateCourse = z.infer<typeof updateCourseSchema>;

export const createCourseSectionSchema = z.strictObject({
  name: z.string().optional(),
  summary: z.string().optional(),
  visible: z.boolean().optional(),
  availability: z.unknown().optional(),
  openAt: z.string().nullable().optional(),
});
export type CreateCourseSection = z.infer<typeof createCourseSectionSchema>;

export const updateCourseSectionSchema = createCourseSectionSchema.partial();
export type UpdateCourseSection = z.infer<typeof updateCourseSectionSchema>;

const courseModuleSettingsFields = {
  name: z.string().optional(),
  visible: z.boolean().optional(),
  groupMode: z.number().int().optional(),
  availability: z.unknown().optional(),
  completion: z.number().int().optional(),
  completionView: z.boolean().optional(),
  completionUseGrade: z.boolean().optional(),
  completionManual: z.boolean().optional(),
};

export const createCourseModuleSchema = z.strictObject({
  sectionId: uuidIdSchema,
  component: z.string().min(1),
  instanceId: uuidIdSchema.optional(),
  ...courseModuleSettingsFields,
  completionExpected: z.string().optional(),
  openAt: z.string().nullable().optional(),
});
export type CreateCourseModule = z.infer<typeof createCourseModuleSchema>;

export const updateCourseModuleSchema = z.strictObject({
  ...courseModuleSettingsFields,
  completionExpected: z.string().nullable().optional(),
  openAt: z.string().nullable().optional(),
  sectionId: uuidIdSchema.optional(),
});
export type UpdateCourseModule = z.infer<typeof updateCourseModuleSchema>;

export const COURSE_CONTENT_TYPES = [
  { component: 'mod_page', createsInstance: false },
  { component: 'mod_resource', createsInstance: false },
  { component: 'mod_quiz', createsInstance: true },
  { component: 'mod_assign', createsInstance: true },
] as const;
export type CourseContentType = (typeof COURSE_CONTENT_TYPES)[number]['component'];

export const duplicateCourseSchema = z.strictObject({
  fullName: z.string().min(1),
  shortName: z.string().min(1),
  category: uuidIdSchema.optional(),
  startDate: z.string().optional(),
  classId: uuidIdSchema.nullable().optional(),
});
export type DuplicateCourse = z.infer<typeof duplicateCourseSchema>;

export const reorderCourseSectionsSchema = z.strictObject({
  sectionIds: z.array(uuidIdSchema).min(1),
});
export type ReorderCourseSections = z.infer<typeof reorderCourseSectionsSchema>;

export const reorderCourseModulesSchema = z.strictObject({
  moduleIds: z.array(uuidIdSchema).min(1),
});
export type ReorderCourseModules = z.infer<typeof reorderCourseModulesSchema>;

export const copyCourseContentSchema = z.strictObject({
  sourceCourseId: uuidIdSchema,
  sectionIds: z.array(uuidIdSchema).optional(),
  moduleIds: z.array(uuidIdSchema).optional(),
});
export type CopyCourseContent = z.infer<typeof copyCourseContentSchema>;

export const createGroupSchema = z.strictObject({
  ...namedEntityInputFields,
  enrolmentKey: z.string().min(1).optional(),
});
export type CreateGroup = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.strictObject({
  name: z.string().min(1).optional(),
  idNumber: z.string().optional(),
  description: z.string().optional(),
  enrolmentKey: z.string().min(1).nullable().optional(),
});
export type UpdateGroup = z.infer<typeof updateGroupSchema>;

export const groupMemberSchema = z.strictObject({
  userId: uuidIdSchema,
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

export const createGroupingSchema = z.strictObject({
  ...namedEntityInputFields,
});
export type CreateGrouping = z.infer<typeof createGroupingSchema>;

export const groupingGroupSchema = z.strictObject({
  groupId: uuidIdSchema,
});
export type GroupingGroup = z.infer<typeof groupingGroupSchema>;

export const createCohortSchema = z.strictObject({
  ...namedEntityInputFields,
  categoryId: uuidIdSchema.optional(),
  visible: z.boolean().optional(),
});
export type CreateCohort = z.infer<typeof createCohortSchema>;

export const updateCohortSchema = z.strictObject({
  name: z.string().optional(),
  idNumber: z.string().optional(),
  description: z.string().optional(),
  visible: z.boolean().optional(),
});
export type UpdateCohort = z.infer<typeof updateCohortSchema>;

export const createEnrolInstanceSchema = z.strictObject({
  method: z.string(),
  name: z.string().optional(),
  roleShortname: z.string().optional(),
  status: z.number().int().optional(),
  enrolPeriod: z.number().int().optional(),
  cohortId: uuidIdSchema.optional(),
  groupId: uuidIdSchema.optional(),
  onCohortLeave: z.enum(['suspend', 'unenrol']).optional(),
  cost: z.number().int().optional(),
  currency: z.string().optional(),
  paymentAccountId: uuidIdSchema.optional(),
  enrolmentKey: z.string().min(1).optional(),
  sendWelcomeMessage: z.boolean().optional(),
  welcomeMessage: z.string().optional(),
});
export type CreateEnrolInstance = z.infer<typeof createEnrolInstanceSchema>;

export const updateEnrolInstanceSchema = z.strictObject({
  name: z.string().optional(),
  status: z.number().int().optional(),
  enrolPeriod: z.number().int().optional(),
  onCohortLeave: z.enum(['suspend', 'unenrol']).optional(),
  groupId: uuidIdSchema.optional(),
  roleShortname: z.string().optional(),
  enrolmentKey: z.string().min(1).nullable().optional(),
  sendWelcomeMessage: z.boolean().optional(),
  welcomeMessage: z.string().nullable().optional(),
});
export type UpdateEnrolInstance = z.infer<typeof updateEnrolInstanceSchema>;

export const selfEnrolSchema = z.strictObject({
  enrolmentKey: z.string().optional(),
});
export type SelfEnrol = z.infer<typeof selfEnrolSchema>;

export const enrolUserSchema = z.strictObject({
  userId: uuidIdSchema,
  timeStart: z.string().optional(),
  timeEnd: z.string().optional(),
});
export type EnrolUser = z.infer<typeof enrolUserSchema>;

export const CONTENT_COMPLETION_MODES = ['view', 'manual', 'progress', 'none'] as const;
export type ContentCompletionMode = (typeof CONTENT_COMPLETION_MODES)[number];

export const createPageSchema = z.strictObject({
  sectionId: uuidIdSchema,
  name: z.string().min(1),
  content: z.string().optional(),
  completionMode: z.enum(CONTENT_COMPLETION_MODES).optional(),
});
export type CreatePage = z.infer<typeof createPageSchema>;

export const updatePageSchema = z.strictObject({
  name: z.string().min(1).optional(),
  content: z.string().optional(),
  completionMode: z.enum(CONTENT_COMPLETION_MODES).optional(),
});
export type UpdatePage = z.infer<typeof updatePageSchema>;

function isSafeExternalResourceUrl(url: string): boolean {
  let start = 0;
  while (start < url.length && (url.charCodeAt(start) <= 0x1f || /\s/u.test(url[start]!))) start += 1;
  const normalized = url.slice(start).toLowerCase();
  return normalized.startsWith('http://') || normalized.startsWith('https://');
}

export const externalResourceUrlSchema = z.string().min(1).refine(isSafeExternalResourceUrl, {
  message: 'url must use the http or https scheme',
});

export const createResourceSchema = z.strictObject({
  sectionId: uuidIdSchema,
  name: z.string().min(1),
  kind: z.enum(['file', 'url']),
  fileId: uuidIdSchema.optional(),
  url: externalResourceUrlSchema.optional(),
  transcript: z.string().optional(),
  completionMode: z.enum(CONTENT_COMPLETION_MODES).optional(),
});
export type CreateResource = z.infer<typeof createResourceSchema>;

export const updateResourceSchema = z.strictObject({
  name: z.string().min(1).optional(),
  fileId: uuidIdSchema.nullable().optional(),
  url: externalResourceUrlSchema.nullable().optional(),
  transcript: z.string().nullable().optional(),
  completionMode: z.enum(CONTENT_COMPLETION_MODES).optional(),
});
export type UpdateResource = z.infer<typeof updateResourceSchema>;

export const recordProgressSchema = z.strictObject({
  percent: z.number().min(0).max(100).optional(),
  positionSeconds: z.number().min(0).optional(),
  page: z.number().int().min(1).optional(),
});
export type RecordProgress = z.infer<typeof recordProgressSchema>;

export const createLessonTemplateSchema = z.strictObject({
  title: z.string().min(1).optional(),
});
export type CreateLessonTemplate = z.infer<typeof createLessonTemplateSchema>;
