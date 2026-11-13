
export type ArchiveJsonValue =
  | string
  | number
  | boolean
  | null
  | ArchiveJsonValue[]
  | { [key: string]: ArchiveJsonValue | undefined };

export interface CourseRow {
  id: string;
  tenantId: string;
  category: string;
  fullName: string;
  shortName: string;
  idNumber: string;
  summary: string;
  format: string;
  visible: boolean;
  startDate: Date | null;
  endDate: Date | null;
  groupMode: number;
  groupModeForce: boolean;
  enableCompletion: boolean;
  subjectId: string | null;
  grade: number | null;
  isTemplate: boolean;
  classId: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseSectionsRow {
  id: string;
  course: string;
  section: number;
  name: string | null;
  summary: string;
  visible: boolean;
  availability: unknown | null;
  openAt: Date | null;
  updatedAt: Date;
}

export interface CourseModulesRow {
  id: string;
  course: string;
  section: string;
  component: string;
  instanceId: string | null;
  name: string;
  visible: boolean;
  groupMode: number;
  availability: unknown | null;
  completion: number;
  completionView: boolean;
  completionUseGrade: boolean;
  completionManual: boolean;
  completionExpected: Date | null;
  openAt: Date | null;
  sortOrder: number;
  deletionInProgress: boolean;
  added: Date;
}

export interface EnrolRow {
  id: string;
  courseId: string;
  enrol: string;
  status: number;
  name: string | null;
  roleId: string | null;
  enrolPeriod: number;
  timeStart: Date | null;
  timeEnd: Date | null;
  customInt1: string | null;
  customInt2: string | null;
  customText1: string;
  cost: number;
  currency: string;
  paymentAccountId: string | null;
  enrolmentKey: string | null;
  sendWelcomeMessage: boolean;
  welcomeMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserEnrolmentsRow {
  id: string;
  enrolId: string;
  userId: string;
  status: number;
  timeStart: Date;
  timeEnd: Date | null;
  modifierId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseGroupsRow {
  id: string;
  courseId: string;
  name: string;
  idNumber: string;
  description: string;
  enrolmentKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupsMembersRow {
  id: string;
  groupId: string;
  userId: string;
  timeAdded: Date;
  component: string;
  itemId: string | null;
}

export interface GroupingsRow {
  id: string;
  courseId: string;
  name: string;
  idNumber: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupingsGroupsRow {
  groupingId: string;
  groupId: string;
  timeAdded: Date;
}

export interface GradeItemsRow {
  id: string;
  courseId: string;
  itemName: string;
  itemType: string;
  itemModule: string | null;
  itemInstance: string | null;
  gradeType: string;
  gradeMax: number;
  gradeMin: number;
  gradePass: number;
  idNumber: string | null;
  multiplicator: number;
  plusFactor: number;
  hidden: boolean;
  locked: boolean;
  sortOrder: number;
  postingPolicy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GradeGradesRow {
  id: string;
  itemId: string;
  userId: string;
  rawGrade: number | null;
  rawGradeMax: number;
  rawGradeMin: number;
  finalGrade: number | null;
  hidden: boolean;
  locked: boolean;
  lockTime: Date | null;
  overridden: boolean;
  excluded: boolean;
  frozen: boolean;
  feedback: string | null;
  information: string | null;
  aggregationStatus: string;
  aggregationWeight: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseModulesCompletionRow {
  id: string;
  courseModuleId: string;
  userId: string;
  completionState: number;
  viewed: boolean;
  overrideBy: string | null;
  updatedAt: Date;
}

export interface CourseCompletionsRow {
  id: string;
  userId: string;
  course: string;
  status: string;
  timeEnrolled: Date;
  timeStarted: Date | null;
  timeCompleted: Date | null;
  reAggregate: Date;
}

export interface CourseCompletionCriteriaRow {
  id: string;
  course: string;
  criteriaType: string;
  moduleInstance: string | null;
  date: Date | null;
  courseInstance: string | null;
  enrolPeriodDays: number | null;
  roleId: string | null;
  sortOrder: number;
  createdAt: Date;
}

export interface CourseCompletionCritComplRow {
  id: string;
  criteriaId: string;
  userId: string;
  markedBy: string | null;
  timeCompleted: Date;
}

export interface CourseCompletionSettingsRow {
  course: string;
  method: number;
}

export interface FilesRow {
  id: string;
  contentHash: string;
  contextId: string;
  component: string;
  fileArea: string;
  itemId: string | null;
  filePath: string;
  fileName: string;
  userId: string | null;
  fileSize: number;
  mimeType: string | null;
  status: number;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionCategoriesRow {
  id: string;
  name: string;
  contextId: string;
  bankId: string | null;
  info: string;
  parent: string | null;
  sortOrder: number;
  stamp: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionRow {
  id: string;
  category: string;
  qtype: string;
  createdBy: string | null;
  modifiedBy: string | null;
  derivedFromQuestionId: string | null;
  derivedFromVersionId: string | null;
  derivedFromBankId: string | null;
  originalAuthorId: string | null;
  sourceKind: string | null;
  sourceRef: string | null;
  idnumber: string | null;
  copyCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionBankEntriesRow {
  id: string;
  questionCategoryId: string;
  questionId: string;
  latestVersion: number;
  status: string;
  withdrawnReason: string | null;
  withdrawnBy: string | null;
  withdrawnAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionVersionsRow {
  id: string;
  questionBankEntryId: string;
  questionId: string;
  version: number;
  status: string;
  questionText: ArchiveJsonValue;
  generalFeedback: ArchiveJsonValue | null;
  defaultMark: number;
  penalty: number;
  stimulusId: string | null;
  createdAt: Date;
}

export interface StimuliRow {
  id: string;
  categoryId: string;
  createdBy: string | null;
  content: ArchiveJsonValue;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuestionAnswersRow {
  id: string;
  questionVersionId: string;
  answer: ArchiveJsonValue;
  isCorrect: boolean;
  feedback: ArchiveJsonValue | null;
  sortOrder: number;
}

export interface QuestionAnswerKeysRow {
  id: string;
  questionVersionId: string;
  guidance: ArchiveJsonValue | null;
  solution: ArchiveJsonValue | null;
}

export interface QtypeMultichoiceOptionsRow {
  id: string;
  questionVersionId: string;
  shuffleAnswers: boolean;
  answerNumbering: string;
  correctFeedback: ArchiveJsonValue | null;
  incorrectFeedback: ArchiveJsonValue | null;
  showStandardInstruction: boolean;
}

export interface QuestionTruefalseRow {
  id: string;
  questionVersionId: string;
  trueAnswer: string;
  falseAnswer: string;
  showStandardInstruction: boolean;
}

export interface QtypeShortanswerOptionsRow {
  id: string;
  questionVersionId: string;
  useCase: boolean;
  numericAnswer: boolean;
  numericMaxLength: number | null;
  numericAllowSign: boolean;
  numericAllowDecimal: boolean;
}

export interface QtypeEssayOptionsRow {
  id: string;
  questionVersionId: string;
  responseFormat: string;
  responseRequired: boolean;
  responseFieldLines: number;
  minWordLimit: number | null;
  maxWordLimit: number | null;
  graderInfo: ArchiveJsonValue | null;
  responseTemplate: ArchiveJsonValue | null;
}

export interface BadgeRow {
  id: string;
  name: string;
  description: string;
  type: number;
  courseId: string | null;
  issuerName: string;
  issuerUrl: string;
  issuerContact: string;
  expireDate: Date | null;
  expirePeriod: number | null;
  status: number;
  version: string;
  language: string;
  userCreated: string | null;
  userModified: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BadgeCriteriaRow {
  id: string;
  badgeId: string;
  criteriaType: string;
  method: number;
  params: unknown;
  description: string;
}

export interface CalendarEventsRow {
  id: string;
  name: string;
  description: string;
  eventType: string;
  courseId: string | null;
  groupId: string | null;
  categoryId: string | null;
  userId: string | null;
  contextId: string | null;
  subscriptionId: string | null;
  uuid: string | null;
  repeatId: string | null;
  rrule: string | null;
  isException: boolean;
  exceptionOf: string | null;
  timeStart: Date;
  timeDuration: number;
  visible: boolean;
  location: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CalendarSubscriptionsRow {
  id: string;
  name: string;
  url: string | null;
  icsData: string | null;
  eventType: string;
  courseId: string | null;
  categoryId: string | null;
  userId: string | null;
  pollInterval: number;
  lastUpdated: Date | null;
  createdAt: Date;
}
