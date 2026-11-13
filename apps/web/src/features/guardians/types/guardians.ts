
export interface GuardianMyStudentEntry {
  student: { id: string; firstName: string; lastName: string; username: string };
}

export interface GuardianLinkView {
  id: string;
  tenantId: string;
  guardianUserId: string;
  studentUserId: string;
  relationship: string;
  status: string;
  createdBy: string;
  revokedBy: string | null;
  revokedAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGuardianLinkDraft {
  guardianUserId: string;
  studentUserId: string;
  relationship: string;
  note?: string;
}
