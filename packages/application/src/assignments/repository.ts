import type {
  Assignment,
  AssignmentCreate,
  AssignmentPatch,
  AssignmentRecipient,
  StudentAssignment,
} from '@giaokhoa/shared/assignments';

export interface AssignmentsRepository {
  create(actorId: string, input: AssignmentCreate): Promise<Assignment | undefined>;
  findById(id: string): Promise<Assignment | undefined>;
  updateDraft(id: string, actorId: string, patch: AssignmentPatch): Promise<Assignment | undefined>;
  publish(id: string, actorId: string): Promise<Assignment | undefined>;
  listRecipients(id: string, actorId: string): Promise<AssignmentRecipient[] | undefined>;
  revokeRecipient(id: string, userId: string, actorId: string): Promise<boolean>;
  getDelivery(id: string, actorId: string, now: Date): Promise<StudentAssignment | undefined>;
}
