import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { messagingBlockedContactsQueryOptions, messagingContactRequestsQueryOptions, messagingContactsQueryOptions, rosterPageQueryOptions, useCreateDirectConversation, useRespondContactRequest, useSendContactRequest, useSetContactBlocked } from '../queries/messaging';
import { queryKeys } from '../queries/keys';
import type {
  ContactRelationship,
  ConversationGroupTreeView,
  ConversationView,
  PeoplePickerContext,
  PersonSummary,
  RosterMember,
} from '../types/types';

export interface UseContactsParams {
  reload: () => Promise<void>;
  open: (conv: ConversationView) => Promise<void> | void;
  patchPanelRelationship: (userId: string, relationship: ContactRelationship) => void;
  groupTree: ConversationGroupTreeView | null;
  mergePeople: (profiles: Record<string, PersonSummary> | undefined) => void;
}

export function useContacts({ reload, open, patchPanelRelationship, groupTree, mergePeople }: UseContactsParams) {
  const { t } = useTranslation('app');
  const queryClient = useQueryClient();
  const contactsQuery = useQuery(messagingContactsQueryOptions());
  const requestsQuery = useQuery(messagingContactRequestsQueryOptions());
  const blockedQuery = useQuery(messagingBlockedContactsQueryOptions());
  const contacts = contactsQuery.data?.contacts ?? [];
  const incomingRequests = requestsQuery.data?.incoming ?? [];
  const outgoingRequests = requestsQuery.data?.outgoing ?? [];
  const blocked = blockedQuery.data?.blocked ?? [];
  const [contactMessage, setContactMessage] = useState<string | null>(null);
  const [blockMessage, setBlockMessage] = useState<string | null>(null);

  useEffect(() => {
    mergePeople(contactsQuery.data?.profiles);
  }, [contactsQuery.data, mergePeople]);
  useEffect(() => {
    mergePeople(blockedQuery.data?.profiles);
  }, [blockedQuery.data, mergePeople]);

  const [pickerContext, setPickerContext] = useState<PeoplePickerContext>({ kind: 'contacts' });
  const [pickerUrls, setPickerUrls] = useState<string[]>([]);
  const pickerQueries = useQueries({ queries: pickerUrls.map((url) => rosterPageQueryOptions(url)) });
  const pickerMembers: RosterMember[] = pickerQueries.flatMap((q) => q.data?.members ?? []);
  let pickerCursor: string | null = null;
  for (const q of pickerQueries) {
    if (q.data) pickerCursor = q.data.nextCursor;
  }
  const pickerError = pickerQueries.some((q) => q.isError) ? t('rosterLoadFailed') : null;

  const mergedPickerSigRef = useRef('');
  useEffect(() => {
    if (!pickerMembers.length) return;
    const sig = pickerMembers.map((m) => m.userId).join(',');
    if (sig === mergedPickerSigRef.current) return;
    mergedPickerSigRef.current = sig;
    mergePeople(Object.fromEntries(pickerMembers.map((m) => [m.userId, m])));
  }, [pickerMembers, mergePeople]);

  const contactBlockedMutation = useSetContactBlocked();
  const contactRequestMutation = useSendContactRequest();
  const respondRequestMutation = useRespondContactRequest();
  const directConversationMutation = useCreateDirectConversation();

  async function blockContact(userId: string) {
    setBlockMessage(null);
    try {
      await contactBlockedMutation.mutateAsync({ userId, block: true });
      setBlockMessage(t('contactBlocked'));
    } catch {
      setBlockMessage(t('blockFailed'));
    }
  }

  async function unblockContact(userId: string) {
    setBlockMessage(null);
    try {
      await contactBlockedMutation.mutateAsync({ userId, block: false });
      setBlockMessage(t('contactUnblocked'));
    } catch {
      setBlockMessage(t('unblockFailed'));
    }
  }

  const patchRosterRelationship = useCallback(
    (userId: string, relationship: ContactRelationship) => {
      queryClient.setQueriesData<{ members: RosterMember[]; nextCursor: string | null }>(
        { queryKey: ['messages', 'roster'] },
        (old) =>
          old ? { ...old, members: old.members.map((m) => (m.userId === userId ? { ...m, relationship } : m)) } : old,
      );
    },
    [queryClient],
  );

  async function sendContactRequestTo(userId: string) {
    setContactMessage(null);
    try {
      const res = await contactRequestMutation.mutateAsync(userId);
      setContactMessage(res.status === 'accepted' ? t('contactRequestAccepted') : t('contactRequestSent'));
      patchRosterRelationship(userId, res.status === 'accepted' ? 'contact' : 'pending_outgoing');
      patchPanelRelationship(userId, res.status === 'accepted' ? 'contact' : 'pending_outgoing');
      await reload();
    } catch {
      setContactMessage(t('contactRequestFailed'));
    }
  }

  function pickerRosterUrl(context: PeoplePickerContext, cursor?: string): string | null {
    if (context.kind === 'contacts') return null;
    const base =
      context.kind === 'class'
        ? `/api/v1/messages/classes/${context.id}/members?limit=50`
        : `/api/v1/messages/courses/${context.id}/members?limit=50`;
    return cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
  }

  function openPickerContext(context: PeoplePickerContext) {
    setPickerContext(context);
    mergedPickerSigRef.current = '';
    const url = pickerRosterUrl(context);
    setPickerUrls(url ? [url] : []);
  }

  async function loadMorePicker() {
    if (!pickerCursor) return;
    const url = pickerRosterUrl(pickerContext, pickerCursor);
    if (!url) return;
    if (pickerUrls.includes(url)) {
      await queryClient.refetchQueries({ queryKey: queryKeys.messagingRosterPage(url) });
      return;
    }
    setPickerUrls((prev) => [...prev, url]);
  }

  async function respondContactRequest(userId: string, action: 'accept' | 'decline') {
    setContactMessage(null);
    try {
      await respondRequestMutation.mutateAsync({ userId, action });
      patchRosterRelationship(userId, action === 'accept' ? 'contact' : 'none');
      patchPanelRelationship(userId, action === 'accept' ? 'contact' : 'none');
      await reload();
    } catch {
      setContactMessage(t('contactRequestFailed'));
    }
  }

  async function messageContact(userId: string) {
    const conv = await directConversationMutation.mutateAsync(userId);
    await reload();
    await open(conv);
  }

  const pickerClasses = groupTree?.classes.map((c) => ({ classId: c.classId, name: c.name })) ?? [];

  return {
    contacts,
    incomingRequests,
    outgoingRequests,
    contactMessage,
    blocked,
    blockMessage,
    pickerContext,
    pickerMembers,
    pickerCursor,
    pickerError,
    blockContact,
    unblockContact,
    patchRosterRelationship,
    sendContactRequestTo,
    pickerRosterUrl,
    openPickerContext,
    loadMorePicker,
    respondContactRequest,
    messageContact,
    pickerClasses,
  };
}
