import { apiJson } from '#lib/api';
import type {
  ContactRequestView,
  ConversationDetailView,
  ConversationGroupTreeView,
  ConversationStatePatch,
  ConversationStateView,
  ConversationView,
  MessageSearchResultView,
  MessageView,
  MessagingCourse,
  PersonSummary,
  RosterMember,
} from '../types/types';


export function fetchMessagingGroupTree() {
  return apiJson<ConversationGroupTreeView>('/api/v1/messages/group-tree');
}

export function fetchMessagingConversations() {
  return apiJson<ConversationView[]>('/api/v1/messages/conversations');
}

export interface PersonProfileServer {
  userId: string;
  displayName: string;
  username: string;
  email: string;
}

export function fetchMessagingPersonProfile(userId: string) {
  return apiJson<PersonProfileServer>(`/api/v1/messages/users/${userId}/profile`);
}

export function fetchMessagingArchivedConversations() {
  return apiJson<ConversationView[]>('/api/v1/messages/conversations?archived=true');
}

export function fetchMessagingBlockedContacts() {
  return apiJson<{ blocked: string[]; profiles?: Record<string, PersonSummary> }>('/api/v1/messages/contacts/blocked');
}

export function fetchMessagingContacts() {
  return apiJson<{ contacts: string[]; profiles?: Record<string, PersonSummary> }>('/api/v1/messages/contacts');
}

export function fetchMessagingContactRequests() {
  return apiJson<{ incoming: ContactRequestView[]; outgoing: ContactRequestView[] }>(
    '/api/v1/messages/contacts/requests',
  );
}

export function fetchMessagingCourses() {
  return apiJson<{ courses: MessagingCourse[] }>('/api/v1/messages/courses');
}

export function fetchConversationDetail(conversationId: string) {
  return apiJson<ConversationDetailView>(`/api/v1/messages/conversations/${conversationId}`);
}

export function fetchConversationMessagesPage(conversationId: string, beforeSeq: number) {
  return apiJson<{ messages: MessageView[]; hasMoreBefore: boolean }>(
    `/api/v1/messages/conversations/${conversationId}/messages?beforeSeq=${beforeSeq}&limit=50`,
  );
}

export function searchConversationMessages(conversationId: string, q: string) {
  return apiJson<{ results: MessageSearchResultView[] }>(
    `/api/v1/messages/conversations/${conversationId}/search?q=${encodeURIComponent(q)}&limit=50`,
  );
}

export function fetchRosterPage(url: string) {
  return apiJson<{ members: RosterMember[]; nextCursor: string | null }>(url);
}

export function fetchClassConversation(classId: string) {
  return apiJson<ConversationView>(`/api/v1/messages/classes/${classId}/conversation`);
}

export function fetchCourseConversation(courseId: string) {
  return apiJson<ConversationView>(`/api/v1/messages/courses/${courseId}/conversation`);
}

export function setConversationState(conversationId: string, patch: ConversationStatePatch) {
  return apiJson<ConversationStateView>(`/api/v1/messages/conversations/${conversationId}/state`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function markConversationRead(conversationId: string) {
  return apiJson<{ marked: number; lastReadSeq: number }>(`/api/v1/messages/conversations/${conversationId}/read`, {
    method: 'POST',
    body: '{}',
  });
}

export function setContactBlocked(userId: string, block: boolean) {
  return apiJson<{ blocked: string[] }>(`/api/v1/messages/contacts/${userId}/block`, {
    method: block ? 'POST' : 'DELETE',
    ...(block ? { body: '{}' } : {}),
  });
}

export function sendMessage(conversationId: string, body: Record<string, unknown>) {
  return apiJson<MessageView>(`/api/v1/messages/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function sendContactRequest(userId: string) {
  return apiJson<{ status: 'pending' | 'accepted' }>(`/api/v1/messages/contacts/${userId}`, {
    method: 'POST',
    body: '{}',
  });
}

export function respondContactRequest(userId: string, action: 'accept' | 'decline') {
  return apiJson(`/api/v1/messages/contacts/requests/${userId}/${action}`, { method: 'POST', body: '{}' });
}

export function createDirectConversation(userId: string) {
  return apiJson<ConversationView>('/api/v1/messages/conversations', {
    method: 'POST',
    body: JSON.stringify({ memberIds: [userId] }),
  });
}

export function createGroupConversation(groupId: string) {
  return apiJson<ConversationView>('/api/v1/messages/conversations/group', {
    method: 'POST',
    body: JSON.stringify({ groupId }),
  });
}

export function createFreeGroup(name: string, memberIds: string[]) {
  return apiJson<ConversationView>('/api/v1/messages/conversations', {
    method: 'POST',
    body: JSON.stringify({ type: 2, name, memberIds }),
  });
}

export function reportConversation(conversationId: string) {
  return apiJson(`/api/v1/messages/conversations/${conversationId}/report`, { method: 'POST', body: '{}' });
}

export function removeConversationMember(conversationId: string, userId: string) {
  return apiJson<ConversationView>(`/api/v1/messages/conversations/${conversationId}/members/${userId}`, {
    method: 'DELETE',
  });
}

export function setConversationEnabled(conversationId: string, enabled: boolean) {
  return apiJson<ConversationView>(`/api/v1/messages/conversations/${conversationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

export function deleteMessageForMe(messageId: string) {
  return apiJson<MessageView>(`/api/v1/messages/${messageId}`, { method: 'DELETE' });
}

export function recallMessage(messageId: string) {
  return apiJson<MessageView>(`/api/v1/messages/${messageId}/recall`, { method: 'POST', body: '{}' });
}

export function hardDeleteMessage(messageId: string, reason: string) {
  return apiJson(`/api/v1/messages/${messageId}/hard-delete`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function bulkRemoveMessages(messageIds: string[], reason: string) {
  return apiJson('/api/v1/messages/bulk-remove', {
    method: 'POST',
    body: JSON.stringify({ messageIds, reason }),
  });
}
