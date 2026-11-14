import { useEffect, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type RefObject, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bell, BellOff, Building2, Check, CheckCheck, ChevronLeft, Clock, Ellipsis, EllipsisVertical,
  Eraser, FileText, Flag, Globe, Link2, Mail, MapPin, MessageSquare, MessagesSquare, Paperclip,
  Phone, Pin, PinOff, Reply, Send, Smile, SmilePlus, Sparkles, Trash, Undo2, Video, X,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Bubble, BubbleContent } from '@giaokhoa/ui/components/bubble';
import { Button } from '@giaokhoa/ui/components/button';
import { cn } from '@giaokhoa/ui/lib/utils';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@giaokhoa/ui/components/dropdown-menu';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@giaokhoa/ui/components/popover';
import { Input } from '@giaokhoa/ui/components/input';
import { Separator } from '@giaokhoa/ui/components/separator';
import { Skeleton } from '@giaokhoa/ui/components/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@giaokhoa/ui/components/tabs';
import { Textarea } from '@giaokhoa/ui/components/textarea';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@giaokhoa/ui/components/tooltip';
import {
  Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader,
} from '@giaokhoa/ui/components/message';
import {
  MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem,
  MessageScrollerProvider, MessageScrollerViewport, useMessageScroller,
} from '@giaokhoa/ui/components/message-scroller';
import { useTranslation } from 'react-i18next';

import { formatWithOptions } from '#utils/date-format';
import { useComposerActions } from '../utils/composer-actions';
import { getPersonProfile, getSharedFiles, QUICK_REPLY_SHAPE_SAMPLES } from '../api/person-profile-adapter';
import { messagingPersonProfileQueryOptions } from '../queries/messaging';
import type { ConversationStatePatch, ConversationView, MessageQuoteView, MessageSearchResultView, MessageView, PersonSummary, ScrollerHandle } from '../types/types';
import { FileCard } from './file-card';
import { MemberActionMenu, MemberPanel, MemberProfileSheet, useMemberProfile, type MemberPanelBundle } from './member-panel';
import {
  CHAT_MENU_CONTENT_CLASS, CHAT_MENU_ITEM_CLASS, PRESENCE_DOT_CLASS, initialsOf,
  presenceLabelKey, presenceStatusOf, quoteExcerptOfText,
} from '../utils/utils';

function RichMessageText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, index) => {
        if (!part) return null;
        if (/^\*\*[^*]+\*\*$/.test(part)) {
          return (
            <strong key={index} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        if (link && /^(?:https?:\/\/|mailto:)/i.test(link[2]!)) {
          return (
            <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer" className="underline">
              {link[1]}
            </a>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

const EMOJI_GRID_OPTIONS = [
  '😀', '😂', '😊', '😍', '🥳',
  '👍', '👏', '🙏', '❤️', '🔥',
  '✅', '👋', '🎉', '💯', '🤔',
  '😅', '🙌', '💪', '✨', '🚀',
];

const REACTION_SHAPE_EMOJIS = ['❤️', '😂', '😮', '😢', '👍'];

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
  const lastBubbleTapRef = useRef<{ messageId: string; at: number; x: number; y: number } | null>(null);
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
    const seenByOthers = mine && !m.localStatus && m.seq > 0 && m.seq <= seenThroughSeq;
    const hasOwnStatusNote = Boolean(m.deletedAt || m.recalledAt || m.localStatus);
    const authorEntry = isGroup && !mine ? panelEntryById.get(m.userIdFrom) : undefined;
    const showReplyAction = !m.deletedAt && !m.localStatus;
    const showRecallAction = canRecall(m);
    const showDeleteMineAction = showReplyAction && mine;
    const showModerateActions = active.canModerate && !m.localStatus;
    const showMoreMenu = showRecallAction || showDeleteMineAction || showModerateActions;
    threadItems.push(
      <MessageScrollerItem
        key={m.id}
        messageId={m.id}
        scrollAnchor={mine}
        className={firstOfCluster ? 'mt-4' : 'mt-1'}
      >
        <Message align={mine ? 'end' : 'start'}>
          {firstOfCluster ? (
          <MessageAvatar>
            {authorEntry && memberPanel ? (
              <MemberActionMenu
                entry={authorEntry}
                myId={myId}
                context={memberPanel.context}
                canManage={Boolean(active.canManage)}
                hasDirectConversation={memberPanel.directPartnerIds.has(authorEntry.userId)}
                triggerLabel={t('memberMenuLabel', { name: authorEntry.displayName })}
                triggerClassName="shrink-0 rounded-full"
                onMessageMember={memberPanel.onMessageMember}
                onSendContactRequest={memberPanel.onSendContactRequest}
                onRespondContactRequest={memberPanel.onRespondContactRequest}
                onRemoveMember={memberPanel.onRemoveMember}
                onViewProfile={memberProfile.open}
                isBlockedByMe={blocked.includes(authorEntry.userId)}
                onBlockContact={blockContact}
                onUnblockContact={unblockContact}
              >
                <Avatar>
                  <AvatarFallback className="bg-muted text-foreground">{initialsOf(authorEntry.displayName)}</AvatarFallback>
                </Avatar>
              </MemberActionMenu>
            ) : (
              <Avatar>
                <AvatarFallback className={mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}>
                  {initialsOf(nameOf(m.userIdFrom))}
                </AvatarFallback>
              </Avatar>
            )}
          </MessageAvatar>
          ) : (
            <div aria-hidden className="w-8 shrink-0" />
          )}
          <MessageContent>
            {!mine && isGroup && firstOfCluster ? (
              <MessageHeader className="px-1">{nameOf(m.userIdFrom)}</MessageHeader>
            ) : null}
            <Bubble
              variant={m.deletedAt || m.recalledAt ? 'destructive' : mine ? 'default' : 'muted'}
              align={mine ? 'end' : 'start'}
              className={cn('max-w-sm', m.id === highlightedMessageId && 'rounded-lg ring-2 ring-primary ring-offset-1')}
              data-testid={`message-bubble-${m.id}`}
              tabIndex={showReplyAction ? 0 : undefined}
              onDoubleClick={showReplyAction ? (e) => {
                e.preventDefault();
                window.getSelection()?.removeAllRanges();
                onStartReply(m);
              } : undefined}
              onTouchEnd={showReplyAction ? (e) => {
                const touch = e.changedTouches[0];
                if (!touch) return;
                const now = Date.now();
                const last = lastBubbleTapRef.current;
                if (
                  last && last.messageId === m.id && now - last.at <= 350
                  && Math.hypot(touch.clientX - last.x, touch.clientY - last.y) <= 24
                ) {
                  lastBubbleTapRef.current = null;
                  onStartReply(m);
                  return;
                }
                lastBubbleTapRef.current = { messageId: m.id, at: now, x: touch.clientX, y: touch.clientY };
              } : undefined}
              onKeyDown={showReplyAction ? (e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onStartReply(m);
                }
              } : undefined}
            >
              <BubbleContent>
                {m.replyTo ? (
                  <button
                    type="button"
                    data-testid={`quote-block-${m.id}`}
                    className={cn(
                      'mb-1 block w-full max-w-full cursor-pointer rounded-lg border-l-2 px-2.5 py-1.5 text-left',
                      mine
                        ? 'border-primary-foreground/50 bg-primary-foreground/15'
                        : 'border-primary/70 bg-background',
                    )}
                    onClick={() => onJumpToQuote(m.replyTo!)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <span className="block text-xs font-semibold">{nameOf(m.replyTo.userIdFrom)}</span>
                    <span className="block text-xs opacity-80">
                      {m.replyTo.unavailable ? t('quotedMessageUnavailable') : m.replyTo.excerpt}
                    </span>
                  </button>
                ) : null}
                <span className="block">
                  {m.recalledAt ? t('messageRecalled') : <RichMessageText text={m.fullMessage} />}
                </span>
                <span
                  data-testid={`message-time-${m.id}`}
                  className="mt-1 flex items-center justify-end gap-1 text-[10px] leading-none"
                >
                  {formatWithOptions(m.createdAt, i18n.language, { hour: 'numeric', minute: '2-digit', hour12: true })}
                  {mine && m.localStatus === 'sending' ? (
                    <Check className="size-3 opacity-70" aria-hidden />
                  ) : mine && !m.localStatus && m.seq > 0 ? (
                    seenByOthers ? (
                      <>
                        <CheckCheck className="size-3" aria-hidden />
                        <span className="sr-only">{t('seenByMembers')}</span>
                      </>
                    ) : (
                      <CheckCheck className="size-3 opacity-70" aria-hidden />
                    )
                  ) : null}
                </span>
              </BubbleContent>
              {showReplyAction || showMoreMenu ? (
                <div
                  data-slot="message-actions"
                  data-placement="floating"
                  className={`absolute top-0 z-10 flex items-center gap-0.5 opacity-100 transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100 [@media(hover:hover)]:focus-within:opacity-100 [@media(hover:none)]:opacity-60 ${mine ? 'right-full mr-1' : 'left-full ml-1'}`}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                {showReplyAction ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('replyToMessage')}
                    data-testid={`message-reply-${m.id}`}
                    onClick={() => onStartReply(m)}
                  >
                    <Reply aria-hidden />
                  </Button>
                ) : null}
                {showReplyAction ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('reactionPickerLabel')}
                          data-testid={`message-reaction-${m.id}`}
                        />
                      }
                    >
                      <SmilePlus aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align={mine ? 'end' : 'start'} sideOffset={4} className="grid w-56 grid-cols-5 gap-1 p-2">
                      {REACTION_SHAPE_EMOJIS.map((emoji) => (
                        <DropdownMenuItem key={emoji} disabled className="flex items-center justify-center text-lg">
                          {emoji}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {showMoreMenu ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('messageMoreActions')}
                          data-testid={`message-actions-${m.id}`}
                        />
                      }
                    >
                      <Ellipsis aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align={mine ? 'end' : 'start'} sideOffset={4} className={CHAT_MENU_CONTENT_CLASS}>
                      <DropdownMenuItem disabled className={CHAT_MENU_ITEM_CLASS}>
                        <MessagesSquare aria-hidden />
                        {t('threadAction')}
                      </DropdownMenuItem>
                      {showRecallAction ? (
                        <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => void recallMessage(m)}>
                          <Undo2 aria-hidden />
                          {t('recallMessage')}
                        </DropdownMenuItem>
                      ) : null}
                      {showDeleteMineAction ? (
                        <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => void deleteMessage(m)}>
                          <Trash aria-hidden />
                          {t('deleteMessage')}
                        </DropdownMenuItem>
                      ) : null}
                      {showModerateActions ? (
                        <DropdownMenuCheckboxItem
                          className={CHAT_MENU_ITEM_CLASS}
                          checked={selectedForBulk.has(m.id)}
                          onCheckedChange={() => setSelectedForBulk((prev) => {
                            const next = new Set(prev);
                            if (next.has(m.id)) next.delete(m.id);
                            else next.add(m.id);
                            return next;
                          })}
                        >
                          {t('selectMessageForBulk')}
                        </DropdownMenuCheckboxItem>
                      ) : null}
                      {showModerateActions ? (
                        <DropdownMenuItem variant="destructive" className={CHAT_MENU_ITEM_CLASS} onClick={() => void hardDeleteMessage(m)}>
                          <Eraser aria-hidden />
                          {t('hardDeleteMessage')}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                </div>
              ) : null}
            </Bubble>
            {hasOwnStatusNote ? (
              <MessageFooter className="flex-wrap gap-2">
              {m.deletedAt ? (
                <span className="italic">
                  {t('messageDeletedBy', { userId: m.deletedBy ? nameOf(m.deletedBy) : '' })}
                </span>
              ) : null}
              {m.recalledAt ? (
                <span className="italic">
                  {t('messageRecalledBy', { userId: m.recalledBy ? nameOf(m.recalledBy) : '' })}
                </span>
              ) : null}
              {m.localStatus === 'sending' ? <span>{t('messageSending')}</span> : null}
              {m.localStatus === 'failed' ? (
                <span className="flex items-center gap-2">
                  <span>{t('messageSendFailed')}</span>
                  <Button type="button" variant="outline" onClick={() => void retrySend(m)}>
                    {t('retrySend')}
                  </Button>
                </span>
              ) : null}
              </MessageFooter>
            ) : null}
          </MessageContent>
        </Message>
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
      <div className="flex items-center justify-between gap-4 px-2 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label={t('messagesBackToList')}
          onClick={() => onBack()}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <button
          type="button"
          aria-label={t('conversationInfoTitle')}
          aria-pressed={infoOpen}
          className="relative shrink-0 rounded-full"
          onClick={() => setInfoOpen((prev) => !prev)}
        >
          <Avatar>
            <AvatarFallback>{initialsOf(avatarLabel)}</AvatarFallback>
          </Avatar>
          {otherStatus !== undefined ? (
            <span
              className={cn(
                'absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-background',
                PRESENCE_DOT_CLASS[otherStatus],
              )}
            />
          ) : null}
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{title}</span>
          </p>
          {subtitle ? <p className="truncate text-xs leading-3 text-muted-foreground">{subtitle}</p> : null}
        </div>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('callAction')} disabled>
              <Phone aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('callAction')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('videoCallAction')} disabled>
              <Video aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('videoCallAction')}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('conversationActionsLabel')}
                data-testid="header-actions"
              />
            }
          >
            <EllipsisVertical aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4} className="w-48">
            {!isGroup && otherId ? (
              <DropdownMenuItem
                className={CHAT_MENU_ITEM_CLASS}
                onClick={() => setInfoOpen(true)}
              >
                {t('viewProfile')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className={CHAT_MENU_ITEM_CLASS}
              onClick={() => onUpdateConversationState(active, { muted: !active.muted })}
            >
              {active.muted ? t('unmuteConversation') : t('muteConversation')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={CHAT_MENU_ITEM_CLASS}
              onClick={() => onUpdateConversationState(active, { pinned: !active.pinnedAt })}
            >
              {active.pinnedAt ? t('unpinConversation') : t('pinConversation')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={CHAT_MENU_ITEM_CLASS}
              onClick={() => onUpdateConversationState(active, { archived: !active.archivedAt })}
            >
              {active.archivedAt ? t('unarchiveConversation') : t('archiveConversation')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} disabled>
              {t('clearChat')}
            </DropdownMenuItem>
            {!isGroup && otherId ? (
              <>
                {blocked.includes(otherId) ? (
                  <DropdownMenuItem variant="destructive" className={CHAT_MENU_ITEM_CLASS} onClick={() => void unblockContact(otherId)}>
                    {t('unblockContact')} {nameOf(otherId)}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem variant="destructive" className={CHAT_MENU_ITEM_CLASS} onClick={() => void blockContact(otherId)}>
                    {t('blockContact')} {nameOf(otherId)}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem variant="destructive" className={CHAT_MENU_ITEM_CLASS} disabled>
                  {t('deleteConversation')}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={CHAT_MENU_ITEM_CLASS}
              aria-pressed={searchOpen}
              onClick={() => setSearchOpen((prev) => !prev)}
            >
              {t('messageSearchLabel')}
            </DropdownMenuItem>
            <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => void reportActiveConversation()}>
              {t('reportConversation')}
            </DropdownMenuItem>
            {active.canManage ? (
              <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => void toggleActiveChat()}>
                {(active.enabled ?? true) ? t('disableChat') : t('enableChat')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
      <div className="flex flex-col gap-3 px-3 pb-2">
        {active.enabled === false && !active.canManage ? (
          <p role="status" className="text-sm text-muted-foreground">{t('chatDisabledNotice')}</p>
        ) : (
          <>
            {active.enabled === false ? (
              <p role="status" className="text-sm text-muted-foreground">{t('chatDisabledForMembers')}</p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REPLY_SHAPE_SAMPLES.map((sample) => (
                <Button
                  key={sample}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-auto rounded-full px-3 py-1 text-xs font-normal text-muted-foreground shadow-none hover:bg-muted"
                  disabled
                >
                  {sample}
                </Button>
              ))}
            </div>
            <Tabs
              value={composerTab}
              onValueChange={(value) => {
                setComposerTab(value === 'note' ? 'note' : 'reply');
                setNoteNoticeFor(null);
              }}
              className="border-border rounded-md border"
            >
              <TabsList
                variant="line"
                className="w-full justify-start gap-2 border-b px-3 group-data-horizontal/tabs:h-10 **:data-[slot=tabs-trigger]:border-x-0 **:data-[slot=tabs-trigger]:px-6"
              >
                <TabsTrigger value="reply" className="flex-none px-1">{t('replyTabLabel')}</TabsTrigger>
                <TabsTrigger value="note" className="flex-none px-1">{t('internalNoteTabLabel')}</TabsTrigger>
              </TabsList>
              <TabsContent value="reply" className="m-0">
                {replyTarget ? (
                  <div className="px-3 pt-3">
                    <div
                      data-testid="reply-chip"
                      className="flex items-center gap-2 rounded-lg border-l-2 border-primary bg-muted/50 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-primary">{t('replyingTo', { user: nameOf(replyTarget.userIdFrom) })}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {replyTarget.recalledAt ? t('quotedMessageUnavailable') : quoteExcerptOfText(replyTarget.fullMessage)}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('cancelReply')}
                        onClick={() => onCancelReply()}
                      >
                        <X aria-hidden className="size-4" />
                      </Button>
                    </div>
                  </div>
                ) : null}
                <form onSubmit={(e) => void send(e)} className="flex flex-col gap-2 px-3 pb-2">
                  <Textarea
                    ref={composerRef}
                    aria-label={t('messageText')}
                    placeholder={t('messagePlaceholder')}
                    rows={1}
                    className="max-h-32 min-h-10 min-w-0 resize-none rounded-none border-0 px-0 py-2 text-sm shadow-none focus-visible:ring-0"
                    value={draft}
                    onChange={(e) => {
                      setDrafts((prev) => ({ ...prev, [active.id]: e.target.value }));
                      noteTyping();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (!sendInFlight) e.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('boldLabel')}
                        onClick={applyBold}
                      >
                        <span className="text-base leading-none font-medium">B</span>
                      </Button>
                      <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                        <PopoverTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('emojiPickerLabel')}
                            />
                          }
                        >
                          <Smile aria-hidden />
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          sideOffset={4}
                          data-testid="emoji-picker-popover"
                          className="w-64 p-2"
                        >
                          <div className="grid grid-cols-5 gap-1">
                            {EMOJI_GRID_OPTIONS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                className="rounded-md p-2 text-lg transition-colors hover:bg-muted"
                                onClick={() => insertEmojiAtCursor(emoji)}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('attachFileLabel')}
                        disabled
                      >
                        <Paperclip aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('insertLinkLabel')}
                        onClick={insertLink}
                      >
                        <Link2 aria-hidden />
                      </Button>
                    </div>
                    <Button
                      type="submit"
                      size="icon-sm"
                      aria-label={t('send')}
                      disabled={sendInFlight || !draft.trim()}
                    >
                      <Send aria-hidden />
                    </Button>
                  </div>
                </form>
              </TabsContent>
              <TabsContent value="note" className="m-0">
                <form onSubmit={sendNote} className="flex flex-col gap-2 px-3 pb-2">
                  <Textarea
                    ref={noteComposerRef}
                    aria-label={t('internalNoteTabLabel')}
                    placeholder={t('internalNotePlaceholder')}
                    rows={1}
                    className="max-h-32 min-h-10 min-w-0 resize-none rounded-none border-0 px-0 py-2 text-sm shadow-none focus-visible:ring-0"
                    value={noteDraft}
                    onChange={(e) => {
                      setNoteDrafts((prev) => ({ ...prev, [active.id]: e.target.value }));
                      setNoteNoticeFor(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('boldLabel')}
                        onClick={applyNoteBold}
                      >
                        <span className="text-base leading-none font-medium">B</span>
                      </Button>
                      <Popover open={noteEmojiOpen} onOpenChange={setNoteEmojiOpen}>
                        <PopoverTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('emojiPickerLabel')}
                            />
                          }
                        >
                          <Smile aria-hidden />
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          sideOffset={4}
                          data-testid="note-emoji-picker-popover"
                          className="w-64 p-2"
                        >
                          <div className="grid grid-cols-5 gap-1">
                            {EMOJI_GRID_OPTIONS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                className="rounded-md p-2 text-lg transition-colors hover:bg-muted"
                                onClick={() => insertNoteEmojiAtCursor(emoji)}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('attachFileLabel')}
                        disabled
                      >
                        <Paperclip aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('insertLinkLabel')}
                        onClick={insertNoteLink}
                      >
                        <Link2 aria-hidden />
                      </Button>
                    </div>
                    <Button
                      type="submit"
                      size="icon-sm"
                      aria-label={t('send')}
                      disabled={!noteDraft.trim()}
                    >
                      <Send aria-hidden />
                    </Button>
                  </div>
                </form>
              </TabsContent>
            </Tabs>
            {noteNoticeFor === active.id ? (
              <p role="status" className="text-sm text-muted-foreground">{t('internalNoteLocalNotice')}</p>
            ) : null}
            {sendError ? (
              <p role="alert" className="text-sm text-destructive">{sendError}</p>
            ) : null}
          </>
        )}
      </div>
      </div>
      {showInfoAside ? (
        <aside
          data-testid="info-aside"
          className="absolute inset-y-0 right-0 z-20 flex w-[85vw] max-w-[320px] min-w-0 flex-col overflow-x-hidden overflow-y-auto border-l bg-background shadow-xl md:static md:z-auto md:w-[320px] md:shrink-0 md:shadow-none"
        >
          {isGroup && memberPanelBundle ? (
            <>
              <div className="flex justify-end px-3 pt-2 md:hidden">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('closeDialog')}
                  onClick={() => setInfoOpen(false)}
                >
                  <X aria-hidden />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 border-b px-3 py-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onUpdateConversationState(active, { muted: !active.muted })}
                >
                  {active.muted ? <Bell aria-hidden /> : <BellOff aria-hidden />}
                  {active.muted ? t('unmuteConversation') : t('muteConversation')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onUpdateConversationState(active, { pinned: !active.pinnedAt })}
                >
                  {active.pinnedAt ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                  {active.pinnedAt ? t('unpinConversation') : t('pinConversation')}
                </Button>
              </div>
              <MemberPanel
                conversation={active}
                bundle={memberPanelBundle}
                myId={myId}
                onlineUsers={onlineUsers}
                readMarkers={readMarkers}
                newestSeq={newestSeq}
                onViewProfile={memberProfile.open}
              />
            </>
          ) : null}
          {!isGroup && otherId && partnerProfile ? (
            <div data-testid="partner-panel" className="flex min-h-full flex-col">
              <div className="sticky top-0 z-10 flex items-start gap-3 bg-background px-4 py-4">
                <span className="relative shrink-0">
                  <Avatar size="lg">
                    <AvatarFallback>{initialsOf(avatarLabel)}</AvatarFallback>
                  </Avatar>
                  {otherStatus !== undefined ? (
                    <span
                      className={cn(
                        'absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-background',
                        PRESENCE_DOT_CLASS[otherStatus],
                      )}
                    />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">{title}</p>
                  {partnerProfile.roleLine ? (
                    <p className="text-xs text-muted-foreground">{partnerProfile.roleLine}</p>
                  ) : null}
                  {otherStatus !== undefined ? (
                    <p className="text-xs text-muted-foreground">
                      {t(presenceLabelKey(otherStatus))}
                    </p>
                  ) : null}
                  {blocked.includes(otherId) ? (
                    <p className="text-sm">
                      {nameOf(otherId)} {t('blockedSuffix')}
                    </p>
                  ) : null}
                  {partnerProfile.tags.length > 0 ? (
                    <div className="mt-1 flex flex-wrap justify-end gap-1">
                      {partnerProfile.tags.map((tag) => (
                        <Badge key={tag} variant="outline">{tag}</Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="md:hidden"
                  aria-label={t('closeDialog')}
                  onClick={() => setInfoOpen(false)}
                >
                  <X aria-hidden />
                </Button>
              </div>
              <div className="space-y-4 px-4 pb-4">
                <Separator />
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => onUpdateConversationState(active, { muted: !active.muted })}
                  >
                    {active.muted ? t('unmuteConversation') : t('muteConversation')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => onUpdateConversationState(active, { pinned: !active.pinnedAt })}
                  >
                    {active.pinnedAt ? t('unpinConversation') : t('pinConversation')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start"
                    disabled
                  >
                    {t('clearChat')}
                  </Button>
                  {blocked.includes(otherId) ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => void unblockContact(otherId)}
                    >
                      {t('unblockContact')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => void blockContact(otherId)}
                    >
                      {t('blockContact')}
                    </Button>
                  )}
                </div>
                {partnerProfile.bio ? (
                  <div className="space-y-1">
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <FileText className="size-4" aria-hidden />
                      {t('profileBio')}
                    </p>
                    <p className="text-sm leading-relaxed text-muted-foreground">{partnerProfile.bio}</p>
                  </div>
                ) : null}
                <dl className="space-y-2 text-sm">
                  {([
                    ['profileEmail', partnerProfile.email, Mail],
                    ['profilePhone', partnerProfile.phone, Phone],
                    ['profileWebsite', partnerProfile.website, Globe],
                    ['profileCompany', partnerProfile.company, Building2],
                    ['profileCountry', partnerProfile.country, Flag],
                    ['profileTimezone', partnerProfile.timezone, Clock],
                    ['profileLocation', partnerProfile.location, MapPin],
                    ['profileAvailability', partnerProfile.availability, Sparkles],
                  ] as const).filter(([, value]) => Boolean(value)).map(([key, value, Icon]) => (
                    <div key={key} className="flex items-center gap-2">
                      <dt className="flex items-center gap-2 text-muted-foreground">
                        <Icon className="size-4" aria-hidden />
                        {t(key)}
                      </dt>
                      <dd className="ml-auto min-w-0 truncate">
                        {key === 'profileEmail' ? (
                          <a href={`mailto:${value}`} className="hover:underline">{value}</a>
                        ) : key === 'profilePhone' ? (
                          <a href={`tel:${value!.replace(/\s+/g, '')}`} className="hover:underline">{value}</a>
                        ) : key === 'profileWebsite' ? (
                          <a href={value!} target="_blank" rel="noopener noreferrer" className="hover:underline">{value}</a>
                        ) : (
                          value
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                {sharedFiles.length > 0 ? (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">{t('sharedFilesTitle')}</h4>
                    <ul className="space-y-1">
                      {sharedFiles.map((file) => (
                        <li key={file.id}>
                          <FileCard name={file.name} sizeLabel={file.sizeLabel} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              <div className="mt-auto px-4 pb-4 pt-2">
                <Button type="button" variant="destructive" className="w-full gap-2" disabled>
                  <Trash className="size-4" aria-hidden />
                  {t('deleteConversation')}
                </Button>
              </div>
            </div>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
