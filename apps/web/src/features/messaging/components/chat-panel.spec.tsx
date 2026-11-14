import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import '#config/i18n';
import { createQueryClient } from '#lib/query-client';
import { ChatPanel } from './chat-panel';
import type { ConversationView, MessageView } from '../types/types';

const ME_ID = '01900000-0000-7000-8000-0000000000a1';
const OTHER_ID = '01900000-0000-7000-8000-0000000000b2';
const CONV_ID = '01900000-0000-7000-8000-0000000000c3';
const PEER_MESSAGE_ID = '01900000-0000-7000-8000-0000000000e5';
const OWN_MESSAGE_ID = '01900000-0000-7000-8000-0000000000e6';

const ACTIVE: ConversationView = {
  id: CONV_ID,
  type: 1,
  name: null,
  members: [ME_ID, OTHER_ID],
  enabled: true,
  canModerate: false,
  canManage: false,
};

const PEER_MESSAGE: MessageView = {
  id: PEER_MESSAGE_ID,
  conversationId: CONV_ID,
  userIdFrom: OTHER_ID,
  fullMessage: 'tin của bạn học',
  createdAt: '2026-01-01T00:00:00.000Z',
  seq: 1,
  clientMessageId: null,
};

const OWN_MESSAGE: MessageView = {
  id: OWN_MESSAGE_ID,
  conversationId: CONV_ID,
  userIdFrom: ME_ID,
  fullMessage: 'tin của tôi',
  createdAt: '2026-01-01T00:01:00.000Z',
  seq: 2,
  clientMessageId: null,
};

function renderPanel(overrides: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const props = {
    active: ACTIVE,
    myId: ME_ID,
    onlineUsers: { [OTHER_ID]: true },
    readMarkers: {},
    onBack: vi.fn(),
    blocked: [],
    onUnblockContact: vi.fn(),
    onBlockContact: vi.fn(),
    onReportConversation: vi.fn(),
    onToggleChat: vi.fn(),
    reportMessage: null,
    actionMessage: null,
    hasMoreBefore: false,
    onLoadOlder: vi.fn(),
    selectedForBulk: new Set<string>(),
    setSelectedForBulk: vi.fn(),
    onBulkRemove: vi.fn(),
    visibleMessages: [PEER_MESSAGE, OWN_MESSAGE],
    nameOf: (userId: string) => (userId === ME_ID ? 'Tôi' : 'Bạn Học'),
    onRetrySend: vi.fn(),
    onDeleteMessage: vi.fn(),
    canRecall: () => false,
    onRecallMessage: vi.fn(),
    onHardDeleteMessage: vi.fn(),
    onUpdateConversationState: vi.fn(),
    people: {},
    loading: false,
    typingNames: [],
    draft: '',
    setDrafts: vi.fn(),
    onNoteTyping: vi.fn(),
    onSend: vi.fn(),
    sendError: null,
    sendInFlight: false,
    replyTarget: null,
    onStartReply: vi.fn(),
    onCancelReply: vi.fn(),
    onJumpToQuote: vi.fn(),
    highlightedMessageId: null,
    scrollerRef: { current: null },
    messageSearch: { query: '', results: [], loading: false, failed: false, submitted: false },
    onSearchMessages: vi.fn(),
    onClearMessageSearch: vi.fn(),
    onJumpToSearchResult: vi.fn(),
    memberPanel: null,
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <ChatPanel {...props} />
    </QueryClientProvider>,
  );
  return {
    props,
    rerender: (nextOverrides: Partial<Parameters<typeof ChatPanel>[0]> = {}) => {
      view.rerender(
        <QueryClientProvider client={createQueryClient()}>
          <ChatPanel {...props} {...nextOverrides} />
        </QueryClientProvider>,
      );
    },
  };
}

describe('ChatPanel — khung trò chuyện sau khi tách component con', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('hiển thị tiêu đề theo tên đối tác và nội dung các tin nhắn trong khung', () => {
    renderPanel();

    expect(screen.getByText('Bạn Học')).toBeInTheDocument();
    expect(screen.getByText('tin của bạn học')).toBeInTheDocument();
    expect(screen.getByText('tin của tôi')).toBeInTheDocument();
  });

  it('bấm nút trả lời trên bong bóng thì gọi onStartReply với đúng tin nhắn đó', async () => {
    const { props } = renderPanel();

    await userEvent.click(screen.getByTestId(`message-reply-${PEER_MESSAGE_ID}`));

    expect(props.onStartReply).toHaveBeenCalledTimes(1);
    expect(props.onStartReply).toHaveBeenCalledWith(PEER_MESSAGE);
  });

  it('hiện chip trả lời khi có replyTarget và bấm huỷ thì gọi onCancelReply', async () => {
    const { props } = renderPanel({ replyTarget: PEER_MESSAGE });

    expect(screen.getByTestId('reply-chip')).toHaveTextContent('Bạn Học');
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ trả lời' }));

    expect(props.onCancelReply).toHaveBeenCalledTimes(1);
  });

  it('gõ vào ô soạn thì cập nhật nháp của đúng cuộc trò chuyện và báo đang nhập', () => {
    const { props } = renderPanel();

    fireEvent.change(screen.getByLabelText('Nội dung tin nhắn'), { target: { value: 'xin chào' } });

    expect(props.setDrafts).toHaveBeenCalledTimes(1);
    const lastUpdater = vi.mocked(props.setDrafts).mock.calls.at(-1)![0] as (
      prev: Record<string, string>,
    ) => Record<string, string>;
    expect(lastUpdater({})).toEqual({ [CONV_ID]: 'xin chào' });
    expect(props.onNoteTyping).toHaveBeenCalled();
  });

  it('bấm gửi khi đã có nháp thì gọi onSend một lần', async () => {
    const { props } = renderPanel({ draft: 'xin chào' });

    await userEvent.click(screen.getByRole('button', { name: 'Gửi' }));

    expect(props.onSend).toHaveBeenCalledTimes(1);
  });

  it('bấm avatar ở đầu khung thì mở panel thông tin đối tác', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ displayName: 'Bạn Học', username: 'otheruser', email: 'other@example.com' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Thông tin cuộc trò chuyện' }));

    const aside = await screen.findByTestId('info-aside');
    expect(within(aside).getByTestId('partner-panel')).toBeInTheDocument();
    expect(within(aside).getByText('Bạn Học')).toBeInTheDocument();
    expect(await within(aside).findByText('other@example.com')).toBeInTheDocument();
  });

  it('chọn tìm kiếm trong menu đầu khung thì hiện ô tìm trong hội thoại', async () => {
    renderPanel();

    await userEvent.click(screen.getByTestId('header-actions'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Tìm trong cuộc trò chuyện' }));

    expect(screen.getByLabelText('Tìm trong cuộc trò chuyện')).toBeInTheDocument();
  });

  it('hiển thị khung tải khi chưa có cuộc trò chuyện và đang tải danh sách', () => {
    renderPanel({ active: null, loading: true, visibleMessages: [] });

    expect(screen.getByTestId('thread-loading')).toBeInTheDocument();
  });

  it('hiển thị lời mời chọn cuộc trò chuyện khi chưa có cuộc trò chuyện và không tải', () => {
    renderPanel({ active: null, loading: false, visibleMessages: [] });

    expect(screen.getByText('Chọn một cuộc hội thoại')).toBeInTheDocument();
    expect(screen.getByText('Chọn một cuộc hội thoại ở cột trái để đọc và trả lời.')).toBeInTheDocument();
  });

  it('chọn một tin để gỡ hàng loạt thì hiện thanh bulk với đúng số tin đã chọn và bấm gỡ thì gọi onBulkRemove', async () => {
    const { props, rerender } = renderPanel({ active: { ...ACTIVE, canModerate: true } });

    await userEvent.click(screen.getByTestId(`message-actions-${PEER_MESSAGE_ID}`));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Chọn tin để gỡ hàng loạt' }));

    expect(props.setSelectedForBulk).toHaveBeenCalledTimes(1);
    const updater = vi.mocked(props.setSelectedForBulk).mock.calls[0]![0] as (prev: Set<string>) => Set<string>;
    const selected = updater(new Set());
    expect(selected.has(PEER_MESSAGE_ID)).toBe(true);
    expect(selected.has(OWN_MESSAGE_ID)).toBe(false);

    rerender({ active: { ...ACTIVE, canModerate: true }, selectedForBulk: selected });
    expect(screen.getByText('Đã chọn 1 tin.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Gỡ hàng loạt đã chọn' }));
    expect(props.onBulkRemove).toHaveBeenCalledTimes(1);
  });

  it('bấm nút tải tin cũ hơn thì gọi onLoadOlder một lần', async () => {
    const { props } = renderPanel({ hasMoreBefore: true });

    await userEvent.click(screen.getByRole('button', { name: 'Tải tin nhắn cũ hơn' }));

    expect(props.onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it('tin được nhảy tới thì bong bóng của đúng tin đó hiện vòng highlight, tin khác thì không', () => {
    renderPanel({ highlightedMessageId: PEER_MESSAGE_ID });

    expect(screen.getByTestId(`message-bubble-${PEER_MESSAGE_ID}`)).toHaveClass('ring-2');
    expect(screen.getByTestId(`message-bubble-${OWN_MESSAGE_ID}`)).not.toHaveClass('ring-2');
  });

  it('chọn báo cáo trong menu đầu khung thì gọi onReportConversation một lần', async () => {
    const { props } = renderPanel();

    await userEvent.click(screen.getByTestId('header-actions'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Báo cáo cuộc trò chuyện' }));

    expect(props.onReportConversation).toHaveBeenCalledTimes(1);
  });

  it('chọn xem hồ sơ trong menu đầu khung thì mở panel thông tin đối tác', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ displayName: 'Bạn Học', username: 'otheruser', email: 'other@example.com' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    renderPanel();

    await userEvent.click(screen.getByTestId('header-actions'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Xem hồ sơ' }));

    expect(await screen.findByTestId('info-aside')).toBeInTheDocument();
  });

  it('bấm tắt tiếng, ghim và chặn trong panel thông tin thì gọi đúng handler với đúng cuộc trò chuyện và đối tác', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ displayName: 'Bạn Học', username: 'otheruser', email: 'other@example.com' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const { props } = renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Thông tin cuộc trò chuyện' }));
    const aside = await screen.findByTestId('info-aside');
    await userEvent.click(within(aside).getByRole('button', { name: 'Tắt tiếng' }));
    expect(props.onUpdateConversationState).toHaveBeenCalledWith(ACTIVE, { muted: true });
    await userEvent.click(within(aside).getByRole('button', { name: 'Ghim cuộc trò chuyện' }));
    expect(props.onUpdateConversationState).toHaveBeenCalledWith(ACTIVE, { pinned: true });
    await userEvent.click(within(aside).getByRole('button', { name: 'Chặn liên lạc' }));
    expect(props.onBlockContact).toHaveBeenCalledTimes(1);
    expect(props.onBlockContact).toHaveBeenCalledWith(OTHER_ID);
  });

  it('người có quyền thu hồi thì bấm thu hồi trên tin của mình gọi onRecallMessage với đúng tin đó', async () => {
    const { props } = renderPanel({ canRecall: () => true });

    await userEvent.click(screen.getByTestId(`message-actions-${OWN_MESSAGE_ID}`));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Thu hồi' }));

    expect(props.onRecallMessage).toHaveBeenCalledTimes(1);
    expect(props.onRecallMessage).toHaveBeenCalledWith(OWN_MESSAGE);
  });

  it('người không có quyền thu hồi thì menu tin của mình không có mục thu hồi', async () => {
    renderPanel();

    await userEvent.click(screen.getByTestId(`message-actions-${OWN_MESSAGE_ID}`));

    expect(await screen.findByRole('menuitem', { name: 'Xoá tin nhắn' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Thu hồi' })).not.toBeInTheDocument();
  });

  it('bấm xoá trên tin của mình thì gọi onDeleteMessage với đúng tin đó', async () => {
    const { props } = renderPanel();

    await userEvent.click(screen.getByTestId(`message-actions-${OWN_MESSAGE_ID}`));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Xoá tin nhắn' }));

    expect(props.onDeleteMessage).toHaveBeenCalledTimes(1);
    expect(props.onDeleteMessage).toHaveBeenCalledWith(OWN_MESSAGE);
  });

  it('tin của đối tác thì không có nút thao tác khác để xoá hay thu hồi', () => {
    renderPanel();

    expect(screen.queryByTestId(`message-actions-${PEER_MESSAGE_ID}`)).not.toBeInTheDocument();
  });

  it('người kiểm duyệt bấm xoá cứng trên tin thì gọi onHardDeleteMessage với đúng tin đó', async () => {
    const { props } = renderPanel({ active: { ...ACTIVE, canModerate: true } });

    await userEvent.click(screen.getByTestId(`message-actions-${PEER_MESSAGE_ID}`));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Xoá cứng (kiểm duyệt)' }));

    expect(props.onHardDeleteMessage).toHaveBeenCalledTimes(1);
    expect(props.onHardDeleteMessage).toHaveBeenCalledWith(PEER_MESSAGE);
  });

  it('người không kiểm duyệt thì menu tin không có mục xoá cứng', async () => {
    renderPanel();

    await userEvent.click(screen.getByTestId(`message-actions-${OWN_MESSAGE_ID}`));

    expect(await screen.findByRole('menuitem', { name: 'Xoá tin nhắn' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Xoá cứng (kiểm duyệt)' })).not.toBeInTheDocument();
  });

  it('chọn chặn trong menu đầu khung thì gọi onBlockContact với đúng đối tác', async () => {
    const { props } = renderPanel();

    await userEvent.click(screen.getByTestId('header-actions'));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Chặn liên lạc / }));

    expect(props.onBlockContact).toHaveBeenCalledTimes(1);
    expect(props.onBlockContact).toHaveBeenCalledWith(OTHER_ID);
  });

  it('đối tác đã bị chặn thì menu đầu khung hiện bỏ chặn thay vì chặn và bấm thì gọi onUnblockContact', async () => {
    const { props } = renderPanel({ blocked: [OTHER_ID] });

    await userEvent.click(screen.getByTestId('header-actions'));
    expect(screen.queryByRole('menuitem', { name: /^Chặn liên lạc / })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Bỏ chặn / }));

    expect(props.onUnblockContact).toHaveBeenCalledTimes(1);
    expect(props.onUnblockContact).toHaveBeenCalledWith(OTHER_ID);
  });

  it('người quản lý chọn tắt chat trong menu đầu khung thì gọi onToggleChat một lần', async () => {
    const { props } = renderPanel({ active: { ...ACTIVE, canManage: true } });

    await userEvent.click(screen.getByTestId('header-actions'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Tắt chat' }));

    expect(props.onToggleChat).toHaveBeenCalledTimes(1);
  });

  it('người không quản lý thì menu đầu khung không có mục tắt hay bật chat', async () => {
    renderPanel();

    await userEvent.click(screen.getByTestId('header-actions'));

    expect(screen.queryByRole('menuitem', { name: 'Tắt chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Bật chat' })).not.toBeInTheDocument();
  });

  it('nút gọi thoại và gọi video ở đầu khung đang bị tắt', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'Gọi thoại' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gọi video' })).toBeDisabled();
  });

  it('nhập từ khoá rồi bấm tìm thì gọi onSearchMessages với đúng từ khoá', async () => {
    const { props } = renderPanel();

    await userEvent.click(screen.getByTestId('header-actions'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Tìm trong cuộc trò chuyện' }));
    await userEvent.type(screen.getByLabelText('Tìm trong cuộc trò chuyện'), 'xin chào');
    await userEvent.click(screen.getByRole('button', { name: 'Tìm' }));

    expect(props.onSearchMessages).toHaveBeenCalledTimes(1);
    expect(props.onSearchMessages).toHaveBeenCalledWith('xin chào');
  });
});
