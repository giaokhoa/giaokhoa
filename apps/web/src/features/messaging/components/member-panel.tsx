import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Ban, Check, Info, MessageCircle, Trash, UserPlus, X } from 'lucide-react';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Badge } from '@giaokhoa/ui/components/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@giaokhoa/ui/components/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@giaokhoa/ui/components/sheet';
import { useTranslation } from 'react-i18next';
import type { ConversationView, MemberPanelContext, MemberPanelEntry } from '../types/types';
import { CHAT_MENU_CONTENT_CLASS, CHAT_MENU_ITEM_CLASS, initialsOf } from '../utils/utils';


export interface MemberPanelBundle {
  context: MemberPanelContext;
  entries: MemberPanelEntry[] | null;
  failed: boolean;
  notice: string | null;
  directPartnerIds: ReadonlySet<string>;
  onMessageMember: (userId: string) => void;
  onSendContactRequest: (userId: string) => void;
  onRespondContactRequest: (userId: string, action: 'accept' | 'decline') => void;
  onRemoveMember: (userId: string) => void;
  blockedIds?: ReadonlySet<string>;
  onBlockContact?: (userId: string) => void;
  onUnblockContact?: (userId: string) => void;
}

function roleLabel(role: MemberPanelEntry['role'], t: (key: string) => string): string {
  switch (role) {
    case 'teacher': return t('memberGroupTeachers');
    case 'student': return t('memberGroupStudents');
    case 'admin': return t('memberGroupAdmins');
    default: return t('memberGroupMembers');
  }
}

function relationshipLabel(entry: MemberPanelEntry, t: (key: string) => string): string {
  if (entry.canDirectMessage && entry.relationship !== 'contact') return t('memberRelDirect');
  switch (entry.relationship) {
    case 'contact': return t('relationshipContact');
    case 'pending_incoming': return t('memberRelPendingIncoming');
    case 'pending_outgoing': return t('memberRelPendingOutgoing');
    case 'blocked': return t('memberRelBlocked');
    default: return t('memberRelNone');
  }
}

interface MemberActionMenuProps {
  entry: MemberPanelEntry;
  myId: string | undefined;
  context: MemberPanelContext;
  canManage: boolean;
  hasDirectConversation: boolean;
  children: ReactNode;
  triggerClassName?: string;
  triggerLabel: string;
  onMessageMember: (userId: string) => void;
  onSendContactRequest: (userId: string) => void;
  onRespondContactRequest: (userId: string, action: 'accept' | 'decline') => void;
  onRemoveMember: (userId: string) => void;
  onViewProfile: (entry: MemberPanelEntry) => void;
  isBlockedByMe?: boolean;
  onBlockContact?: (userId: string) => void;
  onUnblockContact?: (userId: string) => void;
}

export function MemberActionMenu({
  entry, myId, context, canManage, hasDirectConversation, children, triggerClassName,
  triggerLabel, onMessageMember, onSendContactRequest, onRespondContactRequest,
  onRemoveMember, onViewProfile, isBlockedByMe, onBlockContact, onUnblockContact,
}: MemberActionMenuProps) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const isSelf = entry.userId === myId;
  const blocked = entry.relationship === 'blocked';
  const blockedByMe = Boolean(isBlockedByMe);
  const canMessageNow = !blocked && !isSelf
    && (entry.relationship === 'contact' || entry.canDirectMessage || hasDirectConversation);
  const rosterHref = context.kind === 'class'
    ? `/classes/${context.id}`
    : context.kind === 'course'
      ? `/courses/${context.id}`
      : null;

  if (blocked && !blockedByMe) return <>{children}</>;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" aria-label={triggerLabel} className={triggerClassName} />}
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className={CHAT_MENU_CONTENT_CLASS}>
        {canMessageNow ? (
          <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => onMessageMember(entry.userId)}>
            <MessageCircle aria-hidden />
            {t('directMessageAction')}
          </DropdownMenuItem>
        ) : null}
        {!isSelf && !blockedByMe && entry.relationship === 'none' && !entry.canDirectMessage && !hasDirectConversation ? (
          <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => onSendContactRequest(entry.userId)}>
            <UserPlus aria-hidden />
            {t('addContact')}
          </DropdownMenuItem>
        ) : null}
        {!isSelf && !blockedByMe && entry.relationship === 'pending_incoming' ? (
          <>
            <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => onRespondContactRequest(entry.userId, 'accept')}>
              <Check aria-hidden />
              {t('acceptContactRequest')}
            </DropdownMenuItem>
            <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => onRespondContactRequest(entry.userId, 'decline')}>
              <X aria-hidden />
              {t('declineContactRequest')}
            </DropdownMenuItem>
          </>
        ) : null}
        {!isSelf && !blockedByMe && entry.relationship === 'pending_outgoing' ? (
          <DropdownMenuItem disabled className={CHAT_MENU_ITEM_CLASS}>
            {t('memberRequestPending')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => onViewProfile(entry)}>
          <Info aria-hidden />
          {t('memberViewProfile')}
        </DropdownMenuItem>
        {!isSelf && !blockedByMe && !blocked && onBlockContact ? (
          <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => onBlockContact(entry.userId)}>
            <Ban aria-hidden />
            {t('blockContact')}
          </DropdownMenuItem>
        ) : null}
        {!isSelf && blockedByMe && onUnblockContact ? (
          <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => onUnblockContact(entry.userId)}>
            <Ban aria-hidden />
            {t('unblockContact')}
          </DropdownMenuItem>
        ) : null}
        {canManage && rosterHref ? (
          <DropdownMenuItem className={CHAT_MENU_ITEM_CLASS} onClick={() => navigate(rosterHref)}>
            {context.kind === 'class' ? t('memberManageClassRoster') : t('memberManageCourseRoster')}
          </DropdownMenuItem>
        ) : null}
        {canManage && context.kind === 'free' && !isSelf && !entry.isCreator ? (
          <DropdownMenuItem variant="destructive" className={CHAT_MENU_ITEM_CLASS} onClick={() => onRemoveMember(entry.userId)}>
            <Trash aria-hidden />
            {t('memberRemoveFromGroup')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface MemberProfileSheetProps {
  entry: MemberPanelEntry | null;
  contextName: string;
  online: boolean;
  onClose: () => void;
}

export function MemberProfileSheet({ entry, contextName, online, onClose }: MemberProfileSheetProps) {
  const { t } = useTranslation('app');
  return (
    <Sheet open={entry !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>{t('memberProfileTitle')}</SheetTitle>
        </SheetHeader>
        {entry ? (
          <div className="space-y-4 px-4 pb-4">
            <div className="flex items-center gap-3">
              <span className="relative shrink-0">
                <Avatar>
                  <AvatarFallback>{initialsOf(entry.displayName)}</AvatarFallback>
                </Avatar>
                {online ? (
                  <span className="absolute right-0 bottom-0 size-2.5 rounded-full bg-green-500 ring-2 ring-background" />
                ) : null}
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">{entry.displayName}</p>
                <p className="truncate text-sm text-muted-foreground">@{entry.username}</p>
              </div>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('memberProfileRole')}</dt>
                <dd className="font-medium">{roleLabel(entry.role, t)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('memberProfileContext')}</dt>
                <dd className="truncate font-medium">{contextName}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('memberProfileRelationship')}</dt>
                <dd className="font-medium">{relationshipLabel(entry, t)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('memberProfilePresence')}</dt>
                <dd className="font-medium">{online ? t('onlineNow') : t('memberOffline')}</dd>
              </div>
              {entry.isCreator ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t('memberProfileGroupRole')}</dt>
                  <dd className="font-medium">{t('memberCreatorBadge')}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

interface MemberPanelProps {
  conversation: ConversationView;
  bundle: MemberPanelBundle;
  myId: string | undefined;
  onlineUsers: Record<string, boolean>;
  readMarkers: Record<string, number>;
  newestSeq: number;
  onViewProfile: (entry: MemberPanelEntry) => void;
}

export function MemberPanel({
  conversation, bundle, myId, onlineUsers, readMarkers, newestSeq, onViewProfile,
}: MemberPanelProps) {
  const { t } = useTranslation('app');
  const { context, entries, failed, notice } = bundle;
  const typeLabel = context.kind === 'class'
    ? t('memberTypeClass')
    : context.kind === 'course'
      ? (context.subgroup ? t('memberTypeGroup') : t('memberTypeCourse'))
      : t('memberTypeFree');
  const primaryRoles: MemberPanelEntry['role'][] = context.kind === 'free' ? ['admin'] : ['teacher'];
  const secondaryRoles: MemberPanelEntry['role'][] = context.kind === 'free' ? ['member'] : ['student'];
  const primary = entries?.filter((e) => primaryRoles.includes(e.role)) ?? [];
  const secondary = entries?.filter((e) => secondaryRoles.includes(e.role)) ?? [];

  const memberRow = (entry: MemberPanelEntry) => {
    const seen = newestSeq > 0 && (readMarkers[entry.userId] ?? 0) >= newestSeq;
    const online = Boolean(onlineUsers[entry.userId]);
    return (
      <li key={entry.userId} data-testid={`member-panel-row-${entry.userId}`} className="flex flex-wrap items-center gap-2">
        <MemberActionMenu
          entry={entry}
          myId={myId}
          context={context}
          canManage={Boolean(conversation.canManage)}
          hasDirectConversation={bundle.directPartnerIds.has(entry.userId)}
          triggerLabel={t('memberMenuLabel', { name: entry.displayName })}
          triggerClassName="flex min-w-36 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-muted"
          onMessageMember={bundle.onMessageMember}
          onSendContactRequest={bundle.onSendContactRequest}
          onRespondContactRequest={bundle.onRespondContactRequest}
          onRemoveMember={bundle.onRemoveMember}
          onViewProfile={onViewProfile}
          isBlockedByMe={bundle.blockedIds?.has(entry.userId)}
          onBlockContact={bundle.onBlockContact}
          onUnblockContact={bundle.onUnblockContact}
        >
          <span className="relative shrink-0">
            <Avatar>
              <AvatarFallback>{initialsOf(entry.displayName)}</AvatarFallback>
            </Avatar>
            {online ? (
              <span className="absolute right-0 bottom-0 size-2.5 rounded-full bg-green-500 ring-2 ring-background" />
            ) : null}
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="block break-words">{entry.displayName}</span>
            <span className="block text-xs text-muted-foreground">@{entry.username}</span>
            {online ? (
              <span className="block text-xs font-medium text-green-600">{t('onlineNow')}</span>
            ) : null}
          </span>
        </MemberActionMenu>
        {entry.isCreator ? <Badge variant="outline">{t('memberCreatorBadge')}</Badge> : null}
        <Badge variant="secondary">{roleLabel(entry.role, t)}</Badge>
        <Badge variant={seen ? 'secondary' : 'outline'}>
          {seen ? t('memberSeenState') : t('memberNotSeenState')}
        </Badge>
      </li>
    );
  };

  return (
    <div className="space-y-3 px-3 py-2" data-testid="member-panel">
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t('memberInfoName')}</dt>
          <dd className="truncate font-medium">{conversation.name ?? context.name}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t('memberInfoType')}</dt>
          <dd className="font-medium">{typeLabel}</dd>
        </div>
        {context.kind !== 'free' && context.parentName ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('memberInfoBelongsTo')}</dt>
            <dd className="truncate font-medium">{context.parentName}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t('conversationMembersTitle')}</dt>
          <dd className="font-medium">{t('conversationMembersCount', { count: conversation.members.length })}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t('memberInfoChatState')}</dt>
          <dd className="font-medium">
            {(conversation.enabled ?? true) ? t('memberChatOn') : t('memberChatOff')}
          </dd>
        </div>
      </dl>
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      <h4 className="text-sm font-medium">{t('conversationMembersTitle')}</h4>
      {entries === null && !failed ? (
        <p className="text-sm text-muted-foreground">{t('memberPanelLoading')}</p>
      ) : null}
      {failed ? <p role="alert" className="text-sm">{t('rosterLoadFailed')}</p> : null}
      {entries !== null && entries.length === 0 && !failed ? (
        <p className="text-sm text-muted-foreground">{t('memberPanelEmpty')}</p>
      ) : null}
      {primary.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {context.kind === 'free' ? t('memberGroupAdmins') : t('memberGroupTeachers')}
          </p>
          <ul className="space-y-1">{primary.map(memberRow)}</ul>
        </div>
      ) : null}
      {secondary.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {context.kind === 'free' ? t('memberGroupMembers') : t('memberGroupStudents')}
          </p>
          <ul className="space-y-1">{secondary.map(memberRow)}</ul>
        </div>
      ) : null}
    </div>
  );
}

export function useMemberProfile() {
  const [entry, setEntry] = useState<MemberPanelEntry | null>(null);
  return {
    entry,
    open: (next: MemberPanelEntry) => setEntry(next),
    close: () => setEntry(null),
  };
}
