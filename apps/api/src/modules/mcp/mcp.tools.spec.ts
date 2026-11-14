import type { McpServer } from '@modelcontextprotocol/server';
import {
  mcpCheckDuplicatesInputSchema,
  mcpCheckDuplicatesOutputSchema,
  mcpCreateQuestionInputSchema,
  mcpCreateQuestionOutputSchema,
  mcpCreateQuestionsBatchInputSchema,
  mcpCreateQuestionsBatchOutputSchema,
  mcpCreateStimulusWithQuestionsInputSchema,
  mcpCreateStimulusWithQuestionsOutputSchema,
  mcpGetQuestionInputSchema,
  mcpGetQuestionOutputSchema,
  mcpListCategoriesInputSchema,
  mcpListCategoriesOutputSchema,
  mcpListMyBanksOutputSchema,
  mcpPublishQuestionsInputSchema,
  mcpPublishQuestionsOutputSchema,
  mcpSearchCurriculumOutcomesInputSchema,
  mcpSearchCurriculumOutcomesOutputSchema,
  mcpSearchQuestionsInputSchema,
  mcpSearchQuestionsOutputSchema,
  mcpSubmitContributionInputSchema,
  mcpSubmitContributionOutputSchema,
} from '@giaokhoa/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { McpActor } from './mcp.context';
import { registerMcpTools, type McpToolDeps } from './mcp.tools';

interface Registration {
  name: string;
  config: {
    title?: unknown;
    description?: unknown;
    inputSchema?: unknown;
    outputSchema?: unknown;
    annotations?: { readOnlyHint?: boolean };
  };
  handler: (args?: unknown) => Promise<{
    content: { type: string; text: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  }>;
}

const EXPECTED: { name: string; title: string; description: string }[] = [
  {
    name: 'list_my_banks',
    title: 'List my question banks',
    description:
      'List the question banks this teacher can use (personal, team, school), with per-bank capabilities and the default category id of each bank. Call this first to discover bankId/categoryId before creating questions.',
  },
  {
    name: 'list_categories',
    title: 'List categories of a bank',
    description:
      'List the categories (with question counts) that belong to one question bank. create_question needs a categoryId from this list — the category must belong to the same bank you write to.',
  },
  {
    name: 'create_question',
    title: 'Create a draft question in my personal bank',
    description:
      "Create ONE question (multichoice, truefalse, shortanswer or essay) in the teacher's OWN personal question bank. Content is plain text only — no HTML. Answers: multichoice needs exactly 4 choices with exactly one marked correct; truefalse takes a stem plus exactly 4 statements, each with a true/false value (the question is a 4-statement true/false cluster); shortanswer takes acceptable answers (every listed answer is accepted); essay takes no answers. The question is stored as a DRAFT (source: AI) and must be reviewed and published by the teacher in the web UI before it can be used in any quiz. Retrying with the same idempotencyKey and the same payload is safe and returns the original result; the same key with a different payload is an error. If an identical question already exists in the bank, the result is duplicate_exact with the existing questionId and nothing is created.",
  },
  {
    name: 'get_question',
    title: 'Get one question',
    description:
      'Fetch one question (with its answers and options) by id, using the standard question projection. Only questions the teacher is allowed to view are returned; anything else is reported as not found.',
  },
  {
    name: 'submit_contribution',
    title: 'Submit my questions, papers or matrices to a shared bank for review',
    description:
      'Propose one or more of YOUR OWN ready questions (questionIds), exam papers (examIds) and/or exam matrices (matrixIds) for inclusion in a shared bank (team, school or course bank) — at least one of the three lists must be non-empty, all in a single call to the same target bank. Each accepted proposal becomes a PENDING contribution in the target bank; a human moderator of that bank must approve it before the item is copied in — this tool cannot write into a shared bank directly. Items must belong to you and already be in ready status (drafts are rejected per item). The target must not be a personal bank and must be a bank of the matching kind for each item. Results are per item in three lists (results, examResults, matrixResults): pending with a contributionId, or failed with the business error code. Retrying with the same idempotencyKey and the same payload returns the original result; the same key with a different payload is an error.',
  },
  {
    name: 'create_questions_batch',
    title: 'Create many draft questions in my personal bank (per-item results)',
    description:
      'Create MANY draft questions in the teacher\'s OWN personal bank in one call. Results are PER ITEM: an item that duplicates an existing question exactly returns duplicate_exact, an invalid item returns failed with the business code and fieldPath, and the other items still run. Optional shared stimuli can be declared once in "stimuli" (each with a short "ref") and referenced from items via stimulusRef; an item may instead reference an existing stimulusId — never both. Every item is idempotent on its own key derived from the batch idempotencyKey plus the item\'s clientItemId: retrying the same batch is safe and replays per-item results. All created questions are DRAFTS (source: AI) awaiting teacher review.',
  },
  {
    name: 'create_stimulus_with_questions',
    title: 'Create a stimulus and its questions atomically',
    description:
      'Create ONE shared stimulus (reading passage / context text) plus a group of questions that all reference it, in the teacher\'s OWN personal bank. Unlike the batch tool this is ATOMIC: the stimulus and every question are written in a single transaction — if any question is invalid or duplicates an existing question exactly, NOTHING is created and the call fails. All questions become DRAFTS (source: AI) attached to the new stimulus. Retrying with the same idempotencyKey and payload returns the original result.',
  },
  {
    name: 'publish_questions',
    title: 'Publish my draft questions (draft → ready)',
    description:
      'Publish one or more of YOUR OWN draft questions from your personal bank to ready status, through the same business path the web UI uses. Results are per question: published, or failed with the reason (question not yours / not found, or not currently a draft). Only questions in your own personal bank can be published this way. Retrying with the same idempotencyKey and the same question list returns the original result.',
  },
  {
    name: 'search_questions',
    title: 'Search questions in a bank (metadata only)',
    description:
      'Search the questions of one bank you can view by a text fragment (matched against question text, case-insensitive), optionally filtered by qtype. Returns METADATA only (id, qtype, status, category, whether it is yours) — use get_question for full content. Use this to find existing questions before creating new ones.',
  },
  {
    name: 'check_duplicates',
    title: 'Check questions for duplicates without creating anything',
    description:
      'Check candidate questions against one bank for exact or near duplicates using the same content-hash mechanism as the create gate (QB-4). Nothing is written. Verdicts are per item: exact (an identical question exists — creating would be skipped), near (a similar question exists), or none. Run this before create_questions_batch to skip duplicates up front.',
  },
  {
    name: 'search_curriculum_outcomes',
    title: 'Search official curriculum outcomes (YCCĐ)',
    description:
      'Search the OFFICIAL learning outcomes (yêu cầu cần đạt) of the national curriculum by keyword, optionally filtered by subject and grade level. Only subjects you are allowed to view are searched. Use the returned outcome ids and content to anchor the questions you author — always base questions on a real outcome from this tool instead of inventing outcome codes. Formal question-to-outcome linking still happens in exam matrices/quizzes, not here.',
  },
];

const INPUT_SCHEMAS: Record<string, unknown> = {
  list_categories: mcpListCategoriesInputSchema,
  create_question: mcpCreateQuestionInputSchema,
  get_question: mcpGetQuestionInputSchema,
  submit_contribution: mcpSubmitContributionInputSchema,
  create_questions_batch: mcpCreateQuestionsBatchInputSchema,
  create_stimulus_with_questions: mcpCreateStimulusWithQuestionsInputSchema,
  publish_questions: mcpPublishQuestionsInputSchema,
  search_questions: mcpSearchQuestionsInputSchema,
  check_duplicates: mcpCheckDuplicatesInputSchema,
  search_curriculum_outcomes: mcpSearchCurriculumOutcomesInputSchema,
};

const OUTPUT_SCHEMAS: Record<string, unknown> = {
  list_my_banks: mcpListMyBanksOutputSchema,
  list_categories: mcpListCategoriesOutputSchema,
  create_question: mcpCreateQuestionOutputSchema,
  get_question: mcpGetQuestionOutputSchema,
  submit_contribution: mcpSubmitContributionOutputSchema,
  create_questions_batch: mcpCreateQuestionsBatchOutputSchema,
  create_stimulus_with_questions: mcpCreateStimulusWithQuestionsOutputSchema,
  publish_questions: mcpPublishQuestionsOutputSchema,
  search_questions: mcpSearchQuestionsOutputSchema,
  check_duplicates: mcpCheckDuplicatesOutputSchema,
  search_curriculum_outcomes: mcpSearchCurriculumOutcomesOutputSchema,
};

const READ_ONLY_TOOLS = [
  'list_my_banks',
  'list_categories',
  'get_question',
  'search_questions',
  'check_duplicates',
  'search_curriculum_outcomes',
];

const ALL_SCOPES = [
  'giaokhoa.questions.read',
  'giaokhoa.questions.draft',
  'giaokhoa.questions.write',
  'giaokhoa.banks.contribute',
];

function makeActor(scopes: string[] = ALL_SCOPES): McpActor {
  return {
    userId: 'user-1',
    username: 'giao-vien',
    tenantId: null,
    clientId: 'test-client',
    ip: null,
    era: 'modern',
    scopes,
  };
}

function makeDeps(): McpToolDeps {
  return {
    questions: {
      listCategories: vi.fn(),
      listQuestionIdsInCategory: vi.fn(),
      getQuestionForViewer: vi.fn(),
      getQuestion: vi.fn(),
      getCategory: vi.fn(),
      createQuestion: vi.fn(),
      createStimulus: vi.fn(),
      listQuestionsForViewer: vi.fn(),
    },
    banks: {
      listBanks: vi.fn(),
      getBankOrThrow: vi.fn(),
      getBank: vi.fn(),
      categoryBelongsToBank: vi.fn(),
      bankCapabilities: vi.fn(),
      findDuplicatesForPayload: vi.fn(),
      setQuestionStatus: vi.fn(),
      proposeContribution: vi.fn(),
      findBankForCategory: vi.fn(),
    },
    exams: {
      getPaperOrThrow: vi.fn(),
      proposeContribution: vi.fn(),
    },
    matrixBanks: {
      findMatrixById: vi.fn(),
      proposeContribution: vi.fn(),
    },
    curriculum: {
      searchOutcomes: vi.fn(),
    },
    idempotency: {
      find: vi.fn(),
      store: vi.fn(),
    },
    outbox: {
      enqueueStandalone: vi.fn().mockResolvedValue(undefined),
    },
    publicBaseUrl: 'https://example.test',
  } as unknown as McpToolDeps;
}

function register(actor: McpActor = makeActor(), deps: McpToolDeps = makeDeps()): {
  registrations: Registration[];
  deps: McpToolDeps;
} {
  const registrations: Registration[] = [];
  const server = {
    registerTool: (name: string, config: Registration['config'], handler: Registration['handler']) => {
      registrations.push({ name, config, handler });
      return { name } as never;
    },
  } as unknown as McpServer;
  registerMcpTools(server, actor, deps);
  return { registrations, deps };
}

function handlerOf(registrations: Registration[], name: string): Registration['handler'] {
  const found = registrations.find((r) => r.name === name);
  expect(found).toBeDefined();
  return found!.handler;
}

function errorOf(result: { structuredContent?: Record<string, unknown> }): {
  code: string;
  message: string;
  fieldPath?: string;
} {
  return (result.structuredContent as { error: { code: string; message: string; fieldPath?: string } }).error;
}

describe('Bảng đăng ký tool MCP giữ nguyên hợp đồng công bố', () => {
  it('đăng ký đúng 11 tool theo đúng thứ tự đã công bố', () => {
    const { registrations } = register();
    expect(registrations.map((r) => r.name)).toEqual(EXPECTED.map((e) => e.name));
  });

  it('mỗi tool giữ đúng title và description đã công bố', () => {
    const { registrations } = register();
    expect(registrations.map((r) => [r.name, r.config.title, r.config.description])).toEqual(
      EXPECTED.map((e) => [e.name, e.title, e.description]),
    );
  });

  it('mỗi tool giữ đúng inputSchema và outputSchema đã import từ contracts', () => {
    const { registrations } = register();
    expect(
      registrations.map((found) => ({
        name: found.name,
        inputOk:
          found.name === 'list_my_banks'
            ? JSON.stringify(found.config.inputSchema) === '{}'
            : found.config.inputSchema === INPUT_SCHEMAS[found.name],
        outputOk: found.config.outputSchema === OUTPUT_SCHEMAS[found.name],
        handlerOk: typeof found.handler === 'function',
      })),
    ).toEqual(EXPECTED.map((e) => ({ name: e.name, inputOk: true, outputOk: true, handlerOk: true })));
  });

  it('tool chỉ đọc có readOnlyHint còn tool ghi không có annotations', () => {
    const { registrations } = register();
    expect(registrations.map((r) => [r.name, r.config.annotations ?? null])).toEqual(
      EXPECTED.map((e) => [e.name, READ_ONLY_TOOLS.includes(e.name) ? { readOnlyHint: true } : null]),
    );
  });
});

describe('Hành vi handler của các tool MCP', () => {
  it('list_my_banks trả về bank đã map kèm số lượng category và ghi audit', async () => {
    const deps = makeDeps();
    const { registrations } = register(makeActor(), deps);
    (deps.banks.listBanks as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'bank-1',
        name: 'Bank cá nhân',
        scope: 'personal',
        bankKind: 'question',
        ownerId: 'user-1',
        capabilities: { add: true },
        defaultCategoryId: 'cat-1',
        categoryIds: ['cat-1', 'cat-2'],
      },
    ]);
    const result = await handlerOf(registrations, 'list_my_banks')();
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      banks: [
        {
          id: 'bank-1',
          name: 'Bank cá nhân',
          scope: 'personal',
          kind: 'question',
          ownerId: 'user-1',
          capabilities: { add: true },
          defaultCategoryId: 'cat-1',
          categoryCount: 2,
        },
      ],
    });
    expect(result.content[0]?.text).toBe('Found 1 question bank(s) you can use.');
    expect(deps.outbox.enqueueStandalone).toHaveBeenCalledWith(
      expect.objectContaining({ aggregate: 'mcp', type: 'mcp_tool_called' }),
    );
  });

  it('list_categories báo bank_not_found tại /bankId khi bank không tồn tại', async () => {
    const deps = makeDeps();
    const { registrations } = register(makeActor(), deps);
    (deps.banks.getBankOrThrow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('missing'));
    const result = await handlerOf(registrations, 'list_categories')({ bankId: 'bank-khong-co' });
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toEqual(
      expect.objectContaining({ code: 'question.bank_not_found', fieldPath: '/bankId' }),
    );
  });

  it('get_question chuyển lỗi service thành kết quả lỗi mcp.internal_error', async () => {
    const deps = makeDeps();
    const { registrations } = register(makeActor(), deps);
    (deps.questions.getQuestionForViewer as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));
    const result = await handlerOf(registrations, 'get_question')({ questionId: 'q-1' });
    expect(result.isError).toBe(true);
    expect(errorOf(result).code).toBe('mcp.internal_error');
    expect(deps.outbox.enqueueStandalone).toHaveBeenCalled();
  });

  it('search_curriculum_outcomes từ chối query chỉ toàn khoảng trắng mà không gọi curriculum', async () => {
    const deps = makeDeps();
    const { registrations } = register(makeActor(), deps);
    const result = await handlerOf(registrations, 'search_curriculum_outcomes')({ query: '   ' });
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toEqual(
      expect.objectContaining({ code: 'question.invalid_content', fieldPath: '/query' }),
    );
    expect(deps.curriculum.searchOutcomes).not.toHaveBeenCalled();
  });

  it('publish_questions từ chối actor thiếu scope giaokhoa.questions.write mà không chạm idempotency', async () => {
    const deps = makeDeps();
    const actor = makeActor(['giaokhoa.questions.read']);
    const { registrations } = register(actor, deps);
    const result = await handlerOf(registrations, 'publish_questions')({
      questionIds: ['q-1'],
      idempotencyKey: 'key-1',
    });
    expect(result.isError).toBe(true);
    expect(errorOf(result).code).toBe('insufficient_scope');
    expect(deps.idempotency.find).not.toHaveBeenCalled();
  });

  it('create_question từ chối questionText trống tại /questionText trước khi kiểm tra bank', async () => {
    const deps = makeDeps();
    const { registrations } = register(makeActor(), deps);
    const result = await handlerOf(registrations, 'create_question')({
      bankId: 'bank-1',
      categoryId: 'cat-1',
      idempotencyKey: 'key-1',
      qtype: 'essay',
      questionText: '   ',
    });
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toEqual(
      expect.objectContaining({ code: 'question.invalid_content', fieldPath: '/questionText' }),
    );
    expect(deps.banks.getBankOrThrow).not.toHaveBeenCalled();
  });

  it('create_stimulus_with_questions từ chối stimulusContent trống tại /stimulusContent', async () => {
    const deps = makeDeps();
    const { registrations } = register(makeActor(), deps);
    const result = await handlerOf(registrations, 'create_stimulus_with_questions')({
      bankId: 'bank-1',
      categoryId: 'cat-1',
      idempotencyKey: 'key-1',
      stimulusContent: '  ',
      questions: [{ qtype: 'essay', questionText: 'Câu hỏi?' }],
    });
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toEqual(
      expect.objectContaining({ code: 'question.invalid_content', fieldPath: '/stimulusContent' }),
    );
    expect(deps.banks.getBankOrThrow).not.toHaveBeenCalled();
  });

  it('check_duplicates báo bank_not_found tại /bankId khi bank không tồn tại', async () => {
    const deps = makeDeps();
    const { registrations } = register(makeActor(), deps);
    (deps.banks.getBankOrThrow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('missing'));
    const result = await handlerOf(registrations, 'check_duplicates')({
      bankId: 'bank-khong-co',
      items: [{ clientItemId: 'i-1', qtype: 'essay', questionText: 'Câu hỏi?' }],
    });
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toEqual(
      expect.objectContaining({ code: 'question.bank_not_found', fieldPath: '/bankId' }),
    );
  });

  it('submit_contribution từ chối actor thiếu scope giaokhoa.banks.contribute', async () => {
    const deps = makeDeps();
    const actor = makeActor(['giaokhoa.questions.read', 'giaokhoa.questions.draft']);
    const { registrations } = register(actor, deps);
    const result = await handlerOf(registrations, 'submit_contribution')({
      targetBankId: 'bank-chung',
      idempotencyKey: 'key-1',
      questionIds: [],
      examIds: [],
      matrixIds: [],
    });
    expect(result.isError).toBe(true);
    expect(errorOf(result).code).toBe('insufficient_scope');
  });

  it('search_questions báo bank_not_found tại /bankId khi bank không tồn tại', async () => {
    const deps = makeDeps();
    const { registrations } = register(makeActor(), deps);
    (deps.banks.getBankOrThrow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('missing'));
    const result = await handlerOf(registrations, 'search_questions')({ bankId: 'bank-khong-co', query: 'toán' });
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toEqual(
      expect.objectContaining({ code: 'question.bank_not_found', fieldPath: '/bankId' }),
    );
  });

  it('create_questions_batch dừng ở cổng bank khi bank không tồn tại mà không chạy item nào', async () => {
    const deps = makeDeps();
    const { registrations } = register(makeActor(), deps);
    (deps.banks.getBankOrThrow as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('missing'));
    const result = await handlerOf(registrations, 'create_questions_batch')({
      bankId: 'bank-khong-co',
      categoryId: 'cat-1',
      idempotencyKey: 'key-1',
      items: [{ clientItemId: 'i-1', qtype: 'essay', questionText: 'Câu hỏi?' }],
    });
    expect(result.isError).toBe(true);
    expect(errorOf(result)).toEqual(
      expect.objectContaining({ code: 'question.bank_not_found', fieldPath: '/bankId' }),
    );
    expect(deps.questions.createQuestion).not.toHaveBeenCalled();
  });
});
