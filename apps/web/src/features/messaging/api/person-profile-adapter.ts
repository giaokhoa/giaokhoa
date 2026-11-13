import type { PersonSummary } from '../types/types';

export interface PersonProfileView {
  userId: string;
  displayName: string;
  username: string;
  roleLine: string | null;
  bio: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  company: string | null;
  country: string | null;
  timezone: string | null;
  location: string | null;
  availability: string | null;
  tags: string[];
}

export function getPersonProfile(person: PersonSummary, roleLine?: string | null): PersonProfileView {
  return {
    userId: person.userId,
    displayName: person.displayName,
    username: person.username,
    roleLine: roleLine ?? null,
    bio: null,
    email: null,
    phone: null,
    website: null,
    company: null,
    country: null,
    timezone: null,
    location: null,
    availability: null,
    tags: [],
  };
}

export interface SharedFileView {
  id: string;
  name: string;
  sizeLabel?: string;
}

export function getSharedFiles(conversationId: string): SharedFileView[] {
  void conversationId;
  return [];
}

export const QUICK_REPLY_SHAPE_SAMPLES: readonly string[] = ['Xin chào', 'Cảm ơn bạn', 'Đã rõ'];
