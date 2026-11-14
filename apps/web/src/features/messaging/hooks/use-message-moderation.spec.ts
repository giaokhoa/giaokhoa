import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '#config/i18n';
import { RECALL_WINDOW_MINUTES, useMessageModeration } from './use-message-moderation';
import type { ConversationView, MessageView } from '../types/types';

const ME_ID = '01900000-0000-7000-8000-0000000000a1';
const OTHER_ID = '01900000-0000-7000-8000-0000000000b2';
const CONV_ID = '01900000-0000-7000-8000-0000000000c3';
const PEER_MESSAGE_ID = '01900000-0000-7000-8000-0000000000e5';
const OWN_MESSAGE_ID = '01900000-0000-7000-8000-0000000000e6';

const queryMocks = vi.hoisted(() => ({
  deleteMutate: vi.fn(async () => ({ deletedAt: '2026-01-01T00:02:00.000Z', deletedBy: '01900000-0000-7000-8000-0000000000a1' })),
  recallMutate: vi.fn(async () => ({ recalledAt: '2026-01-01T00:02:00.000Z', recalledBy: '01900000-0000-7000-8000-0000000000a1' })),
  hardDeleteMutate: vi.fn(async () => undefined),
  bulkRemoveMutate: vi.fn(async () => undefined),
}));

vi.mock('../queries/messaging', () => ({
  useDeleteMessageForMe: () => ({ mutateAsync: queryMocks.deleteMutate }),
  useRecallMessage: () => ({ mutateAsync: queryMocks.recallMutate }),
  useHardDeleteMessage: () => ({ mutateAsync: queryMocks.hardDeleteMutate }),
  useBulkRemoveMessages: () => ({ mutateAsync: queryMocks.bulkRemoveMutate }),
}));

const ACTIVE: ConversationView = {
  id: CONV_ID,
  type: 1,
  name: null,
  members: [ME_ID, OTHER_ID],
  canModerate: false,
};

function message(overrides: Partial<MessageView> = {}): MessageView {
  return {
    id: OWN_MESSAGE_ID,
    conversationId: CONV_ID,
    userIdFrom: ME_ID,
    fullMessage: 'tin của tôi',
    createdAt: new Date().toISOString(),
    seq: 2,
    clientMessageId: null,
    ...overrides,
  };
}

function renderModeration(active: ConversationView | null = ACTIVE) {
  const patchMessages = vi.fn();
  const setActionMessage = vi.fn();
  const hook = renderHook(() =>
    useMessageModeration({ active, myId: ME_ID, patchMessages, setActionMessage }),
  );
  return { ...hook, patchMessages, setActionMessage };
}

describe('useMessageModeration — cổng thu hồi và guard kiểm duyệt', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('tin của đối tác thì không thu hồi được dù còn trong cửa sổ', () => {
    const { result } = renderModeration();

    expect(result.current.canRecall(message({ id: PEER_MESSAGE_ID, userIdFrom: OTHER_ID }))).toBe(false);
  });

  it('tin của mình đã quá 15 phút thì không thu hồi được', () => {
    const { result } = renderModeration();

    expect(
      result.current.canRecall(message({ createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString() })),
    ).toBe(false);
  });

  it('tin của mình trong cửa sổ 15 phút thì thu hồi được', () => {
    const { result } = renderModeration();

    expect(result.current.canRecall(message())).toBe(true);
  });

  it('cửa sổ thu hồi 15 phút phải giữ đồng bộ với giá trị mặc định của site config messagingrecallwindowminutes, server mới là nguồn sự thật', () => {
    expect(RECALL_WINDOW_MINUTES).toBe(15);
  });

  it('gọi thu hồi tin của đối tác thì không gọi API thu hồi', async () => {
    const { result } = renderModeration();

    await act(async () => {
      await result.current.recallMessage(message({ id: PEER_MESSAGE_ID, userIdFrom: OTHER_ID }));
    });

    expect(queryMocks.recallMutate).not.toHaveBeenCalled();
  });

  it('tin của mình trong cửa sổ thì gọi thu hồi gọi API và cập nhật tin đã thu hồi', async () => {
    const { result, patchMessages } = renderModeration();

    await act(async () => {
      await result.current.recallMessage(message());
    });

    expect(queryMocks.recallMutate).toHaveBeenCalledTimes(1);
    expect(queryMocks.recallMutate).toHaveBeenCalledWith(OWN_MESSAGE_ID);
    expect(patchMessages).toHaveBeenCalledTimes(1);
  });

  it('người không kiểm duyệt gọi xoá cứng thì không gọi API xoá cứng', async () => {
    const { result } = renderModeration();

    await act(async () => {
      await result.current.hardDeleteMessage(message({ id: PEER_MESSAGE_ID, userIdFrom: OTHER_ID }));
    });

    expect(queryMocks.hardDeleteMutate).not.toHaveBeenCalled();
  });

  it('người không kiểm duyệt gọi gỡ hàng loạt đã chọn thì không gọi API gỡ hàng loạt', async () => {
    const { result } = renderModeration();
    act(() => {
      result.current.setSelectedForBulk(new Set([PEER_MESSAGE_ID]));
    });

    await act(async () => {
      await result.current.bulkRemoveSelected();
    });

    expect(queryMocks.bulkRemoveMutate).not.toHaveBeenCalled();
  });
});
