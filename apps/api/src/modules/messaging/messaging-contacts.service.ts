import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { MessagingRepository } from '@giaokhoa/db/repositories/messaging';
import { MessagingRealtimeService } from './messaging-realtime.service';
import { MessagingNotificationsService } from './messaging-notifications.service';

export interface PersonSummaryView {
  userId: string;
  displayName: string;
  username: string;
}

export type ContactRelationship = 'contact' | 'pending_incoming' | 'pending_outgoing' | 'blocked' | 'none';

export function displayNameOf(user: { firstName: string; lastName: string; username: string }): string {
  const name = `${user.firstName} ${user.lastName}`.trim();
  return name || user.username;
}

export class MessagingContactsService {
  constructor(
    private readonly repo: MessagingRepository,
    private readonly users: UsersService,
    private readonly realtime: MessagingRealtimeService,
    private readonly notifications: MessagingNotificationsService,
  ) {}


  async requestContact(userId: string, contactId: string): Promise<{ status: 'pending' | 'accepted'; contacts: string[] }> {
    if (contactId === userId) throw new BadRequestException({ message: 'You cannot add yourself as a contact', code: 'messaging.contact_self' });
    await this.users.getUser(contactId);
    if (await this.repo.isContact(userId, contactId)) {
      return { status: 'accepted', contacts: await this.repo.listContacts(userId) };
    }
    if (await this.repo.isBlocked(contactId, userId) || await this.repo.isBlocked(userId, contactId)) {
      throw new ForbiddenException({ message: 'A block between you and this user prevents contact requests', code: 'messaging.contact_blocked' });
    }
    if (await this.repo.getContactRequest(contactId, userId)) {
      await this.repo.deleteContactRequest(contactId, userId);
      await this.repo.addContactPair(userId, contactId);
      return { status: 'accepted', contacts: await this.repo.listContacts(userId) };
    }
    const existing = await this.repo.getContactRequest(userId, contactId);
    if (!existing) {
      await this.repo.createContactRequest(userId, contactId);
      const created = await this.repo.getContactRequest(userId, contactId);
      await this.notifications.notify(contactId, 'contact_request', {
        subject: 'New contact request',
        body: 'You have a new contact request. Open your messages to accept or decline it.',
        fromUserId: userId,
        eventId: `contact-request-${userId}-${contactId}-${created?.createdAt.getTime() ?? 0}`,
      });
    }
    return { status: 'pending', contacts: await this.repo.listContacts(userId) };
  }

  async listContactRequests(userId: string): Promise<{
    incoming: { userId: string; createdAt: Date; displayName: string; username: string }[];
    outgoing: { userId: string; createdAt: Date; displayName: string; username: string }[];
  }> {
    const incoming = await this.repo.listIncomingContactRequests(userId);
    const outgoing = await this.repo.listOutgoingContactRequests(userId);
    const profiles = await this.profilesFor([
      ...incoming.map((r) => r.userIdFrom),
      ...outgoing.map((r) => r.userIdTo),
    ]);
    const withProfile = (id: string, createdAt: Date) => ({
      userId: id,
      createdAt,
      displayName: profiles[id]?.displayName ?? id,
      username: profiles[id]?.username ?? '',
    });
    return {
      incoming: incoming.map((r) => withProfile(r.userIdFrom, r.createdAt)),
      outgoing: outgoing.map((r) => withProfile(r.userIdTo, r.createdAt)),
    };
  }

  async profilesFor(userIds: string[]): Promise<Record<string, PersonSummaryView>> {
    const unique = [...new Set(userIds)];
    const out: Record<string, PersonSummaryView> = {};
    if (!unique.length) return out;
    const rows = await this.users.getUsersByIds(unique);
    for (const row of rows) {
      out[row.id] = { userId: row.id, displayName: displayNameOf(row), username: row.username };
    }
    return out;
  }

  async getPersonProfile(viewerId: string, targetId: string): Promise<{ userId: string; displayName: string; username: string; email: string }> {
    if (viewerId !== targetId && !(await this.repo.sharesDirectConversation(viewerId, targetId)) && !(await this.users.canViewUserIdentity(viewerId, targetId))) {
      throw new NotFoundException({ message: `Person profile ${targetId} not found`, code: 'messaging.person_profile_not_found' });
    }
    const row = await this.users.getUser(targetId);
    return { userId: row.id, displayName: displayNameOf(row), username: row.username, email: row.email };
  }

  async acceptContactRequest(userId: string, requesterId: string): Promise<{ contacts: string[] }> {
    await this.users.getUser(requesterId);
    const request = await this.repo.getContactRequest(requesterId, userId);
    if (!request) throw new NotFoundException({ message: `No pending contact request from ${requesterId}`, code: 'messaging.contact_request_not_found' });
    await this.repo.deleteContactRequest(requesterId, userId);
    await this.repo.addContactPair(userId, requesterId);
    return { contacts: await this.repo.listContacts(userId) };
  }

  async declineContactRequest(userId: string, requesterId: string): Promise<{ declined: boolean }> {
    await this.users.getUser(requesterId);
    const request = await this.repo.getContactRequest(requesterId, userId);
    if (!request) throw new NotFoundException({ message: `No pending contact request from ${requesterId}`, code: 'messaging.contact_request_not_found' });
    await this.repo.deleteContactRequest(requesterId, userId);
    return { declined: true };
  }

  async removeContact(userId: string, contactId: string): Promise<{ contacts: string[] }> {
    await this.users.getUser(contactId);
    await this.repo.removeContactPair(userId, contactId);
    return { contacts: await this.repo.listContacts(userId) };
  }

  async listContacts(userId: string): Promise<string[]> {
    return this.repo.listContacts(userId);
  }


  async assertCanContact(senderId: string, recipientId: string): Promise<void> {
    if (await this.repo.isContact(recipientId, senderId)) return;
    const blockedEitherWay = (await this.repo.isBlocked(senderId, recipientId))
      || (await this.repo.isBlocked(recipientId, senderId));
    if (!blockedEitherWay && await this.repo.findTeacherStudentSharedCourseId(senderId, recipientId)) return;
    if (!blockedEitherWay && await this.repo.findTeacherStudentSharedClassId(senderId, recipientId)) return;
    throw new ForbiddenException({
      message: 'You can only message a contact directly — send a contact request from the course member list and wait for it to be accepted',
      code: 'messaging.not_a_contact',
    });
  }


  async blockContact(userId: string, blockedUserId: string): Promise<{ blocked: string[] }> {
    if (blockedUserId === userId) throw new BadRequestException({ message: 'You cannot block yourself', code: 'messaging.block_self' });
    await this.users.getUser(blockedUserId);
    await this.repo.block(userId, blockedUserId);
    return { blocked: await this.repo.listBlocked(userId) };
  }

  async unblockContact(userId: string, blockedUserId: string): Promise<{ blocked: string[] }> {
    await this.repo.unblock(userId, blockedUserId);
    await this.realtime.rejoinDirectConversationAfterUnblock(userId, blockedUserId);
    return { blocked: await this.repo.listBlocked(userId) };
  }

  async listBlocked(userId: string): Promise<string[]> {
    return this.repo.listBlocked(userId);
  }

  async isBlockedBy(blockerId: string, senderId: string): Promise<boolean> {
    return this.repo.isBlocked(blockerId, senderId);
  }
}
