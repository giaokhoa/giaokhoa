import { cleanup, render, screen, within } from '@testing-library/react';
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
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ChatPanel {...props} />
    </QueryClientProvider>,
  );
  return props;
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
    const props = renderPanel();

    await userEvent.click(screen.getByTestId(`message-reply-${PEER_MESSAGE_ID}`));

    expect(props.onStartReply).toHaveBeenCalledTimes(1);
    expect(props.onStartReply).toHaveBeenCalledWith(PEER_MESSAGE);
  });

  it('hiện chip trả lời khi có replyTarget và bấm huỷ thì gọi onCancelReply', async () => {
    const props = renderPanel({ replyTarget: PEER_MESSAGE });

    expect(screen.getByTestId('reply-chip')).toHaveTextContent('Bạn Học');
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ trả lời' }));

    expect(props.onCancelReply).toHaveBeenCalledTimes(1);
  });

  it('gõ vào ô soạn thì cập nhật nháp của đúng cuộc trò chuyện và báo đang nhập', async () => {
    const props = renderPanel();

    await userEvent.type(screen.getByLabelText('Nội dung tin nhắn'), 'xin chào');

    expect(props.setDrafts).toHaveBeenCalled();
    expect(props.onNoteTyping).toHaveBeenCalled();
  });

  it('bấm gửi khi đã có nháp thì gọi onSend một lần', async () => {
    const props = renderPanel({ draft: 'xin chào' });

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
});
