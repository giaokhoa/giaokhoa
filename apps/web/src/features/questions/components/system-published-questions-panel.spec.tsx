import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '#config/i18n';
import {
  acknowledgeSystemQuestionEvent, fetchSystemQuestionEvents, fetchUsedSystemQuestions,
  importSystemPublishedQuestion,
} from '../api/questions';
import { SystemPublishedQuestionsPanel } from './system-published-questions-panel';

vi.mock('#lib/permissions', () => ({
  usePermissions: () => ({ ready: true, canUseQuestionBank: true }),
}));
vi.mock('../api/questions', () => ({
  fetchSystemPublishedQuestions: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
  fetchSystemPublishedVersion: vi.fn(),
  importSystemPublishedQuestion: vi.fn(async () => ({})),
  fetchUsedSystemQuestions: vi.fn(async () => []),
  fetchSystemQuestionEvents: vi.fn(async () => []),
  acknowledgeSystemQuestionEvent: vi.fn(async () => ({})),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Giáo viên quản lý bản riêng và phiên bản nguồn câu hỏi', () => {
  it('hiển thị phiên bản nguồn đã dùng và chỉ tạo bản riêng mới khi giáo viên chủ động chọn', async () => {
    const sourceQuestionId = '01961300-0000-7000-8000-000000000010';
    vi.mocked(fetchUsedSystemQuestions).mockResolvedValueOnce([{
      questionId: '01961300-0000-7000-8000-000000000011',
      sourceQuestionId,
      sourceVersionId: '01961300-0000-7000-8000-000000000012',
      sourceVersionNumber: 1,
      packageChecksum: 'checksum',
      kind: 'derived', sourceStatus: 'published', latestVersionNumber: 2, hasNewVersion: true,
    }]);
    render(<SystemPublishedQuestionsPanel />);
    expect(await screen.findByText(/Có phiên bản mới: v2|New version available: v2/)).toBeTruthy();
    expect(importSystemPublishedQuestion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Tạo bản riêng từ phiên bản mới|Create a copy of the new version/ }));
    await waitFor(() => expect(importSystemPublishedQuestion).toHaveBeenCalledWith(sourceQuestionId, 2));
  });

  it('hiển thị thông báo rút nguồn và chỉ ghi nhận sau khi giáo viên chọn đã xem', async () => {
    const eventId = '01961300-0000-7000-8000-000000000014';
    vi.mocked(fetchSystemQuestionEvents).mockResolvedValueOnce([{
      id: eventId, type: 'question_withdrawn',
      sourceQuestionId: '01961300-0000-7000-8000-000000000015',
      resourceKind: null, resourceKey: null,
      payload: { reason: 'Nguồn đã rút' },
    }]);
    render(<SystemPublishedQuestionsPanel />);
    expect(await screen.findByText(/Nguồn đã bị rút|Source withdrawn/)).toBeTruthy();
    expect(acknowledgeSystemQuestionEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Đã xem|Acknowledge/ }));
    await waitFor(() => expect(acknowledgeSystemQuestionEvent).toHaveBeenCalledWith(eventId));
  });
});
