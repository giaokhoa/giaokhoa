import type {
  Class,
  ClassCreate,
  ClassEnrolment,
  ClassJoinResult,
  ClassPatch,
} from '@giaokhoa/shared/classes';

export interface ClassesRepository {
  create(input: ClassCreate, actorId: string): Promise<Class>;
  findById(id: string): Promise<Class | undefined>;
  update(id: string, actorId: string, patch: ClassPatch): Promise<Class | undefined>;
  createJoinCode(
    classId: string,
    actorId: string,
    codeHash: string,
    expiresAt: Date,
    maxUses?: number,
  ): Promise<string | undefined>;
  revokeJoinCode(classId: string, codeId: string, actorId: string): Promise<boolean>;
  join(codeHash: string, actorId: string, now: Date): Promise<ClassJoinResult>;
  listEnrolments(classId: string): Promise<ClassEnrolment[]>;
  changeEnrolment(
    classId: string,
    userId: string,
    actorId: string,
    action: 'approve' | 'suspend' | 'leave',
  ): Promise<ClassEnrolment | undefined>;
}
