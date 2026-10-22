import type {
  Assignment,
  AssignmentPreview,
  AssignmentListItem,
  AssignmentCreate,
  AssignmentPatch,
  AssignmentRecipient,
  StudentAssignment,
} from '@giaokhoa/shared/assignments';

/** Ranh giới lưu trữ bài giao: kiểm lại người tạo, trạng thái và người nhận trong giao dịch thay đổi. */
export interface AssignmentsRepository {
  listCandidates(
    actorId: string,
  ): Promise<Array<Omit<AssignmentListItem, 'capabilities'> & { isRecipient: boolean }>>;
  create(actorId: string, input: AssignmentCreate): Promise<Assignment | undefined>;
  getPreview(id: string, actorId: string): Promise<AssignmentPreview | undefined>;
  findById(id: string): Promise<Assignment | undefined>;
  updateDraft(id: string, actorId: string, patch: AssignmentPatch): Promise<Assignment | undefined>;
  /** Chốt tập người nhận khi công bố; người tham gia lớp muộn không tự được bổ sung. */
  publish(id: string, actorId: string): Promise<Assignment | undefined>;
  listRecipients(id: string, actorId: string): Promise<AssignmentRecipient[] | undefined>;
  revokeRecipient(id: string, userId: string, actorId: string): Promise<boolean>;
  /** Kết quả rỗng khi người yêu cầu không được nhận đề hoặc bài giao chưa đến thời điểm cho phép xem. */
  getDelivery(id: string, actorId: string, now: Date): Promise<StudentAssignment | undefined>;
}
