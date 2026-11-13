import { useState, type ReactNode } from 'react';
import { BellOff, ChevronDown, MessageSquare, Pin, Search, UserPlus } from 'lucide-react';
import { Avatar, AvatarFallback } from '@giaokhoa/ui/components/avatar';
import { Badge } from '@giaokhoa/ui/components/badge';
import { Button } from '@giaokhoa/ui/components/button';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@giaokhoa/ui/components/collapsible';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@giaokhoa/ui/components/input-group';
import { Separator } from '@giaokhoa/ui/components/separator';
import { Skeleton } from '@giaokhoa/ui/components/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@giaokhoa/ui/components/tabs';
import { cn } from '@giaokhoa/ui/lib/utils';
import { useTranslation } from 'react-i18next';
import { CreateGroupSheet } from './create-group-sheet';
import { GroupListNav, countGroupListEntries } from './group-list-nav';
import { NewMessageDialog } from './new-message-dialog';
import { OwnProfileSheet, type SelfPresenceChoice } from './own-profile-sheet';
import type {
  ContactRequestView,
  ConversationGroupTreeView,
  ConversationView,
  MessagingCourse,
  PeoplePickerContext,
  RosterMember,
} from '../types/types';
import {
  PRESENCE_DOT_CLASS, conversationTime,
  initialsOf, presenceStatusOf,
} from '../utils/utils';

interface ConversationSidebarProps {
  conversations: ConversationView[];
  archivedConversations: ConversationView[];
  groupTree: ConversationGroupTreeView | null;
  active: ConversationView | null;
  error: string | null;
  myId: string | undefined;
  myEmail: string | null;
  myUsername: string | null;
  selfPresence: SelfPresenceChoice;
  onSelfPresenceChange: (presence: SelfPresenceChoice) => void;
  onlineUsers: Record<string, boolean>;
  onOpenConversation: (conversation: ConversationView) => void;
  onOpenConversationById: (conversationId: string) => void;
  onOpenClassChat: (classId: string) => void;
  onOpenCourseChat: (courseId: string) => void;
  onOpenGroupConversation: (groupId: string) => void;
  canCreateFreeGroup: boolean;
  onCreateFreeGroup: (name: string, memberIds: string[]) => Promise<boolean>;
  groupCreateError: string | null;
  stateError: string | null;
  nameOf: (userId: string) => string;
  tab: string;
  onTabChange: (tab: string) => void;
  contacts: string[];
  contactMessage: string | null;
  incomingRequests: ContactRequestView[];
  outgoingRequests: ContactRequestView[];
  blocked: string[];
  blockMessage: string | null;
  onMessageContact: (userId: string) => void;
  onSendContactRequest: (userId: string) => void;
  onRespondContactRequest: (userId: string, action: 'accept' | 'decline') => void;
  onUnblockContact: (userId: string) => void;
  pickerContext: PeoplePickerContext;
  onSelectPickerContext: (context: PeoplePickerContext) => void;
  pickerClasses: { classId: string; name: string }[];
  pickerCourses: MessagingCourse[];
  pickerMembers: RosterMember[];
  pickerRosterError: string | null;
  pickerRosterCursor: string | null;
  onLoadMorePicker: () => void;
  loading?: boolean;
  groupTreeLoading?: boolean;
  groupTreeError?: string | null;
  archivedLoading?: boolean;
  archivedError?: string | null;
  onRetryArchived?: () => void;
}

export function ConversationSidebar({
  conversations, archivedConversations, groupTree, active, error, myId, myEmail, myUsername,
  selfPresence, onSelfPresenceChange, onlineUsers,
  onOpenConversation, onOpenConversationById, onOpenClassChat, onOpenCourseChat, onOpenGroupConversation,
  canCreateFreeGroup, onCreateFreeGroup, groupCreateError,
  stateError, nameOf, tab, onTabChange,
  contacts, contactMessage, incomingRequests, outgoingRequests, blocked, blockMessage,
  onMessageContact, onSendContactRequest, onRespondContactRequest, onUnblockContact,
  pickerContext, onSelectPickerContext, pickerClasses, pickerCourses, pickerMembers,
  pickerRosterError, pickerRosterCursor, onLoadMorePicker, loading, groupTreeLoading, groupTreeError,
  archivedLoading, archivedError, onRetryArchived,
}: ConversationSidebarProps) {
  const { t, i18n } = useTranslation('app');
  const open = onOpenConversation;
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [ownProfileOpen, setOwnProfileOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const [searchText, setSearchText] = useState('');
  const messageContact = (userId: string) => {
    setNewMessageOpen(false);
    onTabChange('all');
    onMessageContact(userId);
  };
  const createFreeGroup = async (name: string, memberIds: string[]) => {
    const created = await onCreateFreeGroup(name, memberIds);
    if (created) {
      setCreateGroupOpen(false);
      onTabChange('groups');
    }
  };
  const labelOf = (c: ConversationView) => {
    if (c.name !== null) return c.name;
    const otherId = c.type === 1 ? c.members.find((id) => id !== myId) : undefined;
    return otherId
      ? nameOf(otherId)
      : t('conversationWithUser', { members: c.members.map((id) => nameOf(id)).join(', ') });
  };
  const filterNeedle = searchText.trim().toLocaleLowerCase('vi');
  const matchesFilter = (c: ConversationView) =>
    !filterNeedle
    || labelOf(c).toLocaleLowerCase('vi').includes(filterNeedle)
    || (c.lastMessage?.fullMessage.toLocaleLowerCase('vi').includes(filterNeedle) ?? false);
  const allCount = conversations.length;
  const unreadCountTotal = conversations.filter((c) => (c.unread ?? 0) > 0).length;
  const groupCount = groupTree ? countGroupListEntries(groupTree) : 0;
  const archivedCount = archivedConversations.length;

  const renderConversationItem = (c: ConversationView) => {
    const isActive = active?.id === c.id;
    const otherId = c.type === 1 ? c.members.find((id) => id !== myId) : undefined;
    const otherPresence = otherId ? onlineUsers[otherId] : undefined;
    const otherStatus = presenceStatusOf(otherPresence);
    const avatarLabel = c.name ?? (otherId ? nameOf(otherId) : labelOf(c));
    const unreadCount = c.unread ?? 0;
    return (
      <li key={c.id}>
          <button
            type="button"
            aria-current={isActive || undefined}
            className={cn(
              'flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2.5 text-left transition-colors',
              isActive ? 'bg-muted ring-1 ring-border ring-inset' : 'hover:bg-muted/75',
            )}
            onClick={() => void open(c)}
          >
            <span className="relative shrink-0">
              <Avatar size="lg">
                <AvatarFallback className={cn(isActive && 'bg-background/50')}>{initialsOf(avatarLabel)}</AvatarFallback>
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
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    c.type === 2 ? 'font-semibold text-foreground' : 'font-medium text-foreground/90',
                  )}
                >
                  {labelOf(c)}
                </span>
                {c.lastMessage ? (
                  <span className="shrink-0 text-xs leading-5 text-muted-foreground tabular-nums" data-testid={`conversation-last-time-${c.id}`}>
                    {conversationTime(c.lastMessage.createdAt, t, i18n.language)}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5">
                {c.lastMessage ? (
                  <span className="min-w-0 flex-1 truncate text-xs leading-4 text-muted-foreground">
                    {c.lastMessage.userIdFrom === myId
                      ? `${t('lastMessageOwnPrefix')} `
                      : c.type === 1
                        ? ''
                        : `${nameOf(c.lastMessage.userIdFrom)}: `}
                    {c.lastMessage.fullMessage}
                  </span>
                ) : (
                  <span className="min-w-0 flex-1" />
                )}
                {c.pinnedAt ? (
                  <span data-testid={`conversation-pinned-${c.id}`} className="grid size-5 shrink-0 place-items-center">
                    <Pin className="size-3 fill-current opacity-70" aria-hidden />
                  </span>
                ) : null}
                {c.muted ? (
                  <span data-testid={`conversation-muted-${c.id}`} className="grid size-5 shrink-0 place-items-center">
                    <BellOff className="size-3 text-muted-foreground" aria-hidden />
                  </span>
                ) : null}
                {unreadCount > 0
                  ? c.muted
                    ? <span className="shrink-0 text-xs opacity-60">{t('unreadSuffix', { count: unreadCount })}</span>
                    : (
                      <>
                        <Badge className="h-5 min-w-5 shrink-0 justify-center rounded-full px-1">{unreadCount}</Badge>
                        <span className="sr-only">{t('unreadSuffix', { count: unreadCount })}</span>
                      </>
                    )
                  : null}
              </span>
            </span>
          </button>
      </li>
    );
  };

  const conversationsById = new Map(conversations.map((c) => [c.id, c]));
  const initialLoading = Boolean(loading) && conversations.length === 0 && !error;

  const renderSection = (
    title: string,
    open: boolean,
    onOpenChange: (next: boolean) => void,
    children: ReactNode,
  ) => (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 pb-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
        <span>{title}</span>
        <ChevronDown aria-hidden className={cn('ml-auto size-3 shrink-0 transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>{open ? children : null}</CollapsibleContent>
    </Collapsible>
  );

  const renderConversationPanel = (
    unreadOnly: boolean,
    source: ConversationView[] = conversations,
    emptyText?: string,
    panelStatus?: { loading: boolean; error: string | null; onRetry?: () => void },
  ) => {
    const visible = source
      .filter(matchesFilter)
      .filter((c) => (unreadOnly ? (c.unread ?? 0) > 0 : true));
    const pinned = visible.filter((c) => c.pinnedAt);
    const recent = visible.filter((c) => !c.pinnedAt);
    const panelLoading = panelStatus ? panelStatus.loading && source.length === 0 : initialLoading;
    return (
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2">
        {panelLoading ? (
          <div data-testid="conversations-loading" className="space-y-3 px-2" aria-label={t('conversationsLoading')}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : panelStatus?.error ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <MessageSquare className="size-9 text-muted-foreground/40" aria-hidden />
            <p role="alert" className="text-sm font-medium">{panelStatus.error}</p>
            {panelStatus.onRetry ? (
              <Button type="button" size="sm" variant="outline" onClick={panelStatus.onRetry}>
                {t('retry')}
              </Button>
            ) : null}
          </div>
        ) : (panelStatus ? visible.length === 0 : !error && visible.length === 0) ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <MessageSquare className="size-9 text-muted-foreground/40" aria-hidden />
            <p className="text-sm font-medium">
              {filterNeedle
                ? t('conversationSearchNoResults')
                : emptyText ?? (unreadOnly ? t('conversationsUnreadEmpty') : t('conversationsEmpty'))}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {pinned.length > 0 ? renderSection(
              t('messagesPinnedSection'),
              pinnedOpen,
              setPinnedOpen,
              <ul className="flex flex-col gap-1">{pinned.map(renderConversationItem)}</ul>,
            ) : null}
            {recent.length > 0 ? renderSection(
              t('messagesRecentSection'),
              recentOpen,
              setRecentOpen,
              <ul className="flex flex-col gap-1">{recent.map(renderConversationItem)}</ul>,
            ) : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 py-3">
      <div className="flex items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-center gap-2">
          {myId ? (
            <button
              type="button"
              title={t('myProfile')}
              aria-label={t('myProfile')}
              onClick={() => setOwnProfileOpen(true)}
              className="relative shrink-0 transition-opacity hover:opacity-80"
            >
              <Avatar>
                <AvatarFallback>{initialsOf(nameOf(myId))}</AvatarFallback>
              </Avatar>
              <span
                className={cn(
                  'absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-background',
                  PRESENCE_DOT_CLASS[selfPresence],
                )}
              />
            </button>
          ) : null}
          <h2 className="min-w-0 truncate text-lg font-semibold">{t('messagesTitle')}</h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="relative shrink-0"
          aria-label={t('newMessage')}
          onClick={() => setNewMessageOpen(true)}
        >
          <UserPlus aria-hidden />
          {incomingRequests.length > 0 ? (
            <>
              <Badge className="absolute -top-1 -right-1 h-5 min-w-5 justify-center rounded-full px-1">
                {incomingRequests.length}
              </Badge>
              <span className="sr-only">{t('incomingRequestsTitle')}</span>
            </>
          ) : null}
        </Button>
      </div>
      <Separator />
      {error ? <p role="alert" className="px-3 text-sm">{error}</p> : null}
      {stateError ? <p role="alert" className="px-3 text-sm">{stateError}</p> : null}
      <Tabs
        value={tab}
        onValueChange={(value) => {
          onTabChange(value);
        }}
        className="min-h-0 min-w-0 flex-1 px-3"
      >
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label={tab === 'groups' ? t('groupTreeSearchPlaceholder') : t('conversationSearchLabel')}
            placeholder={tab === 'groups' ? t('groupTreeSearchPlaceholder') : t('conversationSearchPlaceholder')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </InputGroup>
        <TabsList variant="line" className="w-full border-b">
          <TabsTrigger value="all" aria-label={t('messagesFilterAll')} className="gap-1 text-xs font-normal">
            {t('messagesFilterAll')}
            <span aria-hidden className="text-xs text-muted-foreground">({allCount})</span>
          </TabsTrigger>
          <TabsTrigger value="unread" aria-label={t('messagesFilterUnread')} className="gap-1 text-xs font-normal">
            {t('messagesFilterUnread')}
            <span aria-hidden className="text-xs text-muted-foreground">({unreadCountTotal})</span>
          </TabsTrigger>
          <TabsTrigger value="groups" aria-label={t('messagesTabGroups')} className="gap-1 text-xs font-normal">
            {t('messagesTabGroups')}
            <span aria-hidden className="text-xs text-muted-foreground">({groupCount})</span>
          </TabsTrigger>
          <TabsTrigger value="archived" aria-label={t('messagesFilterArchived')} className="gap-1 text-xs font-normal">
            {t('messagesFilterArchived')}
            <span aria-hidden className="text-xs text-muted-foreground">({archivedCount})</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {renderConversationPanel(false)}
        </TabsContent>
        <TabsContent value="unread" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {renderConversationPanel(true)}
        </TabsContent>
        <TabsContent value="groups" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-2">
            <GroupListNav
              tree={groupTree}
              filter={searchText}
              activeConversationId={active?.id ?? null}
              onOpenConversationById={onOpenConversationById}
              onOpenClassChat={onOpenClassChat}
              onOpenCourseChat={onOpenCourseChat}
              onOpenGroupConversation={onOpenGroupConversation}
              canCreateFreeGroup={canCreateFreeGroup}
              onCreateFreeGroup={() => setCreateGroupOpen(true)}
              conversationsById={conversationsById}
              myId={myId}
              nameOf={nameOf}
              loading={initialLoading || Boolean(groupTreeLoading)}
              treeError={groupTreeError ?? null}
            />
          </div>
        </TabsContent>
        <TabsContent value="archived" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {renderConversationPanel(false, archivedConversations, t('archivedEmpty'), {
            loading: Boolean(archivedLoading),
            error: archivedError ?? null,
            onRetry: onRetryArchived,
          })}
        </TabsContent>
      </Tabs>
      <NewMessageDialog
        open={newMessageOpen}
        onOpenChange={setNewMessageOpen}
        incomingRequests={incomingRequests}
        outgoingRequests={outgoingRequests}
        contacts={contacts}
        contactMessage={contactMessage}
        blocked={blocked}
        blockMessage={blockMessage}
        nameOf={nameOf}
        onMessageContact={messageContact}
        onSendContactRequest={onSendContactRequest}
        onRespondContactRequest={onRespondContactRequest}
        onUnblockContact={onUnblockContact}
        pickerContext={pickerContext}
        onSelectPickerContext={onSelectPickerContext}
        pickerClasses={pickerClasses}
        pickerCourses={pickerCourses}
        pickerMembers={pickerMembers}
        pickerRosterError={pickerRosterError}
        pickerRosterCursor={pickerRosterCursor}
        onLoadMorePicker={onLoadMorePicker}
      />
      <CreateGroupSheet
        open={createGroupOpen}
        onOpenChange={setCreateGroupOpen}
        onCreateGroup={(name, memberIds) => void createFreeGroup(name, memberIds)}
        createError={groupCreateError}
        pickerContext={pickerContext}
        onSelectPickerContext={onSelectPickerContext}
        pickerClasses={pickerClasses}
        pickerCourses={pickerCourses}
        pickerMembers={pickerMembers}
        pickerRosterError={pickerRosterError}
        pickerRosterCursor={pickerRosterCursor}
        onLoadMorePicker={onLoadMorePicker}
        contactEntries={contacts.map((userId) => ({ userId, displayName: nameOf(userId) }))}
      />
      {myId ? (
        <OwnProfileSheet
          open={ownProfileOpen}
          onOpenChange={setOwnProfileOpen}
          name={nameOf(myId)}
          usernameLine={myUsername ? `@${myUsername}` : null}
          email={myEmail}
          selfPresence={selfPresence}
          onSelfPresenceChange={onSelfPresenceChange}
        />
      ) : null}
    </div>
  );
}
