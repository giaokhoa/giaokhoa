import { useRef, type Dispatch, type SetStateAction } from 'react';
import { Check, CheckCheck, Ellipsis, Eraser, MessagesSquare, Reply, SmilePlus, Trash, Undo2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Bubble, BubbleContent } from '@giaokhoa/ui/components/bubble';
import { Button } from '@giaokhoa/ui/components/button';
import { cn } from '@giaokhoa/ui/lib/utils';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from '@giaokhoa/ui/components/dropdown-menu';
import {
  Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader,
} from '@giaokhoa/ui/components/message';
import { useTranslation } from 'react-i18next';

import { formatWithOptions } from '#utils/date-format';
import type { MemberPanelEntry, MessageQuoteView, MessageView } from '../types/types';
import type { MemberPanelBundle } from './member-panel';
import { MemberActionMenu } from './member-panel';
import {
  CHAT_MENU_CONTENT_CLASS, CHAT_MENU_ITEM_CLASS, initialsOf,
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

const REACTION_SHAPE_EMOJIS = ['❤️', '😂', '😮', '😢', '👍'];

interface ChatMessageItemProps {
  message: MessageView;
  firstOfCluster: boolean;
  highlighted: boolean;
  isGroup: boolean;
  canModerate: boolean;
  canManage: boolean;
  myId: string | undefined;
  nameOf: (userId: string) => string;
  seenThroughSeq: number;
  authorEntry: MemberPanelEntry | undefined;
  memberPanel: MemberPanelBundle | null;
  blocked: string[];
  selectedForBulk: Set<string>;
  setSelectedForBulk: Dispatch<SetStateAction<Set<string>>>;
  onStartReply: (message: MessageView) => void;
  onJumpToQuote: (quote: MessageQuoteView) => void;
  onRetrySend: (message: MessageView) => void;
  onDeleteMessage: (message: MessageView) => void;
  canRecall: (message: MessageView) => boolean;
  onRecallMessage: (message: MessageView) => void;
  onHardDeleteMessage: (message: MessageView) => void;
  onViewProfile: (entry: MemberPanelEntry) => void;
  onBlockContact: (userId: string) => void;
  onUnblockContact: (userId: string) => void;
}

export function ChatMessageItem({
  message, firstOfCluster, highlighted, isGroup, canModerate, canManage, myId, nameOf,
  seenThroughSeq, authorEntry, memberPanel, blocked, selectedForBulk, setSelectedForBulk,
  onStartReply, onJumpToQuote, onRetrySend, onDeleteMessage, canRecall, onRecallMessage,
  onHardDeleteMessage, onViewProfile, onBlockContact, onUnblockContact,
}: ChatMessageItemProps) {
  const { t, i18n } = useTranslation('app');
  const lastBubbleTapRef = useRef<{ messageId: string; at: number; x: number; y: number } | null>(null);
  const mine = message.userIdFrom === myId;
  const seenByOthers = mine && !message.localStatus && message.seq > 0 && message.seq <= seenThroughSeq;
  const hasOwnStatusNote = Boolean(message.deletedAt || message.recalledAt || message.localStatus);
  const showReplyAction = !message.deletedAt && !message.localStatus;
  const showRecallAction = canRecall(message);
  const showDeleteMineAction = showReplyAction && mine;
  const showModerateActions = canModerate && !message.localStatus;
  const showMoreMenu = showRecallAction || showDeleteMineAction || showModerateActions;
  return (
<Message align={mine ? 'end' : 'start'}>
  {firstOfCluster ? (
  <MessageAvatar>
    {authorEntry && memberPanel ? (
      <MemberActionMenu
        entry={authorEntry}
        myId={myId}
        context={memberPanel.context}
        canManage={Boolean(canManage)}
        hasDirectConversation={memberPanel.directPartnerIds.has(authorEntry.userId)}
        triggerLabel={t('memberMenuLabel', { name: authorEntry.displayName })}
        triggerClassName="shrink-0 rounded-full"
        onMessageMember={memberPanel.onMessageMember}
        onSendContactRequest={memberPanel.onSendContactRequest}
        onRespondContactRequest={memberPanel.onRespondContactRequest}
        onRemoveMember={memberPanel.onRemoveMember}
        onViewProfile={onViewProfile}
        isBlockedByMe={blocked.includes(authorEntry.userId)}
        onBlockContact={onBlockContact}
        onUnblockContact={onUnblockContact}
      >
        <Avatar>
          <AvatarFallback className="bg-muted text-foreground">{initialsOf(authorEntry.displayName)}</AvatarFallback>
        </Avatar>
      </MemberActionMenu>
    ) : (
      <Avatar>
        <AvatarFallback className={mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}>
          {initialsOf(nameOf(message.userIdFrom))}
        </AvatarFallback>
      </Avatar>
    )}
  </MessageAvatar>
  ) : (
    <div aria-hidden className="w-8 shrink-0" />
  )}
  <MessageContent>
    {!mine && isGroup && firstOfCluster ? (
      <MessageHeader className="px-1">{nameOf(message.userIdFrom)}</MessageHeader>
    ) : null}
    <Bubble
      variant={message.deletedAt || message.recalledAt ? 'destructive' : mine ? 'default' : 'muted'}
      align={mine ? 'end' : 'start'}
      className={cn('max-w-sm', highlighted && 'rounded-lg ring-2 ring-primary ring-offset-1')}
      data-testid={`message-bubble-${message.id}`}
      tabIndex={showReplyAction ? 0 : undefined}
      onDoubleClick={showReplyAction ? (e) => {
        e.preventDefault();
        window.getSelection()?.removeAllRanges();
        onStartReply(message);
      } : undefined}
      onTouchEnd={showReplyAction ? (e) => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        const now = Date.now();
        const last = lastBubbleTapRef.current;
        if (
          last && last.messageId === message.id && now - last.at <= 350
          && Math.hypot(touch.clientX - last.x, touch.clientY - last.y) <= 24
        ) {
          lastBubbleTapRef.current = null;
          onStartReply(message);
          return;
        }
        lastBubbleTapRef.current = { messageId: message.id, at: now, x: touch.clientX, y: touch.clientY };
      } : undefined}
      onKeyDown={showReplyAction ? (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onStartReply(message);
        }
      } : undefined}
    >
      <BubbleContent>
        {message.replyTo ? (
          <button
            type="button"
            data-testid={`quote-block-${message.id}`}
            className={cn(
              'mb-1 block w-full max-w-full cursor-pointer rounded-lg border-l-2 px-2.5 py-1.5 text-left',
              mine
                ? 'border-primary-foreground/50 bg-primary-foreground/15'
                : 'border-primary/70 bg-background',
            )}
            onClick={() => onJumpToQuote(message.replyTo!)}
            onDoubleClick={(e) => {
              e.stopPropagation();
            }}
          >
            <span className="block text-xs font-semibold">{nameOf(message.replyTo.userIdFrom)}</span>
            <span className="block text-xs opacity-80">
              {message.replyTo.unavailable ? t('quotedMessageUnavailable') : message.replyTo.excerpt}
            </span>
          </button>
        ) : null}
        <span className="block">
          {message.recalledAt ? t('messageRecalled') : <RichMessageText text={message.fullMessage} />}
        </span>
        <span
          data-testid={`message-time-${message.id}`}
          className="mt-1 flex items-center justify-end gap-1 text-[10px] leading-none"
        >
          {formatWithOptions(message.createdAt, i18n.language, { hour: 'numeric', minute: '2-digit', hour12: true })}
          {mine && message.localStatus === 'sending' ? (
            <Check className="size-3 opacity-70" aria-hidden />
          ) : mine && !message.localStatus && message.seq > 0 ? (
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
            data-testid={`message-reply-${message.id}`}
            onClick={() => onStartReply(message)}
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
                  data-testid={`message-reaction-${message.id}`}
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
                  data-testid={`message-actions-${message.id}`}
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
                <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => void onRecallMessage(message)}>
                  <Undo2 aria-hidden />
                  {t('recallMessage')}
                </DropdownMenuItem>
              ) : null}
              {showDeleteMineAction ? (
                <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => void onDeleteMessage(message)}>
                  <Trash aria-hidden />
                  {t('deleteMessage')}
                </DropdownMenuItem>
              ) : null}
              {showModerateActions ? (
                <DropdownMenuCheckboxItem
                  className={CHAT_MENU_ITEM_CLASS}
                  checked={selectedForBulk.has(message.id)}
                  onCheckedChange={() => setSelectedForBulk((prev) => {
                    const next = new Set(prev);
                    if (next.has(message.id)) next.delete(message.id);
                    else next.add(message.id);
                    return next;
                  })}
                >
                  {t('selectMessageForBulk')}
                </DropdownMenuCheckboxItem>
              ) : null}
              {showModerateActions ? (
                <DropdownMenuItem variant="destructive" className={CHAT_MENU_ITEM_CLASS} onClick={() => void onHardDeleteMessage(message)}>
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
      {message.deletedAt ? (
        <span className="italic">
          {t('messageDeletedBy', { userId: message.deletedBy ? nameOf(message.deletedBy) : '' })}
        </span>
      ) : null}
      {message.recalledAt ? (
        <span className="italic">
          {t('messageRecalledBy', { userId: message.recalledBy ? nameOf(message.recalledBy) : '' })}
        </span>
      ) : null}
      {message.localStatus === 'sending' ? <span>{t('messageSending')}</span> : null}
      {message.localStatus === 'failed' ? (
        <span className="flex items-center gap-2">
          <span>{t('messageSendFailed')}</span>
          <Button type="button" variant="outline" onClick={() => void onRetrySend(message)}>
            {t('retrySend')}
          </Button>
        </span>
      ) : null}
      </MessageFooter>
    ) : null}
  </MessageContent>
</Message>
  );
}
