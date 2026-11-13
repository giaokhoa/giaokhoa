/**
 * Kiểm chứng bản xem trước của biên tập viên hiển thị toàn bộ nội dung,
 * khoá đáp án đúng/sai, lời giải tự luận và URL ảnh đã gác quyền.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '#config/i18n';
import type { SystemQuestionSubmission } from '../api/questions';
import { SystemSubmissionReviewPreview } from './system-submission-review-preview';

const ID = '01961300-0000-7000-8000-000000000111';
const HASH = 'a'.repeat(64);
const doc = (text: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }],
});

/** Bản chụp chứa các trường cần được trình bày trước khi xét duyệt. */
function submission(qtype: SystemQuestionSubmission['qtype']): SystemQuestionSubmission {
  return {
    id: ID, centreSlug: 'trung-tam-a', sourceQuestionId: ID,
    sourceVersionId: ID, sourceVersionNumber: 2, qtype,
    package: {
      questionText: doc('Toàn bộ nội dung câu hỏi được trình bày'),
      stimulusContent: doc('Ngữ liệu của câu hỏi'),
      generalFeedback: doc('Phản hồi chung sau khi làm'),
      answers: [
        { answer: doc('Đáp án hàng một'), feedback: doc('Phản hồi của đáp án một'), isCorrect: true, sortOrder: 0 },
      ],
      answerKey: { guidance: doc('Hướng dẫn cho người học'), solution: null },
      options: { responseFormat: 'editor', maxWordLimit: 300 },
      outcomes: [{ outcomeId: ID, cognitiveLevel: 'hieu' }],
      media: [{ contentHash: HASH, fileName: 'minh-hoa.png', mimeType: 'image/png' }],
      source: {
        centreSlug: 'trung-tam-a', questionId: ID, versionId: ID, versionNumber: 2,
        authorId: ID, sourceKind: 'book', sourceRef: 'Tài liệu kiểm tra', license: 'CC BY 4.0',
      },
    },
    checksum: HASH, status: 'pending', submittedBy: ID, reviewedBy: null,
    rejectionReason: null, publishedQuestionId: null, publishedVersion: null, createdAt: '2026-11-13T00:00:00Z',
  };
}

afterEach(() => cleanup());

describe('Bản xem trước gói gửi duyệt hệ thống (#13)', () => {
  it('hiển thị không cắt câu/đáp án, phản hồi, ngữ liệu, cấu hình, nguồn và ảnh có cổng biên tập', () => {
    const input = submission('shortanswer');
    input.package.questionText = {
      type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Nội dung mở đầu' }] },
        { type: 'image', attrs: { src: `bank-media://${HASH}`, alt: 'Hình chèn trong câu' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Nội dung kết thúc không bị cắt' }] },
      ],
    };
    render(<SystemSubmissionReviewPreview submission={input} />);
    expect(screen.getByText('Nội dung kết thúc không bị cắt')).toBeInTheDocument();
    expect(screen.getByText('Ngữ liệu của câu hỏi')).toBeInTheDocument();
    expect(screen.getByText('Đáp án hàng một')).toBeInTheDocument();
    expect(screen.getByText('Phản hồi của đáp án một')).toBeInTheDocument();
    expect(screen.getByText('Phản hồi chung sau khi làm')).toBeInTheDocument();
    expect(screen.getByText('Hướng dẫn cho người học')).toBeInTheDocument();
    expect(screen.getByText('Tài liệu kiểm tra', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(2);
    for (const image of images) {
      expect(image).toHaveAttribute('src', `/api/v1/system-bank/submissions/${ID}/media/${HASH}`);
    }
  });

  it('hiển thị khoá bốn mệnh đề đúng/sai và lời giải tự luận', () => {
    const tf = submission('truefalse');
    tf.package.answers = [];
    tf.package.answerKey = {
      guidance: null,
      solution: { answers: [1, 2, 3, 4].map((number) => ({ statementId: `s${number}`, value: number % 2 === 0 })) },
    };
    tf.package.questionText = {
      type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Chọn đúng/sai' }] },
        { type: 'statementList', content: [1, 2, 3, 4].map((number) => ({
          type: 'statement', attrs: { id: `s${number}` },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `Mệnh đề ${number}` }] }],
        })) },
      ],
    };
    const view = render(<SystemSubmissionReviewPreview submission={tf} />);
    expect(screen.getByText('Mệnh đề 4')).toBeInTheDocument();
    expect(screen.getByText('s4')).toBeInTheDocument();
    view.unmount();
    const essay = submission('essay');
    essay.package.answers = [];
    essay.package.answerKey = { guidance: null, solution: { answer: doc('Lời giải mẫu tự luận đầy đủ') } };
    render(<SystemSubmissionReviewPreview submission={essay} />);
    expect(screen.getByText('Lời giải mẫu tự luận đầy đủ')).toBeInTheDocument();
  });
});
