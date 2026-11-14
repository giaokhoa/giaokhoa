import { describe, expect, it } from 'vitest';
import {
  approveExamContributionSchema, approveExamDossierSchema, approveMatrixContributionSchema,
  addCompetencyEvidenceSchema, addItemTagSchema, assignGradeViewSchema,
  assignOwnSubmissionViewSchema, assignSubmissionDetailSchema, assignSubmissionSummarySchema,
  assignmentListResponseSchema, bookDatasetStatusSchema, bookImportResultSchema,
  capabilityMatrixRoleSchema,
  classJoinRequestSchema, classRosterMemberSchema, classStaffMemberSchema, classSuspendedMemberSchema,
  cohortSchema, courseGroupSchema, courseGroupingSchema, courseSectionBookItemOutcomeSchema,
  courseSectionFrameOutcomeSchema, createAssignAnnotationSchema, createAssignmentSchema,
  createCohortSchema, createCompetencyFrameworkSchema, createCompetencySchema,
  createCourseCategorySchema, createCourseModuleSchema, createCourseSchema,
  createCouponSchema, createExamMatrixCellSchema, createExamMatrixSchema,
  createExamPinOverrideSchema, createExamPinSchema, createExamSchema, createGroupSchema,
  createGradeItemSchema, createGroupingSchema, createLearningOutcomeSchema,
  createCurriculumNodeSchema, createQuestionSchema, frameworkExportCompetencySchema, frameworkExportSchema,
  gradeUserCompetencySchema, hardDeleteMessageSchema, importBookDatasetSchema,
  importProgramDatasetSchema, listNotificationGroupsQuerySchema,
  listNotificationItemsQuerySchema, loginResponseSchema,
  markCourseCriteriaCompletionSchema, markManualCompletionSchema,
  mcpBatchItemResultSchema, mcpBatchQuestionItemSchema, mcpCreateQuestionInputSchema,
  mcpCreateQuestionOutputSchema, mcpStimulusQuestionItemSchema,
  mcpSubmitContributionOutputSchema, messageSchema, messageSearchResultSchema,
  myContextCapabilitiesSchema, myRoleAssignmentSchema, myTenantSchema,
  notificationPreferenceSchema, paperRowGeometrySchema, personProfileSchema,
  personSummarySchema, pinRegradeChangeSchema, pinRegradeLogItemSchema,
  programDatasetStatusSchema, programImportResultSchema,
  questionSolutionInputSchema, questionSolutionSchema,
  quizViewSchema, examPinOverrideViewSchema,
  rejectContributionSchema, rejectExamContributionSchema, rejectExamDossierSchema,
  rejectMatrixContributionSchema, rejectRefundSchema, rejectSystemBankSubmissionSchema,
  rejectSystemExamSchema, replaceRoleCapabilitiesSchema, sessionLoginResponseSchema,
  setItemTagsSchema, tenantSchema, updateAssignAnnotationSchema, updateAssignmentSchema,
  updateCouponSchema, updateCourseModuleSchema, updateCourseSchema, updateExamMatrixCellSchema,
  updateExamMatrixSchema, updateExamPinOverrideSchema, updateExamPinSchema, updateExamSchema,
  updateGradeItemSchema, updateLearningOutcomeSchema, updateCurriculumNodeSchema, updateQuestionSchema,
  userListResponseSchema, userProfileSchema, userWithAssignmentsListItemSchema,
  userWithAssignmentsListResponseSchema, withdrawExamMatrixSchema,
  withdrawExamSchema, withdrawQuestionSchema, withdrawSystemResourceSchema,
  assignAnnotationViewSchema, capabilityOverrideSchema, courseSectionItemOutcomeSchema,
  datasetImportSchema, limitedReasonInputSchema, loginUserSchema, markUserCompletionSchema,
  matrixCellAvailabilitySchema, matrixImportCellAvailabilitySchema,
  matrixImportPreviewCellSchema, normalizedPointSchema, pointSchema, reasonInputSchema,
  statementValueSchema, trimmedReasonInputSchema,
} from './index.js';

const userId = '01900000-0000-7000-8000-000000000001';
const otherId = '01900000-0000-7000-8000-000000000002';

describe('Nhóm lý do từ chối rút gọn còn một trường reason bắt buộc', () => {
  it('chấp nhận reason hợp lệ ở cả bốn schema từ chối trong assessment', () => {
    for (const schema of [rejectMatrixContributionSchema, withdrawQuestionSchema, rejectContributionSchema, rejectExamContributionSchema]) {
      expect(schema.parse({ reason: 'Không đạt chuẩn' })).toEqual({ reason: 'Không đạt chuẩn' });
    }
  });

  it('từ chối reason rỗng, thiếu reason và khóa lạ ở cả bốn schema', () => {
    for (const schema of [rejectMatrixContributionSchema, withdrawQuestionSchema, rejectContributionSchema, rejectExamContributionSchema]) {
      expect(() => schema.parse({ reason: '' })).toThrow();
      expect(() => schema.parse({})).toThrow();
      expect(() => schema.parse({ reason: 'x', extra: 1 })).toThrow();
    }
  });
});

describe('Nhóm lý do đã trim chỉ còn một trường reason', () => {
  it('cắt khoảng trắng hai đầu reason ở cả ba schema', () => {
    for (const schema of [withdrawExamSchema, withdrawExamMatrixSchema, rejectExamDossierSchema]) {
      expect(schema.parse({ reason: '  muộn  ' })).toEqual({ reason: 'muộn' });
    }
  });

  it('từ chối reason chỉ toàn khoảng trắng ở cả ba schema', () => {
    for (const schema of [withdrawExamSchema, withdrawExamMatrixSchema, rejectExamDossierSchema]) {
      expect(() => schema.parse({ reason: '   ' })).toThrow();
    }
  });
});

describe('Nhóm lý do đã trim và giới hạn 500 ký tự', () => {
  it('chấp nhận reason hợp lệ ở cả năm schema', () => {
    for (const schema of [hardDeleteMessageSchema, rejectRefundSchema, rejectSystemBankSubmissionSchema, withdrawSystemResourceSchema, rejectSystemExamSchema]) {
      expect(schema.parse({ reason: 'Vi phạm quy định' })).toEqual({ reason: 'Vi phạm quy định' });
    }
  });

  it('từ chối reason dài 501 ký tự ở cả năm schema', () => {
    for (const schema of [hardDeleteMessageSchema, rejectRefundSchema, rejectSystemBankSubmissionSchema, withdrawSystemResourceSchema, rejectSystemExamSchema]) {
      expect(() => schema.parse({ reason: 'x'.repeat(501) })).toThrow();
    }
  });
});

describe('Nhóm phê duyệt không có body', () => {
  it('chấp nhận object rỗng ở cả ba schema phê duyệt', () => {
    for (const schema of [approveMatrixContributionSchema, approveExamContributionSchema, approveExamDossierSchema]) {
      expect(schema.parse({})).toEqual({});
    }
  });

  it('từ chối khóa lạ ở cả ba schema phê duyệt', () => {
    for (const schema of [approveMatrixContributionSchema, approveExamContributionSchema, approveExamDossierSchema]) {
      expect(() => schema.parse({ note: 'x' })).toThrow();
    }
  });
});

describe('Nhóm đánh dấu hoàn thành cho một người học', () => {
  it('chấp nhận userId và complete ở cả hai schema', () => {
    for (const schema of [markCourseCriteriaCompletionSchema, markManualCompletionSchema]) {
      expect(schema.parse({ userId, complete: true })).toEqual({ userId, complete: true });
    }
  });

  it('từ chối userId không phải UUID và thiếu complete ở cả hai schema', () => {
    for (const schema of [markCourseCriteriaCompletionSchema, markManualCompletionSchema]) {
      expect(() => schema.parse({ userId: 'not-a-uuid', complete: true })).toThrow();
      expect(() => schema.parse({ userId })).toThrow();
    }
  });
});

describe('Nhóm đáp án đúng sai theo từng mệnh đề', () => {
  it('chấp nhận mảng mệnh đề có ít nhất một phần tử ở cả hai schema đáp án', () => {
    expect(questionSolutionSchema.parse({ statements: [{ statementId: 's1', value: true }] })).toEqual({
      statements: [{ statementId: 's1', value: true }],
    });
    expect(questionSolutionInputSchema.parse({ answers: [{ statementId: 's1', value: false }] })).toEqual({
      answers: [{ statementId: 's1', value: false }],
    });
  });

  it('từ chối mảng mệnh đề rỗng và statementId rỗng ở cả hai schema đáp án', () => {
    expect(() => questionSolutionSchema.parse({ statements: [] })).toThrow();
    expect(() => questionSolutionSchema.parse({ statements: [{ statementId: '', value: true }] })).toThrow();
    expect(() => questionSolutionInputSchema.parse({ answers: [] })).toThrow();
    expect(() => questionSolutionInputSchema.parse({ answers: [{ statementId: '', value: true }] })).toThrow();
  });
});

describe('Nhóm phản hồi câu hỏi khi tạo và cập nhật', () => {
  const generalFeedback = {
    type: 'doc' as const,
    content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Phản hồi chung' }] }],
  };
  const guidance = {
    type: 'doc' as const,
    content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Hướng dẫn làm bài' }] }],
  };

  it('giữ nguyên bốn trường phản hồi khi tạo và khi cập nhật câu hỏi', () => {
    const created = createQuestionSchema.parse({
      categoryId: userId, qtype: 'essay', questionText: 'Hãy phân tích...',
      generalFeedback, guidance, defaultMark: 1, penalty: 0.25,
    });
    expect(created.generalFeedback).toEqual(generalFeedback);
    expect(created.guidance).toEqual(guidance);
    expect(created.defaultMark).toBe(1);
    expect(created.penalty).toBe(0.25);
    const updated = updateQuestionSchema.parse({
      generalFeedback, guidance, defaultMark: 1, penalty: 0.25,
    });
    expect(updated.generalFeedback).toEqual(generalFeedback);
    expect(updated.guidance).toEqual(guidance);
    expect(updated.defaultMark).toBe(1);
    expect(updated.penalty).toBe(0.25);
  });
});

describe('Nhóm điểm chú thích giới hạn 0 đến 100', () => {
  const annotation = { fileId: userId, x: 10, y: 90, kind: 'note' as const };

  it('chấp nhận điểm trong khoảng 0 đến 100 ở cả hai schema chú thích', () => {
    expect(createAssignAnnotationSchema.parse({ ...annotation, points: [{ x: 0, y: 100 }] }).points).toEqual([{ x: 0, y: 100 }]);
    expect(updateAssignAnnotationSchema.parse({ points: [{ x: 0, y: 100 }] }).points).toEqual([{ x: 0, y: 100 }]);
  });

  it('từ chối điểm vượt 100 hoặc nhỏ hơn 0 ở cả hai schema chú thích', () => {
    expect(() => createAssignAnnotationSchema.parse({ ...annotation, points: [{ x: 101, y: 50 }] })).toThrow();
    expect(() => updateAssignAnnotationSchema.parse({ points: [{ x: 50, y: -1 }] })).toThrow();
  });
});

describe('Nhóm điểm hai chiều không giới hạn', () => {
  it('chấp nhận điểm ngoài khoảng 0 đến 100 trong view chú thích vì view không giới hạn', () => {
    const parsed = assignAnnotationViewSchema.parse({
      id: userId, submissionId: userId, fileId: userId, page: 1, x: 1234, y: -5, kind: 'note',
      color: null, text: null, points: [{ x: 1234, y: -5 }], authorId: userId,
      createdAt: '2026-11-14T00:00:00.000Z', updatedAt: '2026-11-14T00:00:00.000Z',
    });
    expect(parsed.points).toEqual([{ x: 1234, y: -5 }]);
  });

  it('chấp nhận tọa độ tâm hàng giấy quét ngoài khoảng 0 đến 100', () => {
    expect(paperRowGeometrySchema.parse({ slot: 1, centers: [{ x: 500, y: 600 }] })).toEqual({
      slot: 1, centers: [{ x: 500, y: 600 }],
    });
  });
});

describe('Nhóm nhập dataset theo datasetKey', () => {
  it('chấp nhận datasetKey hợp lệ ở cả hai schema nhập dataset', () => {
    expect(importBookDatasetSchema.parse({ datasetKey: 'toan-10' })).toEqual({ datasetKey: 'toan-10' });
    expect(importProgramDatasetSchema.parse({ datasetKey: 'toan-10' })).toEqual({ datasetKey: 'toan-10' });
  });

  it('từ chối datasetKey rỗng ở cả hai schema nhập dataset', () => {
    expect(() => importBookDatasetSchema.parse({ datasetKey: '' })).toThrow();
    expect(() => importProgramDatasetSchema.parse({ datasetKey: '' })).toThrow();
  });
});

describe('Nhóm kết quả đầu ra của mục trong khung chương trình', () => {
  it('chấp nhận outcomeId null và content ở cả hai schema', () => {
    expect(courseSectionBookItemOutcomeSchema.parse({ outcomeId: null, content: 'Hiểu khái niệm' })).toEqual({ outcomeId: null, content: 'Hiểu khái niệm' });
    expect(courseSectionFrameOutcomeSchema.parse({ outcomeId: userId, content: 'Hiểu khái niệm' })).toEqual({ outcomeId: userId, content: 'Hiểu khái niệm' });
  });

  it('từ chối khi thiếu content ở cả hai schema', () => {
    expect(() => courseSectionBookItemOutcomeSchema.parse({ outcomeId: null })).toThrow();
    expect(() => courseSectionFrameOutcomeSchema.parse({ outcomeId: null })).toThrow();
  });
});

describe('Nhóm văn bản song ngữ Việt Anh', () => {
  it('chấp nhận label và description đủ hai ngôn ngữ trong tùy chọn thông báo', () => {
    const parsed = notificationPreferenceSchema.parse({
      provider: 'moodle', component: 'mod_assign', group: 'learning',
      label: { vi: 'Nộp bài', en: 'Submit' }, description: { vi: 'Mô tả', en: 'Description' },
      teacherOnly: false, mandatoryInApp: false, popupEnabled: true,
      emailFrequency: null, emailAvailable: true, siteEnabled: true,
    });
    expect(parsed.label).toEqual({ vi: 'Nộp bài', en: 'Submit' });
  });

  it('từ chối label thiếu bản tiếng Anh trong tùy chọn thông báo', () => {
    expect(() => notificationPreferenceSchema.parse({
      provider: 'moodle', component: 'mod_assign', group: 'learning',
      label: { vi: 'Nộp bài' }, description: { vi: 'Mô tả', en: 'Description' },
      teacherOnly: false, mandatoryInApp: false, popupEnabled: true,
      emailFrequency: null, emailAvailable: true, siteEnabled: true,
    })).toThrow();
  });
});

describe('Nhóm người dùng trong phản hồi đăng nhập', () => {
  const user = { id: userId, username: 'teacher1', forcePasswordChange: false };

  it('chấp nhận cùng một khối user ở cả hai phản hồi đăng nhập', () => {
    expect(loginResponseSchema.parse({
      accessToken: 'a', refreshToken: 'r', expiresIn: 3600, user,
    }).user).toEqual(user);
    expect(sessionLoginResponseSchema.parse({ user, sessionId: otherId }).user).toEqual(user);
  });

  it('từ chối user thiếu forcePasswordChange ở cả hai phản hồi đăng nhập', () => {
    const partial = { id: userId, username: 'teacher1' };
    expect(() => loginResponseSchema.parse({
      accessToken: 'a', refreshToken: 'r', expiresIn: 3600, user: partial,
    })).toThrow();
    expect(() => sessionLoginResponseSchema.parse({ user: partial, sessionId: otherId })).toThrow();
  });
});

describe('Nhóm ghi đè quyền theo capability', () => {
  it('chấp nhận overrides hợp lệ ở cả hai schema ma trận quyền', () => {
    expect(replaceRoleCapabilitiesSchema.parse({
      contextId: userId, overrides: [{ capability: 'mod/assign:grade', permission: 1 }],
    }).overrides).toEqual([{ capability: 'mod/assign:grade', permission: 1 }]);
    expect(capabilityMatrixRoleSchema.parse({
      id: userId, name: 'Teacher', userCount: 2, overrides: [{ capability: 'mod/assign:grade', permission: -1 }],
    }).overrides).toEqual([{ capability: 'mod/assign:grade', permission: -1 }]);
  });

  it('từ chối permission không phải số nguyên và capability rỗng ở cả hai schema', () => {
    expect(() => replaceRoleCapabilitiesSchema.parse({
      contextId: userId, overrides: [{ capability: 'mod/assign:grade', permission: 1.5 }],
    })).toThrow();
    expect(() => capabilityMatrixRoleSchema.parse({
      id: userId, name: 'Teacher', userCount: 2, overrides: [{ capability: '', permission: 1 }],
    })).toThrow();
  });
});

describe('Nhóm phân trang danh sách', () => {
  it('chấp nhận total page pageSize ở cả ba phản hồi danh sách', () => {
    expect(userListResponseSchema.parse({
      users: [], total: 0, page: 1, pageSize: 20,
    })).toEqual({ users: [], total: 0, page: 1, pageSize: 20 });
    expect(assignmentListResponseSchema.parse({
      assignments: [], total: 0, page: 1, pageSize: 20,
    })).toEqual({ assignments: [], total: 0, page: 1, pageSize: 20 });
    expect(userWithAssignmentsListResponseSchema.parse({
      users: [], total: 0, page: 1, pageSize: 20,
    })).toEqual({ users: [], total: 0, page: 1, pageSize: 20 });
  });

  it('từ chối page bằng 0 ở cả ba phản hồi danh sách', () => {
    expect(() => userListResponseSchema.parse({ users: [], total: 0, page: 0, pageSize: 20 })).toThrow();
    expect(() => assignmentListResponseSchema.parse({ assignments: [], total: 0, page: 0, pageSize: 20 })).toThrow();
    expect(() => userWithAssignmentsListResponseSchema.parse({ users: [], total: 0, page: 0, pageSize: 20 })).toThrow();
  });
});

describe('Nhóm nội dung câu hỏi MCP', () => {
  it('chấp nhận nội dung câu hỏi tối thiểu ở cả ba schema nhập câu hỏi MCP', () => {
    expect(mcpCreateQuestionInputSchema.parse({
      bankId: userId, categoryId: userId, qtype: 'essay', questionText: 'Giải thích', idempotencyKey: 'k1',
    }).questionText).toBe('Giải thích');
    expect(mcpBatchQuestionItemSchema.parse({
      clientItemId: 'c1', qtype: 'essay', questionText: 'Giải thích',
    }).questionText).toBe('Giải thích');
    expect(mcpStimulusQuestionItemSchema.parse({
      qtype: 'essay', questionText: 'Giải thích',
    }).questionText).toBe('Giải thích');
  });

  it('từ chối defaultMark bằng 0 và penalty vượt 1 ở cả ba schema nhập câu hỏi MCP', () => {
    expect(() => mcpCreateQuestionInputSchema.parse({
      bankId: userId, categoryId: userId, qtype: 'essay', questionText: 'x', defaultMark: 0, idempotencyKey: 'k1',
    })).toThrow();
    expect(() => mcpBatchQuestionItemSchema.parse({
      clientItemId: 'c1', qtype: 'essay', questionText: 'x', penalty: 2,
    })).toThrow();
    expect(() => mcpStimulusQuestionItemSchema.parse({
      qtype: 'essay', questionText: 'x', defaultMark: 0,
    })).toThrow();
  });
});

describe('Nhóm kết quả đóng góp MCP', () => {
  const output = {
    targetBankId: userId,
    results: [{ questionId: userId, status: 'pending' as const, contributionId: null, code: null, message: null }],
    created: 1, failed: 0,
  };

  it('chấp nhận kết quả đóng góp với status pending và contributionId null', () => {
    expect(mcpSubmitContributionOutputSchema.parse(output).results[0].status).toBe('pending');
  });

  it('từ chối status ngoài tập pending failed trong kết quả đóng góp', () => {
    expect(() => mcpSubmitContributionOutputSchema.parse({
      ...output,
      results: [{ questionId: userId, status: 'done', contributionId: null, code: null, message: null }],
    })).toThrow();
  });
});

describe('Nhóm định danh thành viên lớp', () => {
  const identity = { userId, firstName: 'Lan', lastName: 'Nguyễn', username: 'lan', email: 'lan@example.com' };

  it('chấp nhận đủ bốn trường định danh ở cả bốn view thành viên lớp', () => {
    expect(classRosterMemberSchema.parse({ ...identity, timeAdded: '2026-11-14T00:00:00.000Z' }).email).toBe('lan@example.com');
    expect(classStaffMemberSchema.parse({ ...identity, isOwner: false, roles: [] }).username).toBe('lan');
    expect(classJoinRequestSchema.parse({
      id: userId, classId: userId, ...identity, status: 'pending' as const,
      createdAt: '2026-11-14T00:00:00.000Z', decidedAt: null,
    }).firstName).toBe('Lan');
    expect(classSuspendedMemberSchema.parse(identity).lastName).toBe('Nguyễn');
  });

  it('từ chối khi thiếu email ở cả bốn view thành viên lớp', () => {
    const { email: _email, ...withoutEmail } = identity;
    expect(() => classRosterMemberSchema.parse({ ...withoutEmail, timeAdded: '2026-11-14T00:00:00.000Z' })).toThrow();
    expect(() => classStaffMemberSchema.parse({ ...withoutEmail, isOwner: false, roles: [] })).toThrow();
    expect(() => classJoinRequestSchema.parse({
      id: userId, classId: userId, ...withoutEmail, status: 'pending' as const,
      createdAt: '2026-11-14T00:00:00.000Z', decidedAt: null,
    })).toThrow();
    expect(() => classSuspendedMemberSchema.parse(withoutEmail)).toThrow();
  });
});

describe('Nhóm thực thể có tên dùng cho tạo mới', () => {
  it('chấp nhận name kèm idNumber và description tùy chọn ở cả bốn schema tạo mới', () => {
    expect(createCourseCategorySchema.parse({ name: 'Toán', idNumber: 'MATH', description: 'Môn Toán' }).name).toBe('Toán');
    expect(createGroupSchema.parse({ name: 'Nhóm 1' }).name).toBe('Nhóm 1');
    expect(createGroupingSchema.parse({ name: 'Cụm 1', description: 'Cụm' }).name).toBe('Cụm 1');
    expect(createCohortSchema.parse({ name: 'Khóa 1' }).name).toBe('Khóa 1');
  });

  it('từ chối name rỗng ở cả bốn schema tạo mới', () => {
    for (const schema of [createCourseCategorySchema, createGroupSchema, createGroupingSchema, createCohortSchema]) {
      expect(() => schema.parse({ name: '' })).toThrow();
    }
  });
});

describe('Nhóm thực thể có tên trong view khóa học', () => {
  it('chấp nhận name idNumber description ở cả ba view', () => {
    expect(courseGroupSchema.parse({
      id: userId, courseId: userId, name: 'Nhóm 1', idNumber: 'G1', description: 'Mô tả',
    }).idNumber).toBe('G1');
    expect(cohortSchema.parse({
      id: userId, name: 'Khóa 1', idNumber: 'K1', description: 'Mô tả', contextId: userId, visible: true,
    }).idNumber).toBe('K1');
    expect(courseGroupingSchema.parse({
      id: userId, courseId: userId, name: 'Cụm 1', idNumber: 'C1', description: 'Mô tả',
    }).idNumber).toBe('C1');
  });

  it('từ chối khi thiếu description ở cả ba view', () => {
    expect(() => courseGroupSchema.parse({ id: userId, courseId: userId, name: 'x', idNumber: 'G1' })).toThrow();
    expect(() => cohortSchema.parse({ id: userId, name: 'x', idNumber: 'K1', contextId: userId, visible: true })).toThrow();
    expect(() => courseGroupingSchema.parse({ id: userId, courseId: userId, name: 'x', idNumber: 'C1' })).toThrow();
  });
});

describe('Nhóm thực thể có shortName dùng cho tạo mới trong engagement', () => {
  it('chấp nhận shortName kèm idNumber và description ở cả hai schema tạo mới', () => {
    expect(createCompetencyFrameworkSchema.parse({
      shortName: 'NL1', scale: { values: ['a'], proficient: [1] },
    }).shortName).toBe('NL1');
    expect(createCompetencySchema.parse({ shortName: 'NL1', description: 'Năng lực' }).shortName).toBe('NL1');
  });

  it('từ chối shortName rỗng ở cả hai schema tạo mới', () => {
    expect(() => createCompetencyFrameworkSchema.parse({ shortName: '', scale: { values: ['a'], proficient: [1] } })).toThrow();
    expect(() => createCompetencySchema.parse({ shortName: '' })).toThrow();
  });
});

describe('Nhóm trạng thái bài tập đã nộp', () => {
  const core = {
    status: 'submitted' as const, attemptNumber: 1, submittedAt: '2026-11-14T00:00:00.000Z',
    late: false, files: [], grade: null, annotations: [], rubricEvaluations: [],
  };

  it('chấp nhận cùng một khối trạng thái nộp bài ở cả hai view bài nộp', () => {
    expect(assignOwnSubmissionViewSchema.parse({
      submissionId: userId, ...core, feedbackMessages: [],
    }).status).toBe('submitted');
    expect(assignSubmissionDetailSchema.parse({
      userId, ...core, revisions: [], feedbackMessages: [],
    }).status).toBe('submitted');
  });

  it('giữ nguyên danh sách tệp đính kèm trong output của cả hai view bài nộp', () => {
    const files = [{
      fileId: userId, fileName: 'bai.pdf', fileSize: 1024, mimeType: 'application/pdf',
      contentHash: 'abc', signedUrl: 'https://example.com/bai.pdf', signedUrlExpiresAt: 1790000000,
    }];
    expect(assignOwnSubmissionViewSchema.parse({
      submissionId: userId, ...core, files, feedbackMessages: [],
    }).files).toEqual(files);
    expect(assignSubmissionDetailSchema.parse({
      userId, ...core, files, revisions: [], feedbackMessages: [],
    }).files).toEqual(files);
    expect(() => assignOwnSubmissionViewSchema.parse({
      submissionId: userId, status: 'submitted' as const, attemptNumber: 1,
      submittedAt: '2026-11-14T00:00:00.000Z', late: false, grade: null,
      annotations: [], rubricEvaluations: [], feedbackMessages: [],
    })).toThrow();
    expect(() => assignSubmissionDetailSchema.parse({
      userId, status: 'submitted' as const, attemptNumber: 1,
      submittedAt: '2026-11-14T00:00:00.000Z', late: false, grade: null,
      annotations: [], rubricEvaluations: [], revisions: [], feedbackMessages: [],
    })).toThrow();
  });

  it('từ chối status ngoài tập trạng thái nộp bài ở cả hai view bài nộp', () => {
    expect(() => assignOwnSubmissionViewSchema.parse({
      submissionId: userId, ...core, status: 'done', feedbackMessages: [],
    })).toThrow();
    expect(() => assignSubmissionDetailSchema.parse({
      userId, ...core, status: 'done', revisions: [], feedbackMessages: [],
    })).toThrow();
  });

  it('giữ nguyên phần tóm tắt bài nộp vì chỉ trùng bốn trường đầu của khối trạng thái', () => {
    expect(assignSubmissionSummarySchema.parse({
      userId, displayName: 'Lan', status: 'submitted', attemptNumber: 1,
      submittedAt: '2026-11-14T00:00:00.000Z', late: false, fileCount: 0,
      grade: null, level: null, feedback: null, gradeStatus: 'none',
    }).status).toBe('submitted');
  });
});

describe('Nhóm cài đặt bài tập khi tạo và cập nhật', () => {
  it('chấp nhận cùng một khối cài đặt ở cả hai schema bài tập', () => {
    expect(createAssignmentSchema.parse({
      sectionId: userId, name: 'Bài 1', maxFiles: 3, grade: 10, resultMode: 'score',
    }).maxFiles).toBe(3);
    expect(updateAssignmentSchema.parse({ maxFiles: 3, grade: 10, resultMode: 'score' }).maxFiles).toBe(3);
  });

  it('từ chối maxFiles bằng 0 và vượt 50 ở cả hai schema bài tập', () => {
    expect(() => createAssignmentSchema.parse({ sectionId: userId, name: 'Bài 1', maxFiles: 0 })).toThrow();
    expect(() => updateAssignmentSchema.parse({ maxFiles: 51 })).toThrow();
  });
});

describe('Nhóm ghi đè mã pin bài kiểm tra', () => {
  const override = {
    timeOpen: '2026-11-14T00:00:00.000Z', timeClose: null, timeLimitSeconds: 3600,
    attempts: 2, password: 'secret', reason: 'Gia hạn',
  };

  it('chấp nhận cùng một khối ghi đè ở cả hai schema mã pin', () => {
    expect(createExamPinOverrideSchema.parse({ groupId: userId, ...override }).attempts).toBe(2);
    expect(updateExamPinOverrideSchema.parse(override).attempts).toBe(2);
  });

  it('từ chối attempts âm và timeLimitSeconds bằng 0 ở cả hai schema mã pin', () => {
    expect(() => createExamPinOverrideSchema.parse({ ...override, attempts: -1 })).toThrow();
    expect(() => updateExamPinOverrideSchema.parse({ ...override, timeLimitSeconds: 0 })).toThrow();
  });
});

describe('Nhóm trường đề thi khi tạo và cập nhật', () => {
  const paper = {
    subjectId: userId, grade: 10, examKind: 'midterm' as const, totalScore: 10,
    durationMinutes: 90, tfScale: [20, 20, 20, 20, 20], matrixId: null,
  };

  it('chấp nhận cùng một khối trường đề thi ở cả hai schema đề thi', () => {
    expect(createExamSchema.parse({ name: 'Đề 1', ...paper }).durationMinutes).toBe(90);
    expect(updateExamSchema.parse(paper).durationMinutes).toBe(90);
  });

  it('từ chối grade vượt 12 và tfScale sai độ dài 5 ở cả hai schema đề thi', () => {
    expect(() => createExamSchema.parse({ name: 'Đề 1', ...paper, grade: 13 })).toThrow();
    expect(() => updateExamSchema.parse({ ...paper, tfScale: [20, 20, 20, 20] })).toThrow();
  });
});

describe('Nhóm cài đặt mã pin bài kiểm tra khi tạo và cập nhật', () => {
  const settings = {
    name: 'Ca thi 1', intro: 'Giới thiệu', timeOpen: '2026-11-14T00:00:00.000Z', timeClose: null,
    timeLimitSeconds: 3600, attemptsAllowed: 1, gradeMethod: 'highest' as const, shuffleAnswers: true,
  };

  it('chấp nhận cùng một khối cài đặt mã pin ở cả hai schema', () => {
    expect(createExamPinSchema.parse({ sectionId: userId, ...settings }).attemptsAllowed).toBe(1);
    expect(updateExamPinSchema.parse(settings).attemptsAllowed).toBe(1);
  });

  it('từ chối variantCount bằng 0 và gradeMethod ngoài tập ở cả hai schema', () => {
    expect(() => createExamPinSchema.parse({ sectionId: userId, ...settings, variantCount: 0 })).toThrow();
    expect(() => updateExamPinSchema.parse({ ...settings, gradeMethod: 'unknown' })).toThrow();
  });
});

describe('Nhóm cài đặt ma trận đề khi tạo và cập nhật', () => {
  const settings = {
    targetFormPercents: { multichoice: 50 }, targetLevelPercents: { biet: 50 },
    levelSet: 'three' as const, scopeNote: 'Ghi chú', scopeNodeIds: [userId],
    totalScore: 10, bankId: null, status: 'draft' as const, isTemplate: false,
  };

  it('chấp nhận cùng một khối cài đặt ma trận ở cả hai schema', () => {
    expect(createExamMatrixSchema.parse({
      name: 'Ma trận 1', subjectId: userId, curriculumId: userId, ...settings,
    }).levelSet).toBe('three');
    expect(updateExamMatrixSchema.parse(settings).levelSet).toBe('three');
  });

  it('từ chối targetFormPercents vượt 100 ở cả hai schema ma trận', () => {
    expect(() => createExamMatrixSchema.parse({
      name: 'Ma trận 1', subjectId: userId, curriculumId: userId,
      ...settings, targetFormPercents: { multichoice: 101 },
    })).toThrow();
    expect(() => updateExamMatrixSchema.parse({ ...settings, targetLevelPercents: { biet: 101 } })).toThrow();
  });
});

describe('Nhóm trường tùy chọn của ô ma trận đề', () => {
  it('chấp nhận minutes tfScale position ở cả hai schema ô ma trận', () => {
    expect(createExamMatrixCellSchema.parse({
      curriculumNodeId: userId, cognitiveLevel: 'biet', qtype: 'essay',
      questionCount: 2, cellScore: 5, minutes: 10, position: 1,
    }).minutes).toBe(10);
    expect(updateExamMatrixCellSchema.parse({ minutes: 10, position: 1 }).minutes).toBe(10);
  });

  it('từ chối minutes bằng 0 và position bằng 0 ở cả hai schema ô ma trận', () => {
    expect(() => createExamMatrixCellSchema.parse({
      curriculumNodeId: userId, cognitiveLevel: 'biet', qtype: 'essay',
      questionCount: 2, cellScore: 5, minutes: 0,
    })).toThrow();
    expect(() => updateExamMatrixCellSchema.parse({ position: 0 })).toThrow();
  });
});

describe('Nhóm đầu trạng thái dataset', () => {
  it('chấp nhận datasetKey subjectName slug ở cả hai schema trạng thái dataset', () => {
    expect(bookDatasetStatusSchema.parse({
      datasetKey: 'toan-10', subjectName: 'Toán 10', slug: 'toan-10',
      bookTitle: 'Toán 10', grade: 10, totalRecords: 5, importedRecords: 5, mappedRecords: 5,
      bookId: userId, subjectId: null, lastImportedAt: null,
    }).slug).toBe('toan-10');
    expect(programDatasetStatusSchema.parse({
      datasetKey: 'toan-10', subjectName: 'Toán 10', slug: 'toan-10',
      grades: [10], totalRecords: 5, importedRecords: 5, subjectId: null, lastImportedAt: null,
    }).slug).toBe('toan-10');
  });

  it('từ chối khi thiếu slug ở cả hai schema trạng thái dataset', () => {
    expect(() => bookDatasetStatusSchema.parse({
      datasetKey: 'toan-10', subjectName: 'Toán 10',
      bookTitle: 'Toán 10', grade: 10, totalRecords: 5, importedRecords: 5, mappedRecords: 5,
      bookId: userId, subjectId: null, lastImportedAt: null,
    })).toThrow();
    expect(() => programDatasetStatusSchema.parse({
      datasetKey: 'toan-10', subjectName: 'Toán 10',
      grades: [10], totalRecords: 5, importedRecords: 5, subjectId: null, lastImportedAt: null,
    })).toThrow();
  });
});

describe('Nhóm schema dùng chung giữ nguyên một object sau khi gom', () => {
  it('bốn schema từ chối trong assessment trỏ cùng một object reason', () => {
    for (const schema of [rejectMatrixContributionSchema, withdrawQuestionSchema, rejectContributionSchema, rejectExamContributionSchema]) {
      expect(schema).toBe(reasonInputSchema);
    }
  });

  it('ba schema lý do đã trim trỏ cùng một object reason', () => {
    for (const schema of [withdrawExamSchema, withdrawExamMatrixSchema, rejectExamDossierSchema]) {
      expect(schema).toBe(trimmedReasonInputSchema);
    }
  });

  it('năm schema lý do giới hạn 500 ký tự trỏ cùng một object reason', () => {
    for (const schema of [hardDeleteMessageSchema, rejectRefundSchema, rejectSystemBankSubmissionSchema, withdrawSystemResourceSchema, rejectSystemExamSchema]) {
      expect(schema).toBe(limitedReasonInputSchema);
    }
  });

  it('ba schema phê duyệt trỏ cùng một object body rỗng', () => {
    expect(approveExamContributionSchema).toBe(approveMatrixContributionSchema);
    expect(approveExamDossierSchema).toBe(approveMatrixContributionSchema);
  });

  it('hai schema đánh dấu hoàn thành trỏ cùng một object', () => {
    expect(markCourseCriteriaCompletionSchema).toBe(markUserCompletionSchema);
    expect(markManualCompletionSchema).toBe(markUserCompletionSchema);
  });

  it('hai schema nhập dataset trỏ cùng một object', () => {
    expect(importBookDatasetSchema).toBe(datasetImportSchema);
    expect(importProgramDatasetSchema).toBe(datasetImportSchema);
  });

  it('hai schema kết quả đầu ra của mục trỏ cùng một object', () => {
    expect(courseSectionBookItemOutcomeSchema).toBe(courseSectionItemOutcomeSchema);
    expect(courseSectionFrameOutcomeSchema).toBe(courseSectionItemOutcomeSchema);
  });

  it('hai schema đáp án mệnh đề dùng chung một phần tử statement', () => {
    expect(questionSolutionSchema.parse({ statements: [{ statementId: 's1', value: true }] })).toEqual({
      statements: [{ statementId: 's1', value: true }],
    });
    expect(statementValueSchema.parse({ statementId: 's1', value: true })).toEqual({ statementId: 's1', value: true });
  });

  it('điểm chú thích và điểm hàng giấy dùng chung hai schema điểm phân biệt giới hạn', () => {
    expect(pointSchema.parse({ x: 1234, y: -5 })).toEqual({ x: 1234, y: -5 });
    expect(normalizedPointSchema.parse({ x: 100, y: 0 })).toEqual({ x: 100, y: 0 });
    expect(() => normalizedPointSchema.parse({ x: 101, y: 0 })).toThrow();
  });

  it('khối user đăng nhập và khối ghi đè quyền dùng chung schema con', () => {
    expect(loginUserSchema.parse({ id: userId, username: 'teacher1', forcePasswordChange: true }).username).toBe('teacher1');
    expect(capabilityOverrideSchema.parse({ capability: 'mod/assign:grade', permission: 1 }).permission).toBe(1);
  });
});

describe('Nhóm thứ tự khóa sau khi gom giữ nguyên thứ tự khai báo cũ', () => {
  it('giữ nguyên thứ tự khóa của ma trận đề khi tạo', () => {
    const parsed = createExamMatrixSchema.parse({
      name: 'Ma trận 1', subjectId: userId, curriculumId: userId,
      targetFormPercents: null, targetLevelPercents: null, levelSet: 'three',
      scopeNote: null, scopeNodeIds: null, totalScore: 10, bankId: null,
      status: 'draft', isTemplate: false, derivedFromMatrixId: null,
    });
    expect(Object.keys(parsed)).toEqual([
      'name', 'subjectId', 'curriculumId', 'targetFormPercents', 'targetLevelPercents',
      'levelSet', 'scopeNote', 'scopeNodeIds', 'totalScore', 'bankId', 'status',
      'isTemplate', 'derivedFromMatrixId',
    ]);
  });

  it('giữ nguyên thứ tự khóa của view bài nộp của chính người học', () => {
    const parsed = assignOwnSubmissionViewSchema.parse({
      submissionId: userId, status: 'submitted', attemptNumber: 1,
      submittedAt: null, late: false, files: [], grade: null, annotations: [],
      rubricEvaluations: [], feedbackMessages: [],
    });
    expect(Object.keys(parsed)).toEqual([
      'submissionId', 'status', 'attemptNumber', 'submittedAt', 'late', 'files',
      'grade', 'annotations', 'rubricEvaluations', 'feedbackMessages',
    ]);
  });
});

describe('Nhóm cài đặt học phần khi tạo và cập nhật', () => {
  it('chấp nhận cùng một khối cài đặt ở cả hai schema học phần', () => {
    expect(createCourseModuleSchema.parse({
      sectionId: userId, component: 'mod_quiz', name: 'Bài kiểm tra', visible: true,
      groupMode: 1, completion: 2, completionView: true, completionUseGrade: false,
      completionManual: false, completionExpected: '2026-12-01', openAt: null,
    }).groupMode).toBe(1);
    expect(updateCourseModuleSchema.parse({
      name: 'Bài mới', completionExpected: null, sectionId: userId,
    }).completionExpected).toBeNull();
  });

  it('từ chối completionExpected null khi tạo nhưng chấp nhận khi cập nhật', () => {
    expect(() => createCourseModuleSchema.parse({
      sectionId: userId, component: 'mod_quiz', completionExpected: null,
    })).toThrow();
    expect(updateCourseModuleSchema.parse({ completionExpected: null }).completionExpected).toBeNull();
  });

  it('giữ nguyên thứ tự khóa của học phần khi tạo và khi cập nhật', () => {
    const created = createCourseModuleSchema.parse({
      sectionId: userId, component: 'mod_quiz', instanceId: userId, name: 'Bài 1',
      visible: true, groupMode: 0, availability: null, completion: 1, completionView: false,
      completionUseGrade: false, completionManual: false, completionExpected: '2026-12-01',
      openAt: null,
    });
    expect(Object.keys(created)).toEqual([
      'sectionId', 'component', 'instanceId', 'name', 'visible', 'groupMode',
      'availability', 'completion', 'completionView', 'completionUseGrade',
      'completionManual', 'completionExpected', 'openAt',
    ]);
    const updated = updateCourseModuleSchema.parse({
      name: 'Bài 1', visible: true, groupMode: 0, availability: null, completion: 1,
      completionView: false, completionUseGrade: false, completionManual: false,
      completionExpected: null, openAt: null, sectionId: userId,
    });
    expect(Object.keys(updated)).toEqual([
      'name', 'visible', 'groupMode', 'availability', 'completion', 'completionView',
      'completionUseGrade', 'completionManual', 'completionExpected', 'openAt', 'sectionId',
    ]);
  });
});

describe('Nhóm phân nhóm và phân loại khóa học khi tạo và cập nhật', () => {
  it('chấp nhận groupMode và grade ở cả hai schema khóa học', () => {
    expect(createCourseSchema.parse({
      fullName: 'Toán 10', shortName: 'T10', category: userId, groupMode: 1,
      groupModeForce: true, subjectId: userId, grade: 10,
    }).grade).toBe(10);
    expect(updateCourseSchema.parse({ groupMode: 0, grade: 11 }).grade).toBe(11);
  });

  it('từ chối grade vượt 12 và groupMode không nguyên ở cả hai schema khóa học', () => {
    expect(() => createCourseSchema.parse({
      fullName: 'Toán 10', shortName: 'T10', category: userId, grade: 13,
    })).toThrow();
    expect(() => updateCourseSchema.parse({ groupMode: 1.5 })).toThrow();
  });
});

describe('Nhóm chi tiết nút chương trình khi tạo và cập nhật', () => {
  it('chấp nhận kind position durationPeriods durationPercent ở cả hai schema nút', () => {
    expect(createCurriculumNodeSchema.parse({
      curriculumId: userId, title: 'Chương 1', kind: 'topic', position: 2,
      durationPeriods: 4, durationPercent: 25,
    }).durationPercent).toBe(25);
    expect(updateCurriculumNodeSchema.parse({
      kind: 'lesson', position: 1, durationPeriods: null, durationPercent: null,
    }).kind).toBe('lesson');
  });

  it('từ chối durationPercent vượt 100 và position bằng 0 ở cả hai schema nút', () => {
    expect(() => createCurriculumNodeSchema.parse({
      curriculumId: userId, title: 'Chương 1', durationPercent: 101,
    })).toThrow();
    expect(() => updateCurriculumNodeSchema.parse({ position: 0 })).toThrow();
  });
});

describe('Nhóm nguồn gốc chuẩn đầu ra khi tạo và cập nhật', () => {
  it('chấp nhận position sourceKind sourceRef derivedFromId ở cả hai schema chuẩn đầu ra', () => {
    expect(createLearningOutcomeSchema.parse({
      nodeId: userId, content: 'Hiểu khái niệm', position: 1, sourceKind: 'program',
      sourceRef: 'REF-1', derivedFromId: null,
    }).sourceRef).toBe('REF-1');
    expect(updateLearningOutcomeSchema.parse({
      content: 'Hiểu sâu', sourceKind: 'derived', derivedFromId: userId,
    }).sourceKind).toBe('derived');
  });

  it('từ chối sourceRef rỗng ở cả hai schema chuẩn đầu ra', () => {
    expect(() => createLearningOutcomeSchema.parse({
      nodeId: userId, content: 'Hiểu khái niệm', sourceRef: '',
    })).toThrow();
    expect(() => updateLearningOutcomeSchema.parse({ sourceRef: '' })).toThrow();
  });
});

describe('Nhóm số lượng bản ghi khi nhập dataset sách và chương trình', () => {
  const counts = { subjectId: userId, totalRecords: 5, created: 3, updated: 1, skipped: 1 };

  it('chấp nhận cùng một khối số lượng ở cả hai schema kết quả nhập', () => {
    expect(bookImportResultSchema.parse({
      datasetKey: 'toan-10', bookId: userId, ...counts, mappingsWritten: 2,
    }).created).toBe(3);
    expect(programImportResultSchema.parse({
      datasetKey: 'toan-10', ...counts, outcomesWritten: 2, orphanedNodes: 0,
      retiredOutcomes: 0,
      changeCounts: { textChanged: 0, added: 0, removed: 0, moved: 0, revived: 0, shiftSuspected: 0 },
      changes: [], changesOmitted: 0,
    }).skipped).toBe(1);
  });

  it('từ chối số lượng bản ghi không nguyên ở cả hai schema kết quả nhập', () => {
    expect(() => bookImportResultSchema.parse({
      datasetKey: 'toan-10', bookId: userId, ...counts, created: 1.5, mappingsWritten: 2,
    })).toThrow();
    expect(() => programImportResultSchema.parse({
      datasetKey: 'toan-10', ...counts, totalRecords: 2.5, outcomesWritten: 2,
      orphanedNodes: 0, retiredOutcomes: 0,
      changeCounts: { textChanged: 0, added: 0, removed: 0, moved: 0, revived: 0, shiftSuspected: 0 },
      changes: [], changesOmitted: 0,
    })).toThrow();
  });
});

describe('Nhóm kết quả tạo câu hỏi MCP cho một câu và cho từng mục lô', () => {
  const outcome = {
    questionId: userId, existingQuestionId: null, entryId: null, version: 1,
    questionStatus: 'ready', duplicate: 'none' as const, nearDuplicateOf: null,
    reviewUrl: null,
  };

  it('chấp nhận cùng một khối kết quả ở cả hai schema kết quả MCP', () => {
    expect(mcpCreateQuestionOutputSchema.parse({ status: 'created', ...outcome }).questionId).toBe(userId);
    expect(mcpBatchItemResultSchema.parse({
      clientItemId: 'c1', status: 'created', ...outcome, code: null, message: null,
      fieldPath: null,
    }).version).toBe(1);
  });

  it('từ chối status failed ở kết quả tạo một câu nhưng chấp nhận ở kết quả từng mục lô', () => {
    expect(() => mcpCreateQuestionOutputSchema.parse({ status: 'failed', ...outcome })).toThrow();
    expect(mcpBatchItemResultSchema.parse({
      clientItemId: 'c1', status: 'failed', ...outcome, code: 'ERR', message: 'Lỗi',
      fieldPath: 'questionText',
    }).status).toBe('failed');
  });

  it('giữ nguyên thứ tự khóa của kết quả tạo câu hỏi MCP cho một câu', () => {
    const parsed = mcpCreateQuestionOutputSchema.parse({ status: 'created', ...outcome });
    expect(Object.keys(parsed)).toEqual([
      'status', 'questionId', 'existingQuestionId', 'entryId', 'version',
      'questionStatus', 'duplicate', 'nearDuplicateOf', 'reviewUrl',
    ]);
  });

  it('giữ nguyên thứ tự khóa của kết quả từng mục lô', () => {
    const parsed = mcpBatchItemResultSchema.parse({
      clientItemId: 'c1', status: 'created', ...outcome, code: null, message: null,
      fieldPath: null,
    });
    expect(Object.keys(parsed)).toEqual([
      'clientItemId', 'status', 'questionId', 'existingQuestionId', 'entryId',
      'version', 'questionStatus', 'duplicate', 'nearDuplicateOf', 'reviewUrl',
      'code', 'message', 'fieldPath',
    ]);
  });
});

describe('Nhóm điểm chấm lại của bài kiểm tra', () => {
  it('chấp nhận phân số cũ mới ở cả hai schema chấm lại', () => {
    expect(pinRegradeChangeSchema.parse({
      examAttemptId: userId, userId, attemptNumber: 1, questionAttemptId: userId,
      oldFraction: 0.5, newFraction: 1, oldSumGrades: 5, newSumGrades: 10, changed: true,
    }).newFraction).toBe(1);
    expect(pinRegradeLogItemSchema.parse({
      examAttemptId: userId, userId, attemptNumber: 1,
      oldFraction: null, newFraction: 0, oldSumGrades: null, newSumGrades: 0,
    }).oldFraction).toBeNull();
  });

  it('từ chối phân số không phải số ở cả hai schema chấm lại', () => {
    expect(() => pinRegradeChangeSchema.parse({
      examAttemptId: userId, userId, attemptNumber: 1, questionAttemptId: userId,
      oldFraction: 'x', newFraction: 1, oldSumGrades: 5, newSumGrades: 10, changed: true,
    })).toThrow();
    expect(() => pinRegradeLogItemSchema.parse({
      examAttemptId: userId, userId, attemptNumber: 1,
      oldFraction: null, newFraction: 'x', oldSumGrades: null, newSumGrades: 0,
    })).toThrow();
  });
});

describe('Nhóm định danh người dùng trong hồ sơ và trong mục danh sách', () => {
  it('chấp nhận id username firstName lastName ở cả hai schema người dùng', () => {
    expect(userProfileSchema.parse({
      id: userId, username: 'lan', firstName: 'Lan', lastName: 'Nguyễn',
      suspended: false, deleted: false, isGuest: false, forcePasswordChange: false,
      lastLogin: null, createdAt: '2026-11-14T00:00:00.000Z', customFields: [],
    }).username).toBe('lan');
    expect(userWithAssignmentsListItemSchema.parse({
      id: userId, username: 'lan', firstName: 'Lan', lastName: 'Nguyễn',
      email: 'lan@example.com', suspended: false, deleted: false,
      createdAt: '2026-11-14T00:00:00.000Z', assignments: [],
    }).firstName).toBe('Lan');
  });

  it('từ chối khi thiếu email ở mục danh sách nhưng chấp nhận ở hồ sơ vì email tùy chọn', () => {
    expect(userProfileSchema.parse({
      id: userId, username: 'lan', firstName: 'Lan', lastName: 'Nguyễn',
      suspended: false, deleted: false, isGuest: false, forcePasswordChange: false,
      lastLogin: null, createdAt: '2026-11-14T00:00:00.000Z', customFields: [],
    }).email).toBeUndefined();
    expect(() => userWithAssignmentsListItemSchema.parse({
      id: userId, username: 'lan', firstName: 'Lan', lastName: 'Nguyễn',
      suspended: false, deleted: false,
      createdAt: '2026-11-14T00:00:00.000Z', assignments: [],
    })).toThrow();
  });
});

describe('Nhóm định danh tenant trong khung nhìn đầy đủ và khung nhìn của chính mình', () => {
  it('chấp nhận id slug name kind ở cả hai schema tenant', () => {
    expect(tenantSchema.parse({
      id: userId, slug: 'truong-a', name: 'Trường A', kind: 'school',
      status: 'active', plan: null, createdAt: '2026-11-14T00:00:00.000Z',
      updatedAt: '2026-11-14T00:00:00.000Z',
    }).slug).toBe('truong-a');
    expect(myTenantSchema.parse({
      id: userId, slug: 'trung-tam-b', name: 'Trung tâm B', kind: 'center', active: true,
    }).kind).toBe('center');
  });

  it('từ chối kind ngoài tập school center platform ở cả hai schema tenant', () => {
    expect(() => tenantSchema.parse({
      id: userId, slug: 'x', name: 'X', kind: 'unknown', status: 'active', plan: null,
      createdAt: '2026-11-14T00:00:00.000Z', updatedAt: '2026-11-14T00:00:00.000Z',
    })).toThrow();
    expect(() => myTenantSchema.parse({
      id: userId, slug: 'x', name: 'X', kind: 'unknown', active: true,
    })).toThrow();
  });
});

describe('Nhóm đích năng lực khi thêm minh chứng và khi chấm năng lực', () => {
  it('chấp nhận userId competencyId planId courseId ở cả hai schema năng lực', () => {
    expect(addCompetencyEvidenceSchema.parse({
      userId, competencyId: userId, planId: userId, description: 'Bằng chứng', grade: 3,
    }).description).toBe('Bằng chứng');
    expect(gradeUserCompetencySchema.parse({
      userId, competencyId: userId, courseId: userId, grade: 5, note: 'Tốt',
    }).grade).toBe(5);
  });

  it('từ chối khi thiếu grade ở schema chấm và thiếu description ở schema minh chứng', () => {
    expect(() => gradeUserCompetencySchema.parse({ userId, competencyId: userId })).toThrow();
    expect(() => addCompetencyEvidenceSchema.parse({ userId, competencyId: userId })).toThrow();
  });
});

describe('Nhóm định vị mục được gắn thẻ', () => {
  const item = { component: 'mod_quiz', itemType: 'question', itemId: userId, contextId: userId };

  it('chấp nhận component itemType itemId contextId ở cả hai schema gắn thẻ', () => {
    expect(setItemTagsSchema.parse({ ...item, tags: ['a', 'b'] }).tags).toEqual(['a', 'b']);
    expect(addItemTagSchema.parse({ ...item, tag: 'on-tap' }).tag).toBe('on-tap');
  });

  it('từ chối tag rỗng khi thêm một thẻ và tags không phải mảng khi đặt nhiều thẻ', () => {
    expect(() => addItemTagSchema.parse({ ...item, tag: '' })).toThrow();
    expect(() => setItemTagsSchema.parse({ ...item, tags: 'a' })).toThrow();
  });
});

describe('Nhóm định danh người trong tóm tắt và hồ sơ liên hệ', () => {
  it('chấp nhận userId displayName username ở cả hai schema người liên hệ', () => {
    expect(personSummarySchema.parse({
      userId, displayName: 'Lan', username: 'lan',
    })).toEqual({ userId, displayName: 'Lan', username: 'lan' });
    expect(personProfileSchema.parse({
      userId, displayName: 'Lan', username: 'lan', email: 'lan@example.com',
    }).email).toBe('lan@example.com');
  });

  it('từ chối khi thiếu email ở hồ sơ và khi thừa email ở tóm tắt vì tóm tắt không có email', () => {
    expect(() => personProfileSchema.parse({
      userId, displayName: 'Lan', username: 'lan',
    })).toThrow();
    expect(() => personSummarySchema.parse({
      userId, displayName: 'Lan', username: 'lan', email: 'lan@example.com',
    })).toThrow();
  });
});

describe('Nhóm truy vấn danh sách thông báo theo nhóm và theo mục', () => {
  it('chấp nhận group unreadOnly cursor ở cả hai schema truy vấn thông báo', () => {
    expect(listNotificationGroupsQuerySchema.parse({
      group: 'learning', unreadOnly: true, cursor: 'abc', limit: 50,
    }).limit).toBe(50);
    expect(listNotificationItemsQuerySchema.parse({
      group: 'learning', unreadOnly: true, cursor: 'abc', limit: 100,
    }).limit).toBe(100);
  });

  it('từ chối limit 51 ở truy vấn theo nhóm nhưng chấp nhận ở truy vấn theo mục vì trần là 100', () => {
    expect(() => listNotificationGroupsQuerySchema.parse({ limit: 51 })).toThrow();
    expect(listNotificationItemsQuerySchema.parse({ limit: 51 }).limit).toBe(51);
    expect(() => listNotificationItemsQuerySchema.parse({ limit: 101 })).toThrow();
  });
});

describe('Nhóm định danh tin nhắn trong khung nhìn đầy đủ và trong kết quả tìm kiếm', () => {
  const identity = { id: userId, conversationId: userId, userIdFrom: userId };

  it('chấp nhận id conversationId userIdFrom ở cả hai schema tin nhắn', () => {
    expect(messageSchema.parse({
      ...identity, subject: 'Chào', fullMessage: 'Xin chào', createdAt: '2026-11-14T00:00:00.000Z',
      seq: 1, clientMessageId: null, deletedAt: null, deletedBy: null, recalledAt: null,
      recalledBy: null, replyToMessageId: null, replyTo: null,
    }).seq).toBe(1);
    expect(messageSearchResultSchema.parse({
      ...identity, seq: 2, excerpt: 'Xin chào', createdAt: '2026-11-14T00:00:00.000Z',
    }).excerpt).toBe('Xin chào');
  });

  it('từ chối khi thiếu excerpt ở kết quả tìm kiếm tin nhắn', () => {
    expect(() => messageSearchResultSchema.parse({
      ...identity, seq: 2, createdAt: '2026-11-14T00:00:00.000Z',
    })).toThrow();
  });

  it('từ chối khi thiếu subject ở khung nhìn đầy đủ của tin nhắn', () => {
    expect(() => messageSchema.parse({
      ...identity, fullMessage: 'Xin chào', createdAt: '2026-11-14T00:00:00.000Z',
      seq: 1, clientMessageId: null, deletedAt: null, deletedBy: null, recalledAt: null,
      recalledBy: null, replyToMessageId: null, replyTo: null,
    })).toThrow();
  });
});

describe('Nhóm thực thể có shortName trong xuất khung năng lực', () => {
  it('chấp nhận shortName idNumber description ở cả năng lực xuất và khung xuất', () => {
    expect(frameworkExportCompetencySchema.parse({
      key: 'NL1', shortName: 'NL1', idNumber: 'NL-1', description: 'Năng lực',
      parentKey: null, sortOrder: 1, rule: null,
    }).shortName).toBe('NL1');
    expect(frameworkExportSchema.parse({
      format: 'giaokhoa-competency-framework', version: 1,
      framework: {
        shortName: 'NL', idNumber: 'NL', description: 'Khung', visible: true,
        taxonomies: 'x', scale: { values: ['a'], proficient: [1] },
      },
      competencies: [],
    }).framework.shortName).toBe('NL');
  });

  it('từ chối shortName rỗng ở cả năng lực xuất và khung xuất', () => {
    expect(() => frameworkExportCompetencySchema.parse({
      key: 'NL1', shortName: '', idNumber: 'NL-1', description: 'Năng lực',
      parentKey: null, sortOrder: 1, rule: null,
    })).toThrow();
    expect(() => frameworkExportSchema.parse({
      format: 'giaokhoa-competency-framework', version: 1,
      framework: {
        shortName: '', idNumber: 'NL', description: 'Khung', visible: true,
        taxonomies: 'x', scale: { values: ['a'], proficient: [1] },
      },
      competencies: [],
    })).toThrow();
  });
});

describe('Nhóm giới hạn và hệ số điểm khi tạo và cập nhật hạng mục điểm', () => {
  it('chấp nhận gradeMax gradeMin gradePass và multiplicator plusFactor hidden ở cả hai schema hạng mục điểm', () => {
    expect(createGradeItemSchema.parse({
      itemName: 'Điểm', gradeMax: 10, gradeMin: 0, gradePass: 5,
      multiplicator: 1, plusFactor: 0, hidden: false,
    }).gradeMax).toBe(10);
    expect(updateGradeItemSchema.parse({
      gradeMax: 10, multiplicator: 2, locked: true,
    }).multiplicator).toBe(2);
  });

  it('từ chối gradeMax không phải số và hidden không phải boolean ở cả hai schema hạng mục điểm', () => {
    expect(() => createGradeItemSchema.parse({ itemName: 'Điểm', gradeMax: 'x' })).toThrow();
    expect(() => updateGradeItemSchema.parse({ hidden: 'yes' })).toThrow();
  });

  it('giữ nguyên thứ tự khóa của hạng mục điểm khi tạo và khi cập nhật', () => {
    const created = createGradeItemSchema.parse({
      itemName: 'Điểm', itemType: 'manual', cmId: userId, gradeMax: 10, gradeMin: 0,
      gradePass: 5, idNumber: 'D1', multiplicator: 1, plusFactor: 0, hidden: false,
    });
    expect(Object.keys(created)).toEqual([
      'itemName', 'itemType', 'cmId', 'gradeMax', 'gradeMin', 'gradePass',
      'idNumber', 'multiplicator', 'plusFactor', 'hidden',
    ]);
    const updated = updateGradeItemSchema.parse({
      itemName: 'Điểm', gradeMax: 10, gradeMin: 0, gradePass: 5, idNumber: 'D1',
      multiplicator: 1, plusFactor: 0, hidden: false, locked: true,
    });
    expect(Object.keys(updated)).toEqual([
      'itemName', 'gradeMax', 'gradeMin', 'gradePass', 'idNumber',
      'multiplicator', 'plusFactor', 'hidden', 'locked',
    ]);
  });
});

describe('Nhóm nội dung chú thích khi tạo và cập nhật', () => {
  it('chấp nhận color text points ở cả hai schema chú thích', () => {
    expect(createAssignAnnotationSchema.parse({
      fileId: userId, x: 10, y: 20, kind: 'note', color: 'red', text: 'Ghi chú',
      points: [{ x: 1, y: 2 }],
    }).color).toBe('red');
    expect(updateAssignAnnotationSchema.parse({
      color: null, text: null, points: [],
    }).points).toEqual([]);
  });
});

describe('Nhóm hiệu lực mã giảm giá khi tạo và cập nhật', () => {
  it('chấp nhận startsAt endsAt maxRedemptions ở cả hai schema mã giảm giá', () => {
    expect(createCouponSchema.parse({
      code: 'GIAM10', discountType: 'fixed', discountValue: 5000,
      startsAt: '2026-11-14T00:00:00.000Z', endsAt: null, maxRedemptions: 5,
    }).maxRedemptions).toBe(5);
    expect(updateCouponSchema.parse({
      startsAt: '2026-11-14T00:00:00.000Z', endsAt: '2026-12-14T00:00:00.000Z',
      maxRedemptions: null,
    }).endsAt).toBe('2026-12-14T00:00:00.000Z');
  });

  it('từ chối maxRedemptions bằng 0 ở cả hai schema mã giảm giá', () => {
    expect(() => createCouponSchema.parse({
      code: 'GIAM10', discountType: 'fixed', discountValue: 5000, maxRedemptions: 0,
    })).toThrow();
    expect(() => updateCouponSchema.parse({ maxRedemptions: 0 })).toThrow();
  });

  it('giữ nguyên thứ tự khóa của mã giảm giá khi tạo', () => {
    const parsed = createCouponSchema.parse({
      code: 'GIAM10', discountType: 'fixed', discountValue: 5000, appliesTo: 'all',
      startsAt: null, endsAt: null, maxRedemptions: null, isActive: true,
    });
    expect(Object.keys(parsed)).toEqual([
      'code', 'discountType', 'discountValue', 'appliesTo', 'startsAt', 'endsAt',
      'maxRedemptions', 'isActive',
    ]);
  });

  it('giữ nguyên thứ tự khóa của mã giảm giá khi cập nhật', () => {
    const parsed = updateCouponSchema.parse({
      discountType: 'fixed', discountValue: 5000, appliesTo: 'all',
      startsAt: null, endsAt: null, maxRedemptions: null, isActive: true,
    });
    expect(Object.keys(parsed)).toEqual([
      'discountType', 'discountValue', 'appliesTo', 'startsAt', 'endsAt',
      'maxRedemptions', 'isActive',
    ]);
  });
});

describe('Nhóm khóa ô ma trận và số lượng khả dụng của ô', () => {
  it('chấp nhận curriculumNodeId cognitiveLevel qtype ở cả hai schema ô ma trận nhập', () => {
    expect(matrixImportPreviewCellSchema.parse({
      curriculumNodeId: userId, cognitiveLevel: 'biet', qtype: 'multichoice',
      questionCount: 2, cellScore: 5,
    }).qtype).toBe('multichoice');
    expect(matrixImportCellAvailabilitySchema.parse({
      curriculumNodeId: userId, cognitiveLevel: 'hieu', qtype: 'essay',
      required: 3, available: 2, deficit: 1,
    }).cognitiveLevel).toBe('hieu');
  });

  it('chấp nhận required available deficit ở cả hai schema khả dụng của ô', () => {
    expect(matrixCellAvailabilitySchema.parse({
      cellId: userId, required: 3, available: 3, deficit: 0,
    }).deficit).toBe(0);
    expect(matrixImportCellAvailabilitySchema.parse({
      curriculumNodeId: userId, cognitiveLevel: 'biet', qtype: 'essay',
      required: 3, available: 2, deficit: 1,
    }).required).toBe(3);
  });

  it('từ chối cognitiveLevel ngoài tập và required không nguyên ở các schema ô ma trận', () => {
    expect(() => matrixImportPreviewCellSchema.parse({
      curriculumNodeId: userId, cognitiveLevel: 'unknown', qtype: 'essay',
      questionCount: 2, cellScore: 5,
    })).toThrow();
    expect(() => matrixImportCellAvailabilitySchema.parse({
      curriculumNodeId: userId, cognitiveLevel: 'biet', qtype: 'essay',
      required: 1.5, available: 2, deficit: 1,
    })).toThrow();
  });

  it('từ chối required không nguyên ở schema khả dụng của ô', () => {
    expect(() => matrixCellAvailabilitySchema.parse({
      cellId: userId, required: 1.5, available: 2, deficit: 1,
    })).toThrow();
    expect(() => matrixCellAvailabilitySchema.parse({
      cellId: userId, required: 3, available: 1.5, deficit: 1,
    })).toThrow();
    expect(() => matrixCellAvailabilitySchema.parse({
      cellId: userId, required: 3, available: 2, deficit: 1.5,
    })).toThrow();
  });
});

describe('Nhóm cửa sổ thời gian làm bài trong khung nhìn quiz và khung nhìn ghi đè mã pin', () => {
  const window = {
    timeOpen: '2026-11-14T00:00:00.000Z', timeClose: '2026-11-14T02:00:00.000Z',
    timeLimitSeconds: 3600,
  };

  it('chấp nhận timeOpen timeClose timeLimitSeconds ở cả hai khung nhìn', () => {
    expect(quizViewSchema.parse({
      id: userId, courseId: userId, cmId: null, targetGroupId: null, name: 'Quiz 1',
      intro: 'Giới thiệu', ...window, attemptsAllowed: 1, gradeMethod: 'highest' as const,
      grade: 10, shuffleAnswers: true, hasPassword: false, subnet: null,
      reviewAttempt: 0, reviewCorrectness: 0, reviewMarks: 0, reviewSpecificFeedback: 0,
      reviewGeneralFeedback: 0, reviewRightAnswer: 0, reviewOverallFeedback: 0,
      matrixId: null, examId: userId, examVersionId: userId, examVersionNumber: 1,
      latestExamVersionNumber: 1, hasNewerExamVersion: false, versionMode: 'pinned' as const,
      tfScale: null, preset: 'regular' as const, lateEntryMinutes: null,
      monitorEvents: false, slots: [], sumGrades: 10, variants: [],
    }).timeLimitSeconds).toBe(3600);
    expect(examPinOverrideViewSchema.parse({
      id: userId, pinId: userId, groupId: null, groupName: null, userId: null,
      userName: null, ...window, attempts: 2, hasPassword: false, reason: null,
    }).attempts).toBe(2);
  });

  it('từ chối timeLimitSeconds không phải số nguyên ở cả hai khung nhìn', () => {
    expect(() => quizViewSchema.parse({
      id: userId, courseId: userId, cmId: null, targetGroupId: null, name: 'Quiz 1',
      intro: 'Giới thiệu', timeOpen: '2026-11-14T00:00:00.000Z', timeClose: '2026-11-14T02:00:00.000Z',
      timeLimitSeconds: 1.5, attemptsAllowed: 1, gradeMethod: 'highest' as const,
      grade: 10, shuffleAnswers: true, hasPassword: false, subnet: null,
      reviewAttempt: 0, reviewCorrectness: 0, reviewMarks: 0, reviewSpecificFeedback: 0,
      reviewGeneralFeedback: 0, reviewRightAnswer: 0, reviewOverallFeedback: 0,
      matrixId: null, examId: userId, examVersionId: userId, examVersionNumber: 1,
      latestExamVersionNumber: 1, hasNewerExamVersion: false, versionMode: 'pinned' as const,
      tfScale: null, preset: 'regular' as const, lateEntryMinutes: null,
      monitorEvents: false, slots: [], sumGrades: 10, variants: [],
    })).toThrow();
    expect(() => examPinOverrideViewSchema.parse({
      id: userId, pinId: userId, groupId: null, groupName: null, userId: null,
      userName: null, timeOpen: null, timeClose: null, timeLimitSeconds: 1.5,
      attempts: 2, hasPassword: false, reason: null,
    })).toThrow();
  });
});

describe('Nhóm kết quả chấm trong khung nhìn điểm và trong tóm tắt bài nộp', () => {
  it('chấp nhận grade level feedback ở cả hai schema kết quả chấm', () => {
    expect(assignGradeViewSchema.parse({
      grade: 8.5, level: 'dat', feedback: 'Tốt', feedbackProgress: null,
      feedbackStrengths: null, feedbackWeaknesses: null, graderId: userId,
      gradedAt: '2026-11-14T00:00:00.000Z', attemptNumber: 1, status: 'released',
      releasedAt: null,
    }).level).toBe('dat');
    expect(assignSubmissionSummarySchema.parse({
      userId, displayName: 'Lan', status: 'submitted', attemptNumber: 1,
      submittedAt: '2026-11-14T00:00:00.000Z', late: false, fileCount: 0,
      grade: 8.5, level: 'dat', feedback: 'Tốt', gradeStatus: 'released',
    }).grade).toBe(8.5);
  });

  it('từ chối level ngoài tập dat chua_dat ở cả hai schema kết quả chấm', () => {
    expect(() => assignGradeViewSchema.parse({
      grade: 8.5, level: 'gioi', feedback: null, feedbackProgress: null,
      feedbackStrengths: null, feedbackWeaknesses: null, graderId: userId,
      gradedAt: '2026-11-14T00:00:00.000Z', attemptNumber: 1, status: 'released',
      releasedAt: null,
    })).toThrow();
    expect(() => assignSubmissionSummarySchema.parse({
      userId, displayName: 'Lan', status: 'submitted', attemptNumber: 1,
      submittedAt: '2026-11-14T00:00:00.000Z', late: false, fileCount: 0,
      grade: 8.5, level: 'gioi', feedback: null, gradeStatus: 'released',
    })).toThrow();
  });
});

describe('Nhóm tham chiếu ngữ cảnh trong phân công vai trò và trong quyền theo ngữ cảnh', () => {
  it('chấp nhận contextId contextLevel contextPath ở cả hai schema quyền theo ngữ cảnh', () => {
    expect(myRoleAssignmentSchema.parse({
      id: userId, roleId: userId, roleShortname: 'teacher', roleName: 'Teacher',
      contextId: userId, contextLevel: 50, contextPath: '/1/2', instanceId: null,
    }).contextPath).toBe('/1/2');
    expect(myContextCapabilitiesSchema.parse({
      contextId: userId, contextLevel: 50, contextPath: '/1/2',
      capabilities: ['mod/assign:grade'],
    }).capabilities).toEqual(['mod/assign:grade']);
  });

  it('từ chối contextLevel không nguyên ở cả hai schema quyền theo ngữ cảnh', () => {
    expect(() => myRoleAssignmentSchema.parse({
      id: userId, roleId: userId, roleShortname: 'teacher', roleName: 'Teacher',
      contextId: userId, contextLevel: 1.5, contextPath: '/1/2', instanceId: null,
    })).toThrow();
    expect(() => myContextCapabilitiesSchema.parse({
      contextId: userId, contextLevel: 1.5, contextPath: '/1/2', capabilities: [],
    })).toThrow();
  });
});
