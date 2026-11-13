import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OutboxService } from '../../infra/events/outbox.service';
import { PermissionEvaluator } from '../access/permission-evaluator.service';
import { GradesService } from '../grades/grades.service';
import { TenantContextService } from '../tenants/tenant-context.service';
import { TenantsRepository } from '@giaokhoa/db/repositories/tenants';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from '../users/users.service';
import { GuardiansRepository, type GuardianLinkRow } from '@giaokhoa/db/repositories/guardians';

export const GUARDIAN_MANAGE_CAPABILITY = 'guardian:manage';

export interface GuardianStudentView {
  link: GuardianLinkRow;
  student: { id: string; username: string; firstName: string; lastName: string; email: string };
}

@Injectable()
export class GuardiansService {
  constructor(
    private readonly repo: GuardiansRepository,
    private readonly evaluator: PermissionEvaluator,
    private readonly users: UsersService,
    private readonly grades: GradesService,
    private readonly outbox: OutboxService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantRepo: TenantsRepository,
    private readonly tenants: TenantsService,
  ) {}

  private async linkTenantId(): Promise<string> {
    return this.tenantContext.currentTenantId() ?? (await this.tenants.fallbackTenantId());
  }

  private async assertBothMembers(tenantId: string, guardianUserId: string, studentUserId: string): Promise<void> {
    const tenant = await this.tenantRepo.getTenant(tenantId);
    if (!tenant || tenant.kind === 'platform') return;
    for (const [side, userId] of [['guardian', guardianUserId], ['student', studentUserId]] as const) {
      const membership = await this.tenantRepo.getMembership(tenantId, userId);
      if (!membership || membership.status !== 'active') {
        throw new BadRequestException({
          message: `The ${side} is not an active member of this tenant`,
          code: 'guardian.membership_required',
        });
      }
    }
  }

  private async assertCanManageLinks(actorId: string): Promise<void> {
    const allowed = await this.evaluator.hasCapabilityFromRealAssignmentAnywhere(actorId, GUARDIAN_MANAGE_CAPABILITY);
    if (!allowed) {
      throw new ForbiddenException({ message: 'Missing capability guardian:manage', code: 'guardian.manage_denied' });
    }
  }

  async createLink(actorId: string, input: { guardianUserId: string; studentUserId: string; relationship: string; note?: string }): Promise<GuardianLinkRow> {
    await this.assertCanManageLinks(actorId);
    if (input.guardianUserId === input.studentUserId) {
      throw new BadRequestException({ message: 'Guardian and student must be different users', code: 'guardian.link_self' });
    }
    await this.users.getUser(input.guardianUserId);
    await this.users.getUser(input.studentUserId);
    const tenantId = await this.linkTenantId();
    await this.assertBothMembers(tenantId, input.guardianUserId, input.studentUserId);
    const existing = await this.repo.findActiveLink(input.guardianUserId, input.studentUserId);
    if (existing) {
      throw new ConflictException({ message: 'An active guardian link already exists for this pair', code: 'guardian.link_already_active' });
    }
    const link = await this.repo.insertLink({
      tenantId,
      guardianUserId: input.guardianUserId,
      studentUserId: input.studentUserId,
      relationship: input.relationship,
      status: 'active',
      createdBy: actorId,
      note: input.note ?? null,
    });
    await this.outbox.enqueueStandalone({
      aggregate: 'guardian', type: 'guardian_link_created',
      payload: { actorId, userId: input.studentUserId, guardianUserId: input.guardianUserId, linkId: link.id, objectId: link.id, relationship: input.relationship },
      tenantId,
    });
    return link;
  }

  async listLinks(actorId: string, filters: { guardianUserId?: string; studentUserId?: string; status?: string }): Promise<GuardianLinkRow[]> {
    const involvesSelf = filters.guardianUserId === actorId || filters.studentUserId === actorId;
    if (!involvesSelf) await this.assertCanManageLinks(actorId);
    const rows = await this.repo.listLinks(filters);
    const active = this.tenantContext.currentTenantId();
    return active ? rows.filter((l) => l.tenantId === active) : rows;
  }

  async revokeLink(actorId: string, linkId: string): Promise<GuardianLinkRow> {
    await this.assertCanManageLinks(actorId);
    const link = await this.repo.getLink(linkId);
    const active = this.tenantContext.currentTenantId();
    if (!link || link.status !== 'active' || (active !== undefined && link.tenantId !== active)) {
      throw new NotFoundException({ message: `Active guardian link ${linkId} not found`, code: 'guardian.link_not_found' });
    }
    await this.repo.updateLink(linkId, { status: 'revoked', revokedBy: actorId, revokedAt: new Date() });
    await this.outbox.enqueueStandalone({
      aggregate: 'guardian', type: 'guardian_link_revoked',
      payload: { actorId, userId: link.studentUserId, guardianUserId: link.guardianUserId, linkId: link.id, objectId: link.id },
    });
    return (await this.repo.getLink(linkId))!;
  }

  async myStudents(actorId: string): Promise<GuardianStudentView[]> {
    const links = await this.repo.listLinks({ guardianUserId: actorId, status: 'active' });
    const out: GuardianStudentView[] = [];
    for (const link of links) {
      const student = await this.users.getUser(link.studentUserId);
      out.push({
        link,
        student: { id: student.id, username: student.username, firstName: student.firstName, lastName: student.lastName, email: student.email },
      });
    }
    return out;
  }

  async myGuardians(actorId: string): Promise<GuardianLinkRow[]> {
    return this.repo.listLinks({ studentUserId: actorId, status: 'active' });
  }

  private async assertActiveLink(guardianId: string, studentId: string): Promise<GuardianLinkRow> {
    const link = await this.repo.findActiveLink(guardianId, studentId);
    if (!link) {
      throw new ForbiddenException({ message: 'No active guardian link to this student', code: 'guardian.no_active_link' });
    }
    return link;
  }

  async requireActiveLinkOr404(guardianId: string, studentId: string): Promise<GuardianLinkRow> {
    const link = await this.repo.findActiveLink(guardianId, studentId);
    if (!link) {
      throw new NotFoundException({ message: 'Student not found', code: 'guardian.student_not_found' });
    }
    return link;
  }

  private async auditView(guardianId: string, studentId: string, courseId: string | null, surface: string): Promise<void> {
    await this.outbox.enqueueStandalone({
      aggregate: 'guardian', type: 'guardian_student_results_viewed',
      payload: { actorId: guardianId, userId: studentId, courseId, objectId: studentId, surface },
    }).catch(() => undefined);
  }

  async recordView(guardianId: string, studentId: string, surface: string): Promise<void> {
    await this.auditView(guardianId, studentId, null, surface);
  }

  async studentGradebook(guardianId: string, studentId: string, courseId: string) {
    await this.assertActiveLink(guardianId, studentId);
    const activities = await this.grades.listPublishedActivityGrades(courseId, studentId);
    await this.auditView(guardianId, studentId, courseId, 'gradebook');
    return { courseId, userId: studentId, activities };
  }
}
