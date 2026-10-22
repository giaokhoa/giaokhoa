import { assignmentCreateSchema } from '@giaokhoa/shared/assignments';
import type {
  Assignment,
  AssignmentPreview,
  AssignmentCreate,
  AssignmentPatch,
  AssignmentRecipient,
  StudentAssignment,
} from '@giaokhoa/shared/assignments';
import type { AuthorizationService } from '../authorization/service.js';
import { ClientError } from '../common/client-error.js';
import type { AssignmentsRepository } from './repository.js';

/** Quản lý bản nháp, công bố và phân phối bài giao theo quyền lớp và danh sách người nhận đã chốt. */
export class AssignmentsService {
  constructor(
    private readonly repository: AssignmentsRepository,
    private readonly authorization: AuthorizationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private assertClass(actorId: string, classId: string, capability: string) {
    return this.authorization.assertAuthorized({
      actorId,
      capability,
      context: { kind: 'class', resourceKey: classId },
    });
  }

  private async authorized(actorId: string, id: string, capability: string) {
    const assignment = await this.repository.findById(id);
    if (!assignment)
      throw new ClientError('not_found', 'assignment_not_found', 'Bài giao không tồn tại');
    await this.authorization.assertAuthorized({
      actorId,
      capability,
      context: { kind: 'assignment', resourceKey: assignment.id },
    });
    return assignment;
  }

  /** Lọc riêng quyền quản lý, chấm và quyền người nhận; không suy quyền từ người tạo lớp. */
  async list(actorId: string) {
    const candidates = await this.repository.listCandidates(actorId);
    const result = await Promise.all(
      candidates.map(async ({ isRecipient, ...item }) => {
        const access = await this.authorization.checkCapabilities(
          actorId,
          { kind: 'assignment', resourceKey: item.id },
          [
            'assignment:create',
            'assignment:publish',
            'assignment:grade',
            'assignment:view_assigned',
            'assignment:attempt',
            'result:view_own',
          ],
        );
        const capabilities = access.capabilities.filter(
          (key) =>
            !['assignment:view_assigned', 'assignment:attempt', 'result:view_own'].includes(key) ||
            isRecipient,
        );
        return { ...item, capabilities };
      }),
    );
    return result.filter((item) =>
      item.capabilities.some((key) =>
        [
          'assignment:create',
          'assignment:publish',
          'assignment:grade',
          'assignment:view_assigned',
        ].includes(key),
      ),
    );
  }

  async create(actorId: string, input: AssignmentCreate): Promise<Assignment> {
    const parsed = assignmentCreateSchema.safeParse(input);
    if (!parsed.success)
      throw new ClientError(
        'invalid',
        'assignment_invalid',
        'Cấu hình bài giao không hợp lệ',
        parsed.error.issues,
      );
    await this.assertClass(actorId, parsed.data.classId, 'assignment:create');
    const created = await this.repository.create(actorId, parsed.data);
    if (!created)
      throw new ClientError(
        'not_found',
        'exam_revision_not_found',
        'Phiên bản đề không tồn tại hoặc không thuộc bạn',
      );
    return created;
  }

  async preview(actorId: string, id: string): Promise<AssignmentPreview> {
    await this.authorized(actorId, id, 'assignment:grade');
    const preview = await this.repository.getPreview(id, actorId);
    if (!preview)
      throw new ClientError('not_found', 'assignment_not_found', 'Bài giao không tồn tại');
    return preview;
  }

  async get(actorId: string, id: string): Promise<Assignment> {
    const found = await this.authorized(actorId, id, 'assignment:create');
    return found;
  }

  /** Chỉ chỉnh sửa bản nháp; quyền được xét tại ngữ cảnh bài giao trước khi ghi. */
  async update(actorId: string, id: string, patch: AssignmentPatch): Promise<Assignment> {
    await this.authorized(actorId, id, 'assignment:create');
    const updated = await this.repository.updateDraft(id, actorId, patch);
    if (!updated)
      throw new ClientError(
        'conflict',
        'assignment_not_draft',
        'Bài giao không còn ở trạng thái draft',
      );
    return updated;
  }

  /**
   * Quyền công bố được xét trong ngữ cảnh bài giao cụ thể. Kho dữ liệu khóa lớp
   * khi chốt danh sách người nhận đang tham gia, không tự thêm người ghi danh về sau.
   */
  async publish(actorId: string, id: string): Promise<Assignment> {
    await this.authorized(actorId, id, 'assignment:publish');
    const updated = await this.repository.publish(id, actorId);
    if (!updated)
      throw new ClientError('not_found', 'assignment_not_found', 'Bài giao không tồn tại');
    return updated;
  }

  async listRecipients(actorId: string, id: string): Promise<AssignmentRecipient[]> {
    await this.authorized(actorId, id, 'assignment:publish');
    const recipients = await this.repository.listRecipients(id, actorId);
    if (!recipients)
      throw new ClientError('not_found', 'assignment_not_found', 'Bài giao không tồn tại');
    return recipients;
  }

  /** Thu hồi người nhận đã chốt mà không thay đổi danh sách người nhận của các bài giao khác. */
  async revokeRecipient(actorId: string, id: string, userId: string): Promise<void> {
    await this.authorized(actorId, id, 'assignment:publish');
    if (!(await this.repository.revokeRecipient(id, userId, actorId)))
      throw new ClientError(
        'not_found',
        'assignment_recipient_not_found',
        'Học sinh không thuộc bài giao',
      );
  }

  /** Chỉ trả nội dung đề đã chốt cho người nhận đủ quyền và trong thời điểm bài giao khả dụng. */
  async getDelivery(actorId: string, id: string): Promise<StudentAssignment> {
    const assignment = await this.authorized(actorId, id, 'assignment:view_assigned');
    const delivery = await this.repository.getDelivery(assignment.id, actorId, this.now());
    if (!delivery)
      throw new ClientError('not_found', 'assignment_not_available', 'Bài giao không khả dụng');
    return delivery;
  }
}
