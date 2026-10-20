import {
  draftQuestionSchema,
  questionCreateSchema,
  questionPatchSchema,
  questionSchema,
  questionVersionSummarySchema,
  readyQuestionSchema,
  stimulusCreateSchema,
} from '../../src/questions.js';
import { expect, test } from 'vitest';

const paragraph = (text = 'Nội dung') => ({
  type: 'paragraph' as const,
  content: [{ type: 'text' as const, text }],
});
const answer = (text: string) => ({ type: 'doc' as const, content: [paragraph(text)] });
const tableCellAttrs = {
  colspan: 1,
  rowspan: 1,
  colwidth: null,
  align: null,
} as const;

const choiceIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
] as const;
const statementIds = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
] as const;

const multipleChoice = {
  type: 'multiple_choice',
  content: {
    type: 'doc',
    content: [
      paragraph('Thủ đô của Việt Nam là thành phố nào?'),
      {
        type: 'choiceList',
        content: choiceIds.map((id, index) => ({
          type: 'choice',
          attrs: { id },
          content: [paragraph(['Hải Phòng', 'Hà Nội', 'Đà Nẵng', 'Cần Thơ'][index])],
        })),
      },
    ],
  },
  solution: { choiceId: choiceIds[1] },
} as const;

const trueFalse = {
  type: 'true_false',
  content: {
    type: 'doc',
    content: [
      paragraph('Xét các phát biểu sau.'),
      {
        type: 'statementList',
        content: statementIds.map((id, index) => ({
          type: 'statement',
          attrs: { id },
          content: [paragraph(`Phát biểu ${index + 1}`)],
        })),
      },
    ],
  },
  solution: {
    answers: statementIds.map((statementId, index) => ({ statementId, value: index % 2 === 0 })),
  },
} as const;

const shortAnswer = {
  type: 'short_answer',
  content: { type: 'doc', content: [paragraph('Giá trị cần tìm là bao nhiêu?')] },
  solution: { answer: '-2,5' },
} as const;

const essay = {
  type: 'essay',
  content: { type: 'doc', content: [paragraph('Trình bày lời giải.')] },
  solution: { answer: answer('Lời giải mẫu') },
} as const;

const cases = [multipleChoice, trueFalse, shortAnswer, essay] as const;

test.each(cases)('backend nhận canonical $type', (question) => {
  expect(readyQuestionSchema.safeParse(question).success).toBe(true);
});

test('canonical question từ chối field không khai báo thay vì strip im lặng', () => {
  expect(readyQuestionSchema.safeParse({ ...shortAnswer, typo: true }).success).toBe(false);
  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      solution: { ...shortAnswer.solution, typo: true },
    }).success,
  ).toBe(false);
});

test('patch từ chối field không khai báo', () => {
  expect(questionPatchSchema.safeParse({ typo: true }).success).toBe(false);
  expect(questionPatchSchema.safeParse({ type: 'short_answer', typo: true }).success).toBe(false);
  expect(questionPatchSchema.safeParse({}).success).toBe(false);
});

test('patch cho phép đổi trạng thái độc lập hoặc chọn trạng thái khi sửa nội dung', () => {
  expect(questionPatchSchema.safeParse({ status: 'ready' }).success).toBe(true);
  expect(questionPatchSchema.safeParse({ status: 'draft' }).success).toBe(true);
  expect(questionPatchSchema.safeParse({ status: 'hidden' }).success).toBe(false);
  expect(
    questionPatchSchema.safeParse({
      status: 'ready',
      content: shortAnswer.content,
      solution: shortAnswer.solution,
    }).success,
  ).toBe(true);
});

test('essay solution không được đồng thời có answer và answers', () => {
  expect(
    readyQuestionSchema.safeParse({
      ...essay,
      solution: { answer: answer('Lời giải mẫu'), answers: [] },
    }).success,
  ).toBe(false);
});

test('stimulus và question response dùng object contract strict', () => {
  expect(
    stimulusCreateSchema.safeParse({
      content: { type: 'doc', content: [paragraph('Ngữ liệu')] },
      typo: true,
    }).success,
  ).toBe(false);

  const response = {
    id: '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d20',
    version: 1,
    status: 'ready' as const,
    ...shortAnswer,
    stimulusId: null,
    guidance: null,
  };
  expect(questionSchema.safeParse(response).success).toBe(true);
  expect(questionSchema.safeParse({ ...response, typo: true }).success).toBe(false);
  expect(questionSchema.safeParse({ ...response, version: 0 }).success).toBe(false);
  expect(questionSchema.safeParse({ ...response, version: 1.5 }).success).toBe(false);
  expect(questionSchema.safeParse({ ...response, version: undefined }).success).toBe(false);
});

test('version history chỉ chứa version và status hợp lệ', () => {
  expect(questionVersionSummarySchema.safeParse({ version: 1, status: 'draft' }).success).toBe(
    true,
  );
  expect(questionVersionSummarySchema.safeParse({ version: 2, status: 'ready' }).success).toBe(
    true,
  );
  expect(questionVersionSummarySchema.safeParse({ version: 0, status: 'ready' }).success).toBe(
    false,
  );
  expect(
    questionVersionSummarySchema.safeParse({ version: 1, status: 'ready', typo: true }).success,
  ).toBe(false);
});

test('solution không được reference child ngoài question', () => {
  expect(
    readyQuestionSchema.safeParse({
      ...multipleChoice,
      solution: { choiceId: '55555555-5555-4555-8555-555555555555' },
    }).success,
  ).toBe(false);
});

test('multiple choice phải có đúng 4 lựa chọn', () => {
  expect(
    readyQuestionSchema.safeParse({
      ...multipleChoice,
      content: {
        ...multipleChoice.content,
        content: [
          multipleChoice.content.content[0],
          {
            ...multipleChoice.content.content[1],
            content: multipleChoice.content.content[1].content.slice(0, 3),
          },
        ],
      },
    }).success,
  ).toBe(false);
});

test('đúng sai phải có đúng 4 ý', () => {
  expect(
    readyQuestionSchema.safeParse({
      ...trueFalse,
      content: {
        ...trueFalse.content,
        content: [
          trueFalse.content.content[0],
          {
            ...trueFalse.content.content[1],
            content: trueFalse.content.content[1].content.slice(0, 3),
          },
        ],
      },
    }).success,
  ).toBe(false);
});

test('canonical question phải có solution', () => {
  const { solution: _solution, ...withoutSolution } = multipleChoice;
  expect(readyQuestionSchema.safeParse(withoutSolution).success).toBe(false);
});

test('multiple choice không nhận stem hoặc lựa chọn rỗng', () => {
  const emptyParagraph = { type: 'paragraph' as const };

  expect(
    readyQuestionSchema.safeParse({
      ...multipleChoice,
      content: {
        ...multipleChoice.content,
        content: [emptyParagraph, multipleChoice.content.content[1]],
      },
    }).success,
  ).toBe(false);

  expect(
    readyQuestionSchema.safeParse({
      ...multipleChoice,
      content: {
        ...multipleChoice.content,
        content: [
          multipleChoice.content.content[0],
          {
            ...multipleChoice.content.content[1],
            content: multipleChoice.content.content[1].content.map((choice, index) =>
              index === 0 ? { ...choice, content: [emptyParagraph] } : choice,
            ),
          },
        ],
      },
    }).success,
  ).toBe(false);
});

test('solution đúng sai phải bao phủ đủ 4 ý', () => {
  expect(
    readyQuestionSchema.safeParse({
      ...trueFalse,
      solution: { answers: trueFalse.solution.answers.slice(0, 3) },
    }).success,
  ).toBe(false);
});

test('trả lời ngắn chỉ nhận tối đa 4 ký tự hợp lệ', () => {
  expect(
    readyQuestionSchema.safeParse({ ...shortAnswer, solution: { answer: '12345' } }).success,
  ).toBe(false);
  expect(
    readyQuestionSchema.safeParse({ ...shortAnswer, solution: { answer: '1 2' } }).success,
  ).toBe(false);
  expect(readyQuestionSchema.safeParse({ ...shortAnswer, solution: { answer: '×' } }).success).toBe(
    false,
  );
  expect(readyQuestionSchema.safeParse({ ...shortAnswer, solution: { answer: '÷' } }).success).toBe(
    false,
  );
  expect(
    readyQuestionSchema.safeParse({ ...shortAnswer, solution: { answer: '+A' } }).success,
  ).toBe(true);
});

test('essay nhiều phần phải có đáp án cho đủ part', () => {
  const partIds = [
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
  ] as const;
  const multipart = {
    type: 'essay',
    content: {
      type: 'doc',
      content: [
        paragraph('Trả lời các ý sau.'),
        {
          type: 'partList',
          content: partIds.map((id, index) => ({
            type: 'part',
            attrs: { id },
            content: [paragraph(`Ý ${index + 1}`)],
          })),
        },
      ],
    },
    solution: { answers: [{ partId: partIds[0], content: answer('Đáp án 1') }] },
  };

  expect(readyQuestionSchema.safeParse(multipart).success).toBe(false);
});

test('guidance là rich content độc lập và không bắt buộc', () => {
  expect(
    readyQuestionSchema.safeParse({
      ...multipleChoice,
      guidance: answer('Chọn một đáp án đúng.'),
    }).success,
  ).toBe(true);

  expect(
    readyQuestionSchema.safeParse({
      ...multipleChoice,
      guidance: null,
    }).success,
  ).toBe(true);
});

test('paragraph alignment nhận trái giữa phải justify và null, từ chối giá trị khác', () => {
  for (const textAlign of ['left', 'center', 'right', 'justify', null] as const) {
    expect(
      readyQuestionSchema.safeParse({
        ...shortAnswer,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { textAlign },
              content: [{ type: 'text', text: 'Nội dung' }],
            },
          ],
        },
      }).success,
    ).toBe(true);
  }

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { textAlign: 'middle' },
            content: [{ type: 'text', text: 'Nội dung' }],
          },
        ],
      },
    }).success,
  ).toBe(false);
});

test('math node hợp lệ được tính là nội dung', () => {
  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'inlineMath', attrs: { latex: 'x^2 + y^2 = z^2' } }],
          },
        ],
      },
    }).success,
  ).toBe(true);
});

test('table theo JSON mặc định của Tiptap được nhận và tính là nội dung', () => {
  const table = {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [
          {
            type: 'tableHeader',
            attrs: tableCellAttrs,
            content: [paragraph('Cột A')],
          },
          {
            type: 'tableHeader',
            attrs: { ...tableCellAttrs, colwidth: [160], align: 'center' },
            content: [paragraph('Cột B')],
          },
        ],
      },
      {
        type: 'tableRow',
        content: [
          {
            type: 'tableCell',
            attrs: tableCellAttrs,
            content: [paragraph('A1')],
          },
          {
            type: 'tableCell',
            attrs: tableCellAttrs,
            content: [paragraph('B1')],
          },
        ],
      },
    ],
  } as const;

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: { type: 'doc', content: [table] },
    }).success,
  ).toBe(true);
});

test('table nhận colwidth 0 do ProseMirror tạo khi merge cột', () => {
  const table = {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [
          {
            type: 'tableCell',
            attrs: { ...tableCellAttrs, colspan: 2, colwidth: [160, 0] },
            content: [paragraph('Ô đã gộp')],
          },
        ],
      },
    ],
  } as const;

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: { type: 'doc', content: [table] },
    }).success,
  ).toBe(true);

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: {
        type: 'doc',
        content: [
          {
            ...table,
            content: [
              {
                ...table.content[0],
                content: [
                  {
                    ...table.content[0].content[0],
                    attrs: { ...tableCellAttrs, colspan: 2, colwidth: [160, -1] },
                  },
                ],
              },
            ],
          },
        ],
      },
    }).success,
  ).toBe(false);
});

test('table cell giữ block+ mặc định của Tiptap, kể cả nested table', () => {
  const nestedTable = {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [
          {
            type: 'tableCell',
            attrs: tableCellAttrs,
            content: [paragraph('Bảng con')],
          },
        ],
      },
    ],
  } as const;

  const table = {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [
          {
            type: 'tableCell',
            attrs: tableCellAttrs,
            content: [nestedTable],
          },
        ],
      },
    ],
  } as const;

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: { type: 'doc', content: [table] },
    }).success,
  ).toBe(true);
});

test('table chỉ có các paragraph rỗng không được tính là nội dung', () => {
  const emptyTable = {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [
          {
            type: 'tableCell',
            attrs: tableCellAttrs,
            content: [{ type: 'paragraph' }],
          },
        ],
      },
    ],
  } as const;

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: { type: 'doc', content: [emptyTable] },
    }).success,
  ).toBe(false);
});

test('image image hợp lệ được tính là nội dung', () => {
  const imageId = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d21';

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              imageId,
              src: `/images/${imageId}`,
              alt: 'Hình minh họa',
              title: null,
              width: null,
              height: null,
            },
          },
        ],
      },
    }).success,
  ).toBe(true);
});

test('image alignment nhận trái giữa phải, mặc định giữa và ảnh cũ mặc định original', () => {
  const imageId = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d21';
  const attrs = {
    imageId,
    src: `/images/${imageId}`,
    alt: null,
    title: null,
    width: 320,
    height: 180,
  };

  for (const align of ['left', 'center', 'right'] as const) {
    expect(
      readyQuestionSchema.safeParse({
        ...shortAnswer,
        content: {
          type: 'doc',
          content: [{ type: 'image', attrs: { ...attrs, align } }],
        },
      }).success,
    ).toBe(true);
  }

  const legacyImage = readyQuestionSchema.safeParse({
    ...shortAnswer,
    content: { type: 'doc', content: [{ type: 'image', attrs }] },
  });
  expect(legacyImage.success).toBe(true);
  if (legacyImage.success) {
    const image = legacyImage.data.content.content?.[0];
    expect(image?.type).toBe('image');
    if (image?.type === 'image') {
      expect(image.attrs.align).toBe('center');
      expect(image.attrs.imageVariantId).toBeNull();
      expect(image.attrs.crop).toBeNull();
    }
  }

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: {
        type: 'doc',
        content: [{ type: 'image', attrs: { ...attrs, align: 'justify' } }],
      },
    }).success,
  ).toBe(false);
});

test('image crop variant phải khớp image, URL và crop metadata', () => {
  const imageId = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d21';
  const imageVariantId = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d23';
  const attrs = {
    imageId,
    imageVariantId,
    src: `/images/${imageId}/variants/${imageVariantId}`,
    alt: 'crop.png',
    title: null,
    width: 320,
    height: 180,
    align: 'center',
    crop: { x: 10, y: 15, width: 70, height: 60 },
  };

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: { type: 'doc', content: [{ type: 'image', attrs }] },
    }).success,
  ).toBe(true);

  for (const invalidAttrs of [
    { ...attrs, imageVariantId: null },
    { ...attrs, crop: null },
    { ...attrs, src: `/images/${imageId}` },
    { ...attrs, crop: { x: 50, y: 15, width: 60, height: 60 } },
  ]) {
    expect(
      readyQuestionSchema.safeParse({
        ...shortAnswer,
        content: { type: 'doc', content: [{ type: 'image', attrs: invalidAttrs }] },
      }).success,
    ).toBe(false);
  }
});

test('image TikZ giữ tương thích ảnh cũ và không được dùng crop variant', () => {
  const imageId = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d21';
  const imageVariantId = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d23';
  const baseAttrs = {
    imageId,
    src: `/images/${imageId}`,
    alt: 'tikz-diagram.svg',
    title: null,
    width: 320,
    height: 180,
    align: 'center' as const,
  };

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: {
        type: 'doc',
        content: [{ type: 'image', attrs: baseAttrs }],
      },
    }).success,
  ).toBe(true);

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: {
        type: 'doc',
        content: [{ type: 'image', attrs: { ...baseAttrs, generatorKind: 'tikz' } }],
      },
    }).success,
  ).toBe(true);

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: {
              ...baseAttrs,
              generatorKind: 'tikz',
              imageVariantId,
              src: `/images/${imageId}/variants/${imageVariantId}`,
              crop: { x: 0, y: 0, width: 100, height: 100 },
            },
          },
        ],
      },
    }).success,
  ).toBe(false);
});

test('image node từ chối URL ngoài, image không khớp và kích thước dở dang', () => {
  const imageId = '018f4c1a-8f27-7b11-8f5e-2bfbf97b6d21';
  const attrs = {
    imageId,
    src: `/images/${imageId}`,
    alt: null,
    title: null,
    width: null,
    height: null,
  };

  for (const invalidAttrs of [
    { ...attrs, src: 'https://example.com/image.png' },
    { ...attrs, src: '/images/018f4c1a-8f27-7b11-8f5e-2bfbf97b6d22' },
    { ...attrs, width: 320 },
  ]) {
    expect(
      readyQuestionSchema.safeParse({
        ...shortAnswer,
        content: { type: 'doc', content: [{ type: 'image', attrs: invalidAttrs }] },
      }).success,
    ).toBe(false);
  }
});

test('backend từ chối math node rỗng hoặc LaTeX sai', () => {
  for (const latex of ['', String.raw`\\frac{`]) {
    expect(
      readyQuestionSchema.safeParse({
        ...shortAnswer,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'inlineMath', attrs: { latex } }],
            },
          ],
        },
      }).success,
    ).toBe(false);
  }
});

test('rich content chỉ nhận node và mark mà editor hỗ trợ', () => {
  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: {
        type: 'doc',
        content: [{ type: 'heading', content: [{ type: 'text', text: 'Không hỗ trợ' }] }],
      },
    }).success,
  ).toBe(false);

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Không hỗ trợ', marks: [{ type: 'bold' }] }],
          },
        ],
      },
    }).success,
  ).toBe(false);
});

test('rich content khóa đúng vị trí inline và block math', () => {
  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: {
        type: 'doc',
        content: [{ type: 'blockMath', attrs: { latex: 'x^2' } }],
      },
    }).success,
  ).toBe(true);

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: {
        type: 'doc',
        content: [{ type: 'inlineMath', attrs: { latex: 'x^2' } }],
      },
    }).success,
  ).toBe(false);

  expect(
    readyQuestionSchema.safeParse({
      ...shortAnswer,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'blockMath', attrs: { latex: 'x^2' } }],
          },
        ],
      },
    }).success,
  ).toBe(false);
});

test('draft question accepts structurally valid incomplete content', () => {
  expect(
    draftQuestionSchema.safeParse({
      type: 'short_answer',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      solution: null,
    }).success,
  ).toBe(true);
});

test('question write status controls draft versus ready validation', () => {
  const incomplete = {
    type: 'short_answer' as const,
    content: { type: 'doc' as const, content: [{ type: 'paragraph' as const }] },
    solution: null,
  };

  expect(questionCreateSchema.safeParse({ status: 'draft', ...incomplete }).success).toBe(true);
  expect(questionCreateSchema.safeParse({ status: 'ready', ...incomplete }).success).toBe(false);
  expect(questionCreateSchema.safeParse({ status: 'ready', ...shortAnswer }).success).toBe(true);
});
