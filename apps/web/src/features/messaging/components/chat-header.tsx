import { ChevronLeft, EllipsisVertical, Phone, Video } from 'lucide-react';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Button } from '@giaokhoa/ui/components/button';
import { cn } from '@giaokhoa/ui/lib/utils';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@giaokhoa/ui/components/dropdown-menu';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@giaokhoa/ui/components/tooltip';
import { useTranslation } from 'react-i18next';

import type { ConversationStatePatch, ConversationView, PresenceStatus } from '../types/types';
import {
  CHAT_MENU_ITEM_CLASS, PRESENCE_DOT_CLASS, initialsOf,
} from '../utils/utils';

interface ChatHeaderProps {
  active: ConversationView;
  title: string;
  subtitle: string;
  avatarLabel: string;
  otherStatus: PresenceStatus | undefined;
  isGroup: boolean;
  otherId: string | undefined;
  blocked: string[];
  searchOpen: boolean;
  infoOpen: boolean;
  nameOf: (userId: string) => string;
  onBack: () => void;
  onToggleInfo: () => void;
  onOpenInfo: () => void;
  onToggleSearch: () => void;
  onUpdateConversationState: (conversation: ConversationView, patch: ConversationStatePatch) => void;
  onReportConversation: () => void;
  onToggleChat: () => void;
  onBlockContact: (userId: string) => void;
  onUnblockContact: (userId: string) => void;
}

export function ChatHeader({
  active, title, subtitle, avatarLabel, otherStatus, isGroup, otherId, blocked,
  searchOpen, infoOpen, nameOf, onBack, onToggleInfo, onOpenInfo, onToggleSearch,
  onUpdateConversationState, onReportConversation, onToggleChat, onBlockContact, onUnblockContact,
}: ChatHeaderProps) {
  const { t } = useTranslation('app');
  return (
<div className="flex items-center justify-between gap-4 px-2 pt-3">
  <Button
    type="button"
    variant="ghost"
    size="icon-sm"
    className="md:hidden"
    aria-label={t('messagesBackToList')}
    onClick={onBack}
  >
    <ChevronLeft aria-hidden />
  </Button>
  <button
    type="button"
    aria-label={t('conversationInfoTitle')}
    aria-pressed={infoOpen}
    className="relative shrink-0 rounded-full"
    onClick={() => onToggleInfo()}
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
          onClick={() => onOpenInfo()}
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
            <DropdownMenuItem variant="destructive" className={CHAT_MENU_ITEM_CLASS} onClick={() => onUnblockContact(otherId)}>
              {t('unblockContact')} {nameOf(otherId)}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" className={CHAT_MENU_ITEM_CLASS} onClick={() => onBlockContact(otherId)}>
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
        onClick={() => onToggleSearch()}
      >
        {t('messageSearchLabel')}
      </DropdownMenuItem>
      <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => onReportConversation()}>
        {t('reportConversation')}
      </DropdownMenuItem>
      {active.canManage ? (
        <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => onToggleChat()}>
          {(active.enabled ?? true) ? t('disableChat') : t('enableChat')}
        </DropdownMenuItem>
      ) : null}
    </DropdownMenuContent>
  </DropdownMenu>
</div>
  );
}
