import type {
  Class,
  ClassCreate,
  ClassEnrolment,
  ClassJoinResult,
  ClassPatch,
} from '@giaokhoa/shared/classes';

/** Các thay đổi lớp và ghi danh phải nguyên tử với việc cấp, thu hồi vai trò trong phạm vi lớp. */
export interface ClassesRepository {
  listCandidates(actorId: string): Promise<Class[]>;
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
  /** Kiểm tra mã băm, hạn dùng, giới hạn lượt và trạng thái ghi danh cùng giao dịch để tránh ghi danh vượt mức. */
  join(codeHash: string, actorId: string, now: Date): Promise<ClassJoinResult>;
  listEnrolments(classId: string): Promise<ClassEnrolment[]>;
  /** Chỉ chuyển trạng thái hợp lệ; kết quả rỗng nghĩa là không thể thực hiện hành động trên thành viên đó. */
  changeEnrolment(
    classId: string,
    userId: string,
    actorId: string,
    action: 'approve' | 'suspend' | 'leave',
  ): Promise<ClassEnrolment | undefined>;
}
