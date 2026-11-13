import { beforeEach, describe, expect, it } from 'vitest';
import { readStoredMessagesTab, storeMessagesTab, withConversationMovedToSectionTop } from './page-helpers';
import type { ConversationView } from '../types/types';

const TAB_KEY = 'giaokhoa.messages.tab';

describe('Lưu bền tab khung trái Tin nhắn', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('về tab Tất cả khi chưa từng lưu tab nào', () => {
    expect(readStoredMessagesTab()).toBe('all');
  });

  it('giữ nguyên từng giá trị hợp lệ của thanh tab hiện hành: all, unread, groups, archived', () => {
    for (const tab of ['all', 'unread', 'groups', 'archived']) {
      window.localStorage.setItem(TAB_KEY, tab);
      expect(readStoredMessagesTab()).toBe(tab);
    }
  });

  it('giá trị lưu cũ "chats" của cấu trúc hai tab rơi về tab Tất cả', () => {
    window.localStorage.setItem(TAB_KEY, 'chats');
    expect(readStoredMessagesTab()).toBe('all');
  });

  it('giá trị lưu "favourites" của tab Yêu thích đã bỏ ở issue #623 rơi về tab Tất cả', () => {
    window.localStorage.setItem(TAB_KEY, 'favourites');
    expect(readStoredMessagesTab()).toBe('all');
  });

  it('giá trị lạ không thuộc tập tab nào cũng rơi về tab Tất cả', () => {
    window.localStorage.setItem(TAB_KEY, 'khong-ton-tai');
    expect(readStoredMessagesTab()).toBe('all');
  });

  it('ghi tab bằng storeMessagesTab thì đọc lại đúng tab đó', () => {
    storeMessagesTab('groups');
    expect(window.localStorage.getItem(TAB_KEY)).toBe('groups');
    expect(readStoredMessagesTab()).toBe('groups');
  });
});

function conv(id: string, pinnedAt: string | null, lastMessageSeq: number): ConversationView {
  return { id, type: 1, name: id, members: [], pinnedAt, archivedAt: '2026-01-02T00:00:00.000Z', muted: false, lastMessageSeq };
}

describe('Dời hội thoại lên đầu phân mục của nó', () => {
  it('hội thoại chưa ghim có hoạt động mới thì lên đầu mục Gần đây, đứng sau mọi hội thoại đã ghim', () => {
    const list = [conv('ghim', '2026-01-01T00:00:00.000Z', 3), conv('a', null, 9), conv('b', null, 5)];
    const next = withConversationMovedToSectionTop(list, 'b', (c) => ({ ...c, lastMessageSeq: 12 }));
    expect(next.map((c) => c.id)).toEqual(['ghim', 'b', 'a']);
    expect(next[1]!.lastMessageSeq).toBe(12);
  });

  it('hội thoại đã ghim có hoạt động mới thì lên đầu toàn danh sách (đầu mục Ghim)', () => {
    const list = [conv('ghim-1', '2026-01-01T00:00:00.000Z', 3), conv('ghim-2', '2026-01-01T01:00:00.000Z', 8), conv('a', null, 9)];
    const next = withConversationMovedToSectionTop(list, 'ghim-2', (c) => ({ ...c, lastMessageSeq: 12 }));
    expect(next.map((c) => c.id)).toEqual(['ghim-2', 'ghim-1', 'a']);
  });

  it('danh sách không có hội thoại đích thì trả nguyên danh sách cùng tham chiếu', () => {
    const list = [conv('a', null, 1), conv('b', null, 2)];
    expect(withConversationMovedToSectionTop(list, 'vắng', (c) => c)).toBe(list);
  });
});
