import { useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import '#config/i18n';
import { useAuth } from '#lib/auth';
import type { MessagingRealtimeHandle } from '../api/messaging-socket';
import { PageShell } from '#components/page-shell';
import { ChatPanel } from '../components/chat-panel';
import { ConversationSidebar } from '../components/conversation-sidebar';
import type { SelfPresenceChoice } from '../components/own-profile-sheet';
import { useConversationList } from '../hooks/use-conversation-list';
import { useConversationRestore } from '../hooks/use-conversation-restore';
import { useActiveConversation } from '../hooks/use-active-conversation';
import { useMessageComposer } from '../hooks/use-message-composer';
import { useMessageSearch } from '../hooks/use-message-search';
import { useMessagesRealtime } from '../hooks/use-messages-realtime';
import { useContacts } from '../hooks/use-contacts';
import { useGroupActions } from '../hooks/use-group-actions';
import { useMessageModeration } from '../hooks/use-message-moderation';
import { useMemberPanelData } from '../hooks/use-member-panel-data';
import type { ContactRelationship, ConversationView } from '../types/types';


function useLateCallback<Fn extends (...args: never[]) => unknown>() {
  const ref = useRef<Fn | null>(null);
  const call = useCallback((...args: Parameters<Fn>): ReturnType<Fn> | undefined => {
    return ref.current?.(...args) as ReturnType<Fn> | undefined;
  }, []);
  const assign = useCallback((fn: Fn) => {
    ref.current = fn;
  }, []);
  return [call, assign] as const;
}

export function MessagesPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const myId = user?.id;
  const [selfPresence, setSelfPresence] = useState<SelfPresenceChoice>('online');
  const realtimeRef = useRef<MessagingRealtimeHandle | null>(null);
  const lastSeqRef = useRef<Map<string, number>>(new Map());

  const [openCall, assignOpen] = useLateCallback<(conv: ConversationView) => Promise<void>>();
  const [applyReadMarkerCall, assignApplyReadMarker] =
    useLateCallback<(conversationId: string, userId: string, lastReadSeq: number) => void>();
  const [patchPanelCall, assignPatchPanel] =
    useLateCallback<(userId: string, relationship: ContactRelationship) => void>();
  const [removeMemberCall, assignRemoveMember] = useLateCallback<(userId: string) => Promise<void>>();

  const list = useConversationList({
    myId,
    applyReadMarker: applyReadMarkerCall,
    lastSeqRef,
  });

  const activeHook = useActiveConversation({
    mergePeople: list.mergePeople,
    markRead: list.markRead,
    myId,
    lastSeqRef,
    realtimeRef,
  });
  assignApplyReadMarker(activeHook.applyReadMarker);

  const composer = useMessageComposer({
    active: activeHook.active,
    myId,
    addLocalMessage: activeHook.addLocalMessage,
    setLocalMessageStatus: activeHook.setLocalMessageStatus,
    mergeServerMessages: activeHook.mergeServerMessages,
    lastSeqRef,
    realtimeRef,
  });

  const search = useMessageSearch({
    active: activeHook.active,
    messages: activeHook.messages,
    ensurePageLoaded: activeHook.ensurePageLoaded,
  });

  useMessagesRealtime({
    myId,
    markRead: list.markRead,
    recountUnread: list.recountUnread,
    reload: list.reload,
    activeRef: activeHook.activeRef,
    lastSeqRef,
    mergeServerMessages: activeHook.mergeServerMessages,
    patchMessages: activeHook.patchMessages,
    applyReadMarker: activeHook.applyReadMarker,
    invalidateConversationWindow: activeHook.invalidateConversationWindow,
    setConversations: list.setConversations,
    setArchivedConversations: list.setArchivedConversations,
    setGroupTree: list.setGroupTree,
    setTypingUsers: activeHook.setTypingUsers,
    setOnlineUsers: activeHook.setOnlineUsers,
    realtimeRef,
    suspendRealtime: selfPresence === 'offline',
  });

  const contacts = useContacts({
    reload: list.reload,
    open: openCall,
    patchPanelRelationship: patchPanelCall,
    groupTree: list.groupTree,
    mergePeople: list.mergePeople,
  });

  const memberPanel = useMemberPanelData({
    active: activeHook.active,
    groupTree: list.groupTree,
    myCourses: list.myCourses,
    conversations: list.conversations,
    myId,
    contacts: contacts.contacts,
    incomingRequests: contacts.incomingRequests,
    outgoingRequests: contacts.outgoingRequests,
    blocked: contacts.blocked,
    contactMessage: contacts.contactMessage,
    nameOf: list.nameOf,
    mergePeople: list.mergePeople,
    messageContact: contacts.messageContact,
    sendContactRequestTo: contacts.sendContactRequestTo,
    respondContactRequest: contacts.respondContactRequest,
    removeGroupMember: removeMemberCall,
  });
  assignPatchPanel(memberPanel.patchPanelRelationship);

  const groupActions = useGroupActions({
    active: activeHook.active,
    setConversations: list.setConversations,
    conversations: list.conversations,
    archivedConversations: list.archivedConversations,
    groupTree: list.groupTree,
    nameOf: list.nameOf,
    reload: list.reload,
    open: openCall,
    setPanelRefreshTick: memberPanel.setPanelRefreshTick,
  });
  assignRemoveMember(groupActions.removeGroupMember);

  const moderation = useMessageModeration({
    active: activeHook.active,
    myId,
    patchMessages: activeHook.patchMessages,
    setActionMessage: groupActions.setActionMessage,
  });

  assignOpen(async (conv: ConversationView) => {
    composer.resetComposerForOpen();
    search.clearMessageSearch();
    groupActions.clearActionMessages();
    await activeHook.open(conv);
  });

  useConversationRestore({
    deepLinkId: searchParams.get('conversation'),
    listLoaded: list.listLoaded,
    conversations: list.conversations,
    setConversations: list.setConversations,
    open: openCall,
    sidebarTab: list.sidebarTab,
  });

  const handleSidebarTabChange = (tab: string) => {
    list.setSidebarTab(tab);
    if (tab === 'groups' && activeHook.active && activeHook.active.type !== 2) {
      activeHook.closeConversation();
    }
  };

  const handleSelfPresenceChange = (presence: SelfPresenceChoice) => {
    setSelfPresence(presence);
    if (presence === 'online') void list.reload().catch(() => undefined);
  };

  return (
    <PageShell fillHeight width="full" className="py-6 sm:px-6" contentClassName="mx-auto max-w-[1392px]">
      <div className="flex h-[calc(100dvh-5.5rem)] min-h-0 overflow-hidden rounded-lg border bg-background md:h-[calc(100dvh-7rem)] lg:min-h-[520px]">
        <div
          className={
            activeHook.active
              ? 'hidden min-h-0 w-full min-w-0 flex-col md:flex md:w-[304px] md:shrink-0 md:border-r lg:w-[360px]'
              : 'flex min-h-0 w-full min-w-0 flex-col md:w-[304px] md:shrink-0 md:border-r lg:w-[360px]'
          }
        >
          <ConversationSidebar
            conversations={list.conversations}
            archivedConversations={list.archivedConversations}
            groupTree={list.groupTree}
            active={activeHook.active}
            error={list.error}
            myId={myId}
            myEmail={user?.email ?? null}
            myUsername={user?.username ?? null}
            selfPresence={selfPresence}
            onSelfPresenceChange={handleSelfPresenceChange}
            onlineUsers={activeHook.onlineUsers}
            onOpenConversation={openCall}
            onOpenConversationById={(conversationId) => void groupActions.openConversationById(conversationId)}
            onOpenClassChat={(classId) => void groupActions.openClassChat(classId)}
            onOpenCourseChat={(courseId) => void groupActions.openCourseChat(courseId)}
            onOpenGroupConversation={(groupId) => void groupActions.openGroupConversation(groupId)}
            canCreateFreeGroup={groupActions.canCreateFreeGroup}
            onCreateFreeGroup={groupActions.createFreeGroup}
            groupCreateError={groupActions.groupCreateError}
            stateError={list.stateError}
            nameOf={list.nameOf}
            tab={list.sidebarTab}
            onTabChange={handleSidebarTabChange}
            contacts={contacts.contacts}
            contactMessage={contacts.contactMessage}
            incomingRequests={contacts.incomingRequests}
            outgoingRequests={contacts.outgoingRequests}
            blocked={contacts.blocked}
            blockMessage={contacts.blockMessage}
            onMessageContact={contacts.messageContact}
            onSendContactRequest={contacts.sendContactRequestTo}
            onRespondContactRequest={contacts.respondContactRequest}
            onUnblockContact={contacts.unblockContact}
            pickerContext={contacts.pickerContext}
            onSelectPickerContext={(context) => void contacts.openPickerContext(context)}
            pickerClasses={contacts.pickerClasses}
            pickerCourses={list.myCourses}
            pickerMembers={contacts.pickerMembers}
            pickerRosterError={contacts.pickerError}
            pickerRosterCursor={contacts.pickerCursor}
            onLoadMorePicker={() => void contacts.loadMorePicker()}
            loading={!list.listLoaded && !list.error}
            groupTreeLoading={list.groupTreeLoading}
            groupTreeError={list.groupTreeError}
            archivedLoading={list.archivedLoading}
            archivedError={list.archivedError}
            onRetryArchived={list.retryArchived}
          />
        </div>
        <div className={activeHook.active ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden min-h-0 min-w-0 flex-1 flex-col md:flex'}>
          <ChatPanel
            active={activeHook.active}
            myId={myId}
            onlineUsers={activeHook.onlineUsers}
            readMarkers={activeHook.readMarkers}
            onBack={activeHook.closeConversation}
            blocked={contacts.blocked}
            onUnblockContact={contacts.unblockContact}
            onBlockContact={contacts.blockContact}
            onReportConversation={groupActions.reportActiveConversation}
            onToggleChat={groupActions.toggleActiveChat}
            reportMessage={groupActions.reportMessage}
            actionMessage={groupActions.actionMessage}
            hasMoreBefore={activeHook.hasMoreBefore}
            onLoadOlder={activeHook.loadOlder}
            selectedForBulk={moderation.selectedForBulk}
            setSelectedForBulk={moderation.setSelectedForBulk}
            onBulkRemove={moderation.bulkRemoveSelected}
            visibleMessages={activeHook.visibleMessages}
            nameOf={list.nameOf}
            onRetrySend={composer.retrySend}
            onDeleteMessage={moderation.deleteMessage}
            canRecall={moderation.canRecall}
            onRecallMessage={moderation.recallMessage}
            onHardDeleteMessage={moderation.hardDeleteMessage}
            onUpdateConversationState={list.updateConversationState}
            people={list.people}
            loading={!list.listLoaded && !list.error}
            typingNames={activeHook.typingNames}
            draft={composer.draft}
            setDrafts={composer.setDrafts}
            onNoteTyping={composer.noteTyping}
            onSend={composer.send}
            sendError={composer.sendError}
            sendInFlight={!!activeHook.active && composer.sendingConversationIds.has(activeHook.active.id)}
            replyTarget={composer.replyTarget}
            onStartReply={(m) => composer.setReplyTargets((prev) => ({ ...prev, [m.conversationId]: m }))}
            onCancelReply={() => {
              if (activeHook.active) composer.setReplyTargets((prev) => ({ ...prev, [activeHook.active!.id]: null }));
            }}
            onJumpToQuote={(quote) => void search.jumpToQuotedMessage(quote)}
            highlightedMessageId={search.highlightedMessageId}
            scrollerRef={search.scrollerRef}
            messageSearch={search.messageSearch}
            onSearchMessages={(q) => void search.runMessageSearch(q)}
            onClearMessageSearch={search.clearMessageSearch}
            onJumpToSearchResult={(result) => void search.jumpToMessage(result.id, result.seq)}
            memberPanel={memberPanel.memberPanel}
          />
        </div>
      </div>
    </PageShell>
  );
}

export default MessagesPage;

export { RouteErrorBoundary as ErrorBoundary } from '#components/route-error-boundary';
import { appKeyMeta } from '#lib/route-meta';
export function meta() {
  return appKeyMeta('navMessages');
}
