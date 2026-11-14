import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '#config/i18n';
import { acknowledgeSystemQuestionEvent, fetchSystemQuestionEvents } from '#lib/system-resource-events';
import { SystemSourceNotices } from './system-source-notices';

vi.mock('#lib/system-resource-events', () => ({
  fetchSystemQuestionEvents: vi.fn(async () => []),
  acknowledgeSystemQuestionEvent: vi.fn(async () => ({})),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Thông báo phiên bản đã dùng theo từng loại nguồn', () => {
  it('chỉ hiện sự kiện liên quan và ghi nhận sau khi người dùng chọn', async () => {
    const eventId = '01961300-0000-7000-8000-000000000036';
    vi.mocked(fetchSystemQuestionEvents).mockResolvedValueOnce([
      {
        id: eventId, type: 'material_withdrawn', sourceQuestionId: null, resourceKind: 'material',
        resourceKey: '01961300-0000-7000-8000-000000000035', payload: { reason: 'Cập nhật nguồn' },
      },
      {
        id: '01961300-0000-7000-8000-000000000037',
        type: 'exam_version_published', sourceQuestionId: null, resourceKind: 'exam',
        resourceKey: 'centre/exam', payload: { versionNumber: 2 },
      },
    ]);
    render(<SystemSourceNotices resourceKind="material" />);
    expect(await screen.findByText(/Cập nhật nguồn/)).toBeTruthy();
    expect(screen.queryByText(/centre\/exam/)).toBeNull();
    expect(acknowledgeSystemQuestionEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Đã xem|Acknowledge/ }));
    await waitFor(() => expect(acknowledgeSystemQuestionEvent).toHaveBeenCalledWith(eventId));
    await waitFor(() => expect(screen.queryByText(/Cập nhật nguồn/)).toBeNull());
  });
});
