import { Injectable, Logger } from '@nestjs/common';
import { uuidIdSchema } from '@giaokhoa/contracts';
import { sql, type CentreDB } from '@giaokhoa/db';
import { SpaceDatabaseService } from './db/routing/space-database.service';

/**
 * Các trường outbox cần để phản chiếu sự kiện vào `event_log`; không phụ thuộc kiểu dữ liệu của tầng ORM.
 *
 * `payload` chỉ nhận object hoặc null vì writer đọc các khoá có tên; `seq` đã được relay chuyển từ int8 PostgreSQL về `number`.
 */
export interface OutboxRowLike {
  id: string;
  seq: number;
  aggregate: string;
  type: string;
  occurredAt: Date;
  tenantId: string | null;
  payload: Record<string, unknown> | null;
}

const COURSE_CONTEXT_LEVEL = 50;

/**
 * Các khoá payload ứng viên đặt tên cho đối tượng chính của một sự kiện, theo từng outbox
 * aggregate. Khoá đầu tiên hiện diện sẽ thắng; giá trị được đưa vào trường
 * `objectId` đã chuẩn hoá của payload log đã lưu.
 */
const OBJECT_ID_KEYS: Record<string, string[]> = {
  course: ['courseId'],
  course_category: ['categoryId'],
  course_module: ['cmId'],
  enrol: ['enrolmentId', 'instanceId'],
  grades: ['itemId', 'gradeId'],
  question: ['questionId', 'usageId'],
  stimulus: ['stimulusId'],
  user: ['userId'],
  auth: ['userId'],
  access: ['assignmentId'],
  badges: ['badgeId', 'issuedId'],
  group: ['groupId'],
  grouping: ['groupingId'],
  cohort: ['cohortId'],
  calendar: ['eventId'],
  completion: ['cmId', 'courseId'],
  competency: ['competencyId'],
  messaging: ['conversationId', 'messageId'],
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Phản chiếu sự kiện đã phát từ outbox của worker sang `event_log`, chuẩn hoá actor, người liên quan, khoá học, đối tượng và địa chỉ IP.
 *
 * Lỗi ghi log được ghi nhận nhưng không làm thất bại relay, vì phát sự kiện và ghi log là hai trách nhiệm độc lập.
 *
 * @remarks
 * Writer dùng `SpaceDatabaseService.routedKysely` trong phiên kho đang xử lý, bảo đảm tra cứu context và ghi `event_log` cùng database với outbox gốc. Giá trị JSONB được serialize và ép `::jsonb` để mảng không bị driver `pg` diễn giải thành mảng PostgreSQL.
 */
@Injectable()
export class EventLogWriter {
  private readonly logger = new Logger(EventLogWriter.name);

  constructor(private readonly spaceDb: SpaceDatabaseService) {}

  async record(row: OutboxRowLike): Promise<void> {
    try {
      const source = (row.payload ?? {}) as Record<string, unknown>;
      const actorId = str(source.actorId);
      const payloadUserId = str(source.userId);
      const relatedUserId = str(source.relatedUserId)
        ?? (payloadUserId && payloadUserId !== actorId ? payloadUserId : null);
      const courseId = str(source.courseId);
      let contextId = str(source.contextId);
      if (!contextId && courseId) contextId = await this.courseContextId(courseId);
      const objectId = this.objectIdOf(row.aggregate, source);
      const sourceComponent = str(source.component);
      const payload: Record<string, unknown> = {
        ...source,
        // Một số payload đã mang sẵn trường `component` của riêng chúng (component
        // hoạt động của một course module) — giữ nó dưới
        // `sourceComponent`; `component` đã chuẩn hoá là phân hệ của sự kiện
        // (outbox aggregate).
        ...(sourceComponent ? { sourceComponent } : {}),
        component: row.aggregate,
        action: row.type,
        actorId,
        relatedUserId,
        courseId,
        objectId,
        ip: str(source.ip),
        outboxId: row.id,
        outboxSeq: row.seq,
      };
      await this.spaceDb.routedKysely
        .insertInto('event_log')
        .values({
          event_type: row.type,
          context_id: contextId,
          user_id: actorId,
          tenant_id: row.tenantId ?? str(source.tenantId),
          payload: sql<CentreDB['event_log']['payload']>`${JSON.stringify(payload)}::jsonb`,
          created_at: row.occurredAt,
        })
        .execute();
    } catch (err) {
      this.logger.error(`Failed to mirror outbox event ${row.type} (${row.id}) into event_log: ${String(err)}`);
    }
  }

  private objectIdOf(aggregate: string, payload: Record<string, unknown>): string | null {
    const keys = OBJECT_ID_KEYS[aggregate] ?? ['objectId'];
    for (const key of keys) {
      const value = str(payload[key]);
      if (value) return value;
    }
    return str(payload.objectId);
  }

  /** Tra cứu context của khoá học chỉ đọc; context bị thiếu thì cột để null (payload vẫn mang courseId). */
  private async courseContextId(courseId: string): Promise<string | null> {
    if (!uuidIdSchema.safeParse(courseId).success) return null;
    const row = await this.spaceDb.routedKysely
      .selectFrom('context')
      .select('id')
      .where('context_level', '=', COURSE_CONTEXT_LEVEL)
      .where('instance_id', '=', courseId)
      .limit(1)
      .executeTakeFirst();
    return row?.id ?? null;
  }
}
