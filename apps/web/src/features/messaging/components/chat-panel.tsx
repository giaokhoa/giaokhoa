import { useEffect, useState, type Dispatch, type FormEvent, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import { cn } from '@giaokhoa/ui/lib/utils';
import { Input } from '@giaokhoa/ui/components/input';
import { Skeleton } from '@giaokhoa/ui/components/skeleton';
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem,
  MessageScrollerProvider, MessageScrollerViewport, useMessageScroller,
} from '@giaokhoa/ui/components/message-scroller';
import { useTranslation } from 'react-i18next';

import { formatWithOptions } from '#utils/date-format';
import { useComposerActions } from '../utils/composer-actions';
import { getPersonProfile, getSharedFiles } from '../api/person-profile-adapter';
import { messagingPersonProfileQueryOptions } from '../queries/messaging';
import type { ConversationStatePatch, ConversationView, MessageQuoteView, MessageSearchResultView, MessageView, PersonSummary, ScrollerHandle } from '../types/types';
import { MemberProfileSheet, useMemberProfile, type MemberPanelBundle } from './member-panel';
import { ChatMessageItem } from './chat-message-item';
import { ChatHeader } from './chat-header';
import { ChatComposer } from './chat-composer';
import { ChatInfoAside } from './chat-info-aside';
import {
  initialsOf, presenceLabelKey, presenceStatusOf,
} from '../utils/utils';


function ScrollerBridge({ bridgeRef }: { bridgeRef: RefObject<ScrollerHandle | null> }) {
  const scroller = useMessageScroller();
  useEffect(() => {
    bridgeRef.current = scroller;
    return () => { bridgeRef.current = null; };
  }, [scroller, bridgeRef]);
  return null;
}

interface ChatPanelProps {
  active: ConversationView | null;
  myId: string | undefined;
  onlineUsers: Record<string, boolean>;
  readMarkers: Record<string, number>;
  onBack: () => void;
  blocked: string[];
  onUnblockContact: (userId: string) => void;
  onBlockContact: (userId: string) => void;
  onReportConversation: () => void;
  onToggleChat: () => void;
  reportMessage: string | null;
  actionMessage: string | null;
  hasMoreBefore: boolean;
  onLoadOlder: () => void;
  selectedForBulk: Set<string>;
  setSelectedForBulk: Dispatch<SetStateAction<Set<string>>>;
  onBulkRemove: () => void;
  visibleMessages: MessageView[];
  nameOf: (userId: string) => string;
  onRetrySend: (message: MessageView) => void;
  onDeleteMessage: (message: MessageView) => void;
  canRecall: (message: MessageView) => boolean;
  onRecallMessage: (message: MessageView) => void;
  onHardDeleteMessage: (message: MessageView) => void;
  onUpdateConversationState: (conversation: ConversationView, patch: ConversationStatePatch) => void;
  people: Record<string, PersonSummary>;
  loading?: boolean;
  typingNames: string[];
  draft: string;
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  onNoteTyping: () => void;
  onSend: (event: FormEvent) => void;
  sendError: string | null;
  sendInFlight: boolean;
  replyTarget: MessageView | null;
  onStartReply: (message: MessageView) => void;
  onCancelReply: () => void;
  onJumpToQuote: (quote: MessageQuoteView) => void;
  highlightedMessageId: string | null;
  scrollerRef: RefObject<ScrollerHandle | null>;
  messageSearch: {
    query: string;
    results: MessageSearchResultView[];
    loading: boolean;
    failed: boolean;
    submitted: boolean;
  };
  onSearchMessages: (query: string) => void;
  onClearMessageSearch: () => void;
  onJumpToSearchResult: (result: MessageSearchResultView) => void;
  memberPanel: MemberPanelBundle | null;
}

export function ChatPanel({
  active, myId, onlineUsers, readMarkers, onBack, blocked, onUnblockContact, onBlockContact, onReportConversation,
  onToggleChat, reportMessage, actionMessage, hasMoreBefore, onLoadOlder, selectedForBulk,
  setSelectedForBulk, onBulkRemove, visibleMessages, nameOf, onRetrySend, onDeleteMessage,
  canRecall, onRecallMessage, onHardDeleteMessage, onUpdateConversationState, people, loading, typingNames, draft,
  setDrafts, onNoteTyping, onSend, sendError, sendInFlight,
  replyTarget, onStartReply, onCancelReply, onJumpToQuote, highlightedMessageId, scrollerRef,
  messageSearch, onSearchMessages, onClearMessageSearch, onJumpToSearchResult, memberPanel,
}: ChatPanelProps) {
  const { t, i18n } = useTranslation('app');
  const [today] = useState(() => new Date());
  const unblockContact = onUnblockContact;
  const blockContact = onBlockContact;
  const reportActiveConversation = onReportConversation;
  const toggleActiveChat = onToggleChat;
  const loadOlder = onLoadOlder;
  const bulkRemoveSelected = onBulkRemove;
  const retrySend = onRetrySend;
  const deleteMessage = onDeleteMessage;
  const recallMessage = onRecallMessage;
  const hardDeleteMessage = onHardDeleteMessage;
  const noteTyping = onNoteTyping;
  const send = onSend;
  const [searchDraft, setSearchDraft] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [noteEmojiOpen, setNoteEmojiOpen] = useState(false);
  const [composerTab, setComposerTab] = useState<'reply' | 'note'>('reply');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const noteDraft = active ? noteDrafts[active.id] ?? '' : '';
  const [noteNoticeFor, setNoteNoticeFor] = useState<string | null>(null);

  const sendNote = (event: FormEvent) => {
    event.preventDefault();
    if (!active) return;
    if (!noteDraft.trim()) return;
    setNoteDrafts((prev) => ({ ...prev, [active.id]: '' }));
    setNoteNoticeFor(active.id);
  };
  useEffect(() => {
    if (!noteNoticeFor) return;
    const timer = setTimeout(() => setNoteNoticeFor(null), 4000);
    return () => clearTimeout(timer);
  }, [noteNoticeFor]);
  const memberProfile = useMemberProfile();
  const { composerRef, applyBold, insertLink, insertEmojiAtCursor } = useComposerActions({
    draft,
    conversationId: active?.id,
    onReplace: (nextDraft) => {
      if (!active) return;
      setDrafts((previous) => ({ ...previous, [active.id]: nextDraft }));
      onNoteTyping();
    },
    onEmojiInserted: () => setEmojiOpen(false),
    promptForLink: () => window.prompt(t('insertLinkPrompt')),
  });
  const {
    composerRef: noteComposerRef,
    applyBold: applyNoteBold,
    insertLink: insertNoteLink,
    insertEmojiAtCursor: insertNoteEmojiAtCursor,
  } = useComposerActions({
    draft: noteDraft,
    conversationId: active?.id,
    onReplace: (nextDraft) => {
      if (!active) return;
      setNoteDrafts((previous) => ({ ...previous, [active.id]: nextDraft }));
    },
    onEmojiInserted: () => setNoteEmojiOpen(false),
    promptForLink: () => window.prompt(t('insertLinkPrompt')),
  });

  const panelPartnerId = active && active.type !== 2
    ? active.members.find((memberId) => memberId !== myId)
    : undefined;
  const personProfileQuery = useQuery({
    ...messagingPersonProfileQueryOptions(panelPartnerId ?? ''),
    enabled: panelPartnerId !== undefined && infoOpen,
  });
  const conversationKey = active?.id;
  const [previousConversationKey, setPreviousConversationKey] = useState(conversationKey);
  if (conversationKey !== previousConversationKey) {
    setPreviousConversationKey(conversationKey);
    setSearchOpen(false);
    setInfoOpen(false);
    setEmojiOpen(false);
    setNoteEmojiOpen(false);
    setSearchDraft('');
    setNoteNoticeFor(null);
  }

  if (!active) {
    if (loading) {
      return (
        <div data-testid="thread-loading" className="flex min-h-0 flex-1 flex-col" aria-label={t('conversationsLoading')}>
          <div className="flex items-center gap-3 border-b px-3 py-2">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <div className="flex-1 space-y-4 p-4">
            <Skeleton className="h-10 w-1/2 rounded-xl" />
            <Skeleton className="ml-auto h-10 w-2/5 rounded-xl" />
            <Skeleton className="h-10 w-3/5 rounded-xl" />
          </div>
          <div className="border-t px-3 py-2">
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
        <MessageSquare className="size-12 text-muted-foreground/30" aria-hidden />
        <p className="text-sm font-medium text-muted-foreground">{t('selectConversation')}</p>
        <p className="text-xs text-muted-foreground/70">{t('pickConversation')}</p>
      </div>
    );
  }

  const others = active.members.filter((memberId) => memberId !== myId);
  const isGroup = active.type === 2;
  const otherId = !isGroup ? others[0] : undefined;
  const otherPresence = otherId ? onlineUsers[otherId] : undefined;
  const otherStatus = presenceStatusOf(otherPresence);
  const title = active.name !== null
    ? active.name
    : otherId
      ? nameOf(otherId)
      : t('conversationWithUser', { members: active.members.map((id) => nameOf(id)).join(', ') });
  const avatarLabel = active.name ?? (otherId ? nameOf(otherId) : title);
  const subtitle = typingNames.length > 0
    ? t('typingIndicator', { userId: nameOf(typingNames[0]!) })
    : isGroup
      ? t('conversationMembersCount', { count: active.members.length })
      : otherStatus !== undefined
        ? t(presenceLabelKey(otherStatus))
        : '';
  const newestSeq = visibleMessages.reduce((max, m) => Math.max(max, m.seq), 0) || active.lastMessageSeq || 0;
  const panelEntryById = new Map((memberPanel?.entries ?? []).map((entry) => [entry.userId, entry]));
  const memberPanelBundle: MemberPanelBundle | null = memberPanel
    ? {
      ...memberPanel,
      blockedIds: new Set(blocked),
      onBlockContact: blockContact,
      onUnblockContact: unblockContact,
    }
    : null;
  const seenThroughSeq = others.length > 0
    ? Math.min(...others.map((memberId) => readMarkers[memberId] ?? 0))
    : 0;

  const dayKeyOf = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const dayLabelOf = (iso: string) => {
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfDay(today) - startOfDay(new Date(iso))) / 86_400_000);
    if (diffDays <= 0) return t('messagesToday');
    if (diffDays === 1) return t('messagesYesterday');
    return formatWithOptions(iso, i18n.language, { month: 'short', day: 'numeric' });
  };
  const threadItems: ReactNode[] = [];
  let lastDayKey = '';
  let prevMessage: MessageView | null = null;
  for (const m of visibleMessages) {
    const dayKey = dayKeyOf(m.createdAt);
    const isFirstDay = lastDayKey === '';
    if (dayKey !== lastDayKey) {
      lastDayKey = dayKey;
      threadItems.push(
        <div key={`day-${dayKey}`} className={cn('flex justify-center', !isFirstDay && 'mt-6')}>
          <Badge variant="ghost" className="h-5 px-2 py-0.5 font-normal text-muted-foreground hover:bg-transparent">
            {dayLabelOf(m.createdAt)}
          </Badge>
        </div>,
      );
    }
    const firstOfCluster = !prevMessage || prevMessage.userIdFrom !== m.userIdFrom || dayKeyOf(prevMessage.createdAt) !== dayKey;
    prevMessage = m;
    const mine = m.userIdFrom === myId;
    const authorEntry = isGroup && !mine ? panelEntryById.get(m.userIdFrom) : undefined;
    threadItems.push(
      <MessageScrollerItem
        key={m.id}
        messageId={m.id}
        scrollAnchor={mine}
        className={firstOfCluster ? 'mt-4' : 'mt-1'}
      >
        <ChatMessageItem
          message={m}
          firstOfCluster={firstOfCluster}
          highlighted={m.id === highlightedMessageId}
          isGroup={isGroup}
          canModerate={Boolean(active.canModerate)}
          canManage={Boolean(active.canManage)}
          myId={myId}
          nameOf={nameOf}
          seenThroughSeq={seenThroughSeq}
          authorEntry={authorEntry}
          memberPanel={memberPanel}
          blocked={blocked}
          selectedForBulk={selectedForBulk}
          setSelectedForBulk={setSelectedForBulk}
          onStartReply={onStartReply}
          onJumpToQuote={onJumpToQuote}
          onRetrySend={retrySend}
          onDeleteMessage={deleteMessage}
          canRecall={canRecall}
          onRecallMessage={recallMessage}
          onHardDeleteMessage={hardDeleteMessage}
          onViewProfile={memberProfile.open}
          onBlockContact={blockContact}
          onUnblockContact={unblockContact}
        />
      </MessageScrollerItem>,
    );
  }
  if (typingNames.length > 0) {
    const firstTyper = typingNames[0]!;
    const lastMessage = visibleMessages[visibleMessages.length - 1];
    threadItems.push(
      <div
        key="typing-indicator"
        data-testid="typing-indicator"
        className={cn(
          'flex items-end gap-2',
          lastMessage && lastMessage.userIdFrom !== myId ? 'mt-1' : 'mt-4',
        )}
      >
        <Avatar>
          <AvatarFallback className="bg-muted text-foreground">{initialsOf(nameOf(firstTyper))}</AvatarFallback>
        </Avatar>
        <div className="flex items-center gap-1 rounded-xl bg-muted px-4 py-3" aria-hidden>
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
        </div>
        <span className="sr-only">{t('typingIndicator', { userId: nameOf(firstTyper) })}</span>
      </div>,
    );
  }

  const showInfoAside = infoOpen && ((isGroup && memberPanelBundle !== null) || (!isGroup && otherId !== undefined));
  const serverPersonProfile = personProfileQuery.data;
  const partnerProfile = !isGroup && otherId
    ? {
        ...getPersonProfile({
          userId: otherId,
          displayName: nameOf(otherId),
          username: people[otherId]?.username ?? '',
        }),
        ...(serverPersonProfile
          ? {
              displayName: serverPersonProfile.displayName,
              username: serverPersonProfile.username,
              email: serverPersonProfile.email,
            }
          : {}),
      }
    : null;
  const sharedFiles = getSharedFiles(active.id);

  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <ChatHeader
        active={active}
        title={title}
        subtitle={subtitle}
        avatarLabel={avatarLabel}
        otherStatus={otherStatus}
        isGroup={isGroup}
        otherId={otherId}
        blocked={blocked}
        searchOpen={searchOpen}
        infoOpen={infoOpen}
        nameOf={nameOf}
        onBack={onBack}
        onToggleInfo={() => setInfoOpen((prev) => !prev)}
        onOpenInfo={() => setInfoOpen(true)}
        onToggleSearch={() => setSearchOpen((prev) => !prev)}
        onUpdateConversationState={onUpdateConversationState}
        onReportConversation={reportActiveConversation}
        onToggleChat={toggleActiveChat}
        onBlockContact={blockContact}
        onUnblockContact={unblockContact}
      />
      {(!isGroup && otherId && blocked.includes(otherId)) || reportMessage || actionMessage ? (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          {!isGroup && otherId && blocked.includes(otherId) ? (
            <p className="text-sm">
              {nameOf(otherId)} {t('blockedSuffix')}
            </p>
          ) : null}
          {reportMessage ? <p role="status">{reportMessage}</p> : null}
          {actionMessage ? <p role="alert">{actionMessage}</p> : null}
        </div>
      ) : null}
      <MemberProfileSheet
        entry={memberProfile.entry}
        contextName={memberPanel?.context.name ?? title}
        online={memberProfile.entry ? Boolean(onlineUsers[memberProfile.entry.userId]) : false}
        onClose={memberProfile.close}
      />
      {searchOpen ? (
        <div className="space-y-2 border-b px-3 py-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onSearchMessages(searchDraft);
            }}
          >
            <Input
              type="search"
              aria-label={t('messageSearchLabel')}
              placeholder={t('messageSearchPlaceholder')}
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
            />
            <Button type="submit" variant="outline">{t('messageSearchButton')}</Button>
            {messageSearch.submitted ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSearchDraft('');
                  onClearMessageSearch();
                }}
              >
                {t('messageSearchClear')}
              </Button>
            ) : null}
          </form>
          {messageSearch.loading ? (
            <p className="text-sm text-muted-foreground">{t('messageSearchLoading')}</p>
          ) : null}
          {messageSearch.failed ? (
            <p role="alert" className="text-sm">{t('messageSearchFailed')}</p>
          ) : null}
          {messageSearch.submitted && !messageSearch.loading && !messageSearch.failed
            && messageSearch.results.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('messageSearchNoResults')}</p>
            ) : null}
          {messageSearch.results.length > 0 ? (
            <ul className="space-y-1">
              {messageSearch.results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    data-testid={`search-result-${r.id}`}
                    className="w-full rounded-md border px-2 py-1 text-left hover:bg-muted"
                    onClick={() => onJumpToSearchResult(r)}
                  >
                    <span className="block text-xs font-medium">{nameOf(r.userIdFrom)}</span>
                    <span className="block truncate text-sm">{r.excerpt}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {hasMoreBefore ? (
        <div className="px-3 pt-2">
          <Button type="button" variant="outline" onClick={() => void loadOlder()}>
            {t('loadOlderMessages')}
          </Button>
        </div>
      ) : null}
      {active.canModerate && selectedForBulk.size > 0 ? (
        <div className="flex items-center gap-2 px-3 pt-2">
          <span className="text-sm text-muted-foreground">{t('bulkSelectedCount', { count: selectedForBulk.size })}</span>
          <Button type="button" variant="destructive" onClick={() => void bulkRemoveSelected()}>
            {t('bulkRemoveMessages')}
          </Button>
        </div>
      ) : null}
      <MessageScrollerProvider key={active.id} autoScroll defaultScrollPosition="end">
        <ScrollerBridge bridgeRef={scrollerRef} />
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label={t('messagesListLabel')}>
            <MessageScrollerContent className="gap-0 px-2 py-8">
              {threadItems}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <ChatComposer
        active={active}
        draft={draft}
        noteDraft={noteDraft}
        composerTab={composerTab}
        onComposerTabChange={(value) => {
          setComposerTab(value);
          setNoteNoticeFor(null);
        }}
        replyTarget={replyTarget}
        onCancelReply={onCancelReply}
        nameOf={nameOf}
        sendError={sendError}
        sendInFlight={sendInFlight}
        noteNoticeFor={noteNoticeFor}
        onSend={send}
        onSendNote={sendNote}
        onDraftChange={(value) => {
          setDrafts((prev) => ({ ...prev, [active.id]: value }));
          noteTyping();
        }}
        onNoteDraftChange={(value) => {
          setNoteDrafts((prev) => ({ ...prev, [active.id]: value }));
          setNoteNoticeFor(null);
        }}
        replyComposerRef={composerRef}
        onApplyReplyBold={applyBold}
        onInsertReplyLink={insertLink}
        onInsertReplyEmoji={insertEmojiAtCursor}
        noteComposerRef={noteComposerRef}
        onApplyNoteBold={applyNoteBold}
        onInsertNoteLink={insertNoteLink}
        onInsertNoteEmoji={insertNoteEmojiAtCursor}
        emojiOpen={emojiOpen}
        onEmojiOpenChange={setEmojiOpen}
        noteEmojiOpen={noteEmojiOpen}
        onNoteEmojiOpenChange={setNoteEmojiOpen}
      />
      </div>
      {showInfoAside ? (
        <ChatInfoAside
          active={active}
          isGroup={isGroup}
          otherId={otherId}
          title={title}
          avatarLabel={avatarLabel}
          otherStatus={otherStatus}
          blocked={blocked}
          memberPanelBundle={memberPanelBundle}
          newestSeq={newestSeq}
          myId={myId}
          onlineUsers={onlineUsers}
          readMarkers={readMarkers}
          partnerProfile={partnerProfile}
          sharedFiles={sharedFiles}
          nameOf={nameOf}
          onCloseInfo={() => setInfoOpen(false)}
          onUpdateConversationState={onUpdateConversationState}
          onBlockContact={blockContact}
          onUnblockContact={unblockContact}
          onViewProfile={memberProfile.open}
        />
      ) : null}
    </div>
  );
}
