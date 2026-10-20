import { assignmentCreateSchema } from '@giaokhoa/shared/assignments';
import type {
  Assignment,
  AssignmentCreate,
  AssignmentPatch,
  AssignmentRecipient,
  StudentAssignment,
} from '@giaokhoa/shared/assignments';
import type { AuthorizationService } from '../authorization/service.js';
import { ClientError } from '../common/client-error.js';
import type { AssignmentsRepository } from './repository.js';

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
    await this.assertClass(actorId, assignment.classId, capability);
    return assignment;
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

  async get(actorId: string, id: string): Promise<Assignment> {
    const found = await this.authorized(actorId, id, 'assignment:create');
    if (found.createdByUserId !== actorId)
      throw new ClientError('not_found', 'assignment_not_found', 'Bài giao không tồn tại');
    return found;
  }

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

  async revokeRecipient(actorId: string, id: string, userId: string): Promise<void> {
    await this.authorized(actorId, id, 'assignment:publish');
    if (!(await this.repository.revokeRecipient(id, userId, actorId)))
      throw new ClientError(
        'not_found',
        'assignment_recipient_not_found',
        'Học sinh không thuộc bài giao',
      );
  }

  async getDelivery(actorId: string, id: string): Promise<StudentAssignment> {
    const assignment = await this.authorized(actorId, id, 'assignment:view_assigned');
    const delivery = await this.repository.getDelivery(assignment.id, actorId, this.now());
    if (!delivery)
      throw new ClientError('not_found', 'assignment_not_available', 'Bài giao không khả dụng');
    return delivery;
  }
}
