import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import McpConsentPage from './mcp-consent';

/**
 * Kiểm chứng biên uỷ quyền MCP khi React Router giữ nguyên component nhưng thay query OAuth: trạng thái, quyền tích và kết quả fetch đều phải thuộc cùng yêu cầu; phản hồi cũ không được cập nhật yêu cầu mới.
 */
const AUTHORIZE_A =
  'client_id=client-a&scope=giaokhoa.questions.read%20giaokhoa.questions.write&state=nonce-a';
const AUTHORIZE_B =
  'client_id=client-b&scope=giaokhoa.banks.contribute&state=nonce-b';

function consentPath(query: string): string {
  return '/mcp-consent?oauth_query=' + encodeURIComponent(query);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderConsent(initialPath: string) {
  const router = createMemoryRouter(
    [{ path: '/mcp-consent', element: <McpConsentPage /> }],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Trang đồng ý MCP — cùng route, nhiều yêu cầu OAuth', () => {
  it('đổi A sang B, reset quyền và không để phản hồi client A ghi đè tên B hoặc payload B', async () => {
    let resolveClientA!: (response: Response) => void;
    const clientA = new Promise<Response>((resolve) => {
      resolveClientA = resolve;
    });
    const submitted: Array<{
      accept: boolean;
      scope?: string;
      oauth_query: string;
    }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) => {
        if (input.includes('public-client?client_id=client-a')) return clientA;
        if (input.includes('public-client?client_id=client-b'))
          return Promise.resolve(jsonResponse({ name: 'Ứng dụng B' }));
        if (input === '/api/v1/auth/oauth2/consent') {
          submitted.push(
            JSON.parse(String(init?.body)) as (typeof submitted)[number],
          );
          return Promise.resolve(jsonResponse({}, 400));
        }
        return Promise.resolve(jsonResponse({}, 404));
      }),
    );

    const router = renderConsent(consentPath(AUTHORIZE_A));
    const user = userEvent.setup();
    const write = screen.getByRole('checkbox', { name: /PHÁT HÀNH câu hỏi/ });
    expect(write).not.toBeChecked();
    await user.click(write);
    expect(write).toBeChecked();

    await act(async () => {
      await router.navigate(consentPath(AUTHORIZE_B));
    });
    expect(
      await screen.findByText(/Ứng dụng "Ứng dụng B"/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: /PHÁT HÀNH câu hỏi/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /Đề xuất đóng góp câu hỏi/ }),
    ).toBeChecked();

    await act(async () => {
      resolveClientA(jsonResponse({ name: 'Ứng dụng A' }));
    });
    expect(screen.getByText(/Ứng dụng "Ứng dụng B"/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Đồng ý uỷ quyền' }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]).toEqual({
      accept: true,
      scope: 'giaokhoa.banks.contribute',
      oauth_query: AUTHORIZE_B,
    });
  });

  it('đổi URL khi đang submit A thì trạng thái và lỗi phản hồi cũ không xuất hiện trên B', async () => {
    let resolveConsentA!: (response: Response) => void;
    const pendingConsentA = new Promise<Response>((resolve) => {
      resolveConsentA = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input.includes('public-client'))
          return Promise.resolve(jsonResponse({ name: 'Ứng dụng hợp lệ' }));
        if (input === '/api/v1/auth/oauth2/consent') return pendingConsentA;
        return Promise.resolve(jsonResponse({}, 404));
      }),
    );

    const router = renderConsent(consentPath(AUTHORIZE_A));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Đồng ý uỷ quyền' }));
    expect(screen.getByRole('button', { name: 'Đang xử lý…' })).toBeDisabled();

    await act(async () => {
      await router.navigate(consentPath(AUTHORIZE_B));
    });
    expect(
      screen.getByRole('button', { name: 'Đồng ý uỷ quyền' }),
    ).toBeEnabled();
    await act(async () => {
      resolveConsentA(jsonResponse({}, 400));
    });
    expect(
      screen.queryByText(/Máy chủ không chấp nhận lựa chọn này/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /Đề xuất đóng góp câu hỏi/ }),
    ).toBeChecked();
  });

  it('URL OAuth không hợp lệ chỉ chặn yêu cầu đó, không giữ lỗi sang URL hợp lệ kế tiếp', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ name: 'Ứng dụng B' })),
    );
    const router = renderConsent('/mcp-consent?state=missing-client');
    expect(
      screen.getByText(/Liên kết uỷ quyền không hợp lệ/),
    ).toBeInTheDocument();
    await act(async () => {
      await router.navigate(consentPath(AUTHORIZE_B));
    });
    expect(
      screen.queryByText(/Liên kết uỷ quyền không hợp lệ/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Đồng ý uỷ quyền' }),
    ).toBeEnabled();
  });
});
