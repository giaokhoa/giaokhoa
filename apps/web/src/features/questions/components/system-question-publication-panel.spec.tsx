import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '#config/i18n';
import { submitSystemQuestion, fetchSystemSubmissionSources } from '../api/questions';
import { SystemQuestionPublicationPanel } from './system-question-publication-panel';

vi.mock('#lib/permissions', () => ({
  usePermissions: () => ({
    ready: true, access: {
      contexts: [{ contextLevel: 20, capabilities: ['tenant:manage'] }],
      isSiteAdmin: false,
    },
  }),
}));
vi.mock('../api/questions', () => ({
  fetchSystemSubmissionSources: vi.fn(),
  fetchSystemQuestionSubmissions: vi.fn(async () => []),
  submitSystemQuestion: vi.fn(async () => ({ status: 'pending' })),
  approveSystemQuestionSubmission: vi.fn(),
  rejectSystemQuestionSubmission: vi.fn(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Quản trị gửi duyệt câu từ ngân hàng trung tâm (#13)', () => {
  it('chọn trực tiếp câu của giáo viên và gửi theo ID của mục được chọn', async () => {
    const questionId = '01961300-0000-7000-8000-000000000123';
    vi.mocked(fetchSystemSubmissionSources).mockResolvedValue([{
      id: questionId, qtype: 'multichoice',
      questionText: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Câu của giáo viên' }] },
      ] }, version: 3,
    }]);
    render(<SystemQuestionPublicationPanel />);
    const option = await screen.findByRole('option', { name: /Câu của giáo viên/ });
    const picker = option.closest('select');
    expect(picker).not.toBeNull();
    fireEvent.change(picker!, { target: { value: questionId } });
    fireEvent.click(screen.getByRole('button', { name: /Gửi duyệt|Submit for review/ }));
    await waitFor(() => expect(submitSystemQuestion).toHaveBeenCalledWith(questionId, ''));
  });
});
