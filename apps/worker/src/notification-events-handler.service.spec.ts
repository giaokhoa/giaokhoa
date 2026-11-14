import { describe, expect, it, vi } from "vitest";
import { NotificationEventsHandlerService } from "./notification-events-handler.service";
import type { NotificationDeliveryService } from "./notification-delivery.service";
import type { SpaceDatabaseService } from "./db/routing/space-database.service";
import type { I18nService } from "@nestjs/i18n";

function build(visible = true, extraRows: Record<string, unknown[]> = {}) {
  const notify = vi.fn(async () => undefined);
  const rows: Record<string, unknown[]> = {
    assignments: [
      {
        name: "Bài tập",
        courseId: "course-1",
        courseVisible: visible,
        cmVisible: true,
        cmDeletionInProgress: false,
      },
    ],
    exam_pins: [
      {
        name: "Bài kiểm tra",
        courseId: "course-1",
        courseVisible: visible,
        cmVisible: true,
        cmDeletionInProgress: false,
      },
    ],
    course: [{ fullName: "Khóa học" }],
    user_enrolments: [
      { userId: "teacher-1" },
      { userId: "student-1" },
      { userId: "student-1" },
    ],
    notifications: [],
    tenant_memberships: [{ tenantId: "tenant-1", kind: "centre" }],
    ...extraRows,
  };
  const routedKysely = {
    selectFrom: (table: string) => {
      const query = {
        innerJoin: () => query,
        leftJoin: () => query,
        select: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        execute: async () => rows[table] ?? [],
        executeTakeFirst: async () => rows[table]?.[0],
      };
      return query;
    },
  };
  const service = new NotificationEventsHandlerService(
    { routedKysely } as unknown as SpaceDatabaseService,
    { notify } as unknown as NotificationDeliveryService,
    { t: (key: string) => key } as unknown as I18nService,
  );
  return { service, notify };
}

describe("Thông báo học viên khi giáo viên giao bài và công bố đề", () => {
  it("giao bài tập chỉ thông báo cho học viên, không gửi trùng khi ghi danh bị lặp", async () => {
    const { service, notify } = build();
    await service.handle("assignment_created", {
      assignmentId: "assignment-1",
      courseId: "course-1",
      actorId: "teacher-1",
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "student-1",
      "assignment_assigned",
      expect.objectContaining({
        contextUrl: "/courses/course-1/assignments/assignment-1",
        courseId: "course-1",
        tenantId: "tenant-1",
      }),
    );
  });

  it("công bố đề chỉ thông báo cho học viên, bỏ qua người thao tác", async () => {
    const { service, notify } = build();
    await service.handle("exam_pinned", {
      pinId: "pin-1",
      courseId: "course-1",
      actorId: "teacher-1",
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "student-1",
      "quiz_available",
      expect.objectContaining({
        contextUrl: "/courses/course-1/exams/pin-1",
        tenantId: "tenant-1",
      }),
    );
  });

  it("bài tập trong khóa học ẩn không gửi thông báo cho học viên", async () => {
    const { service, notify } = build(false);
    await service.handle("assignment_created", {
      assignmentId: "assignment-1",
      courseId: "course-1",
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("giao bài tập không gửi lại khi đã có thông báo chưa đọc cùng loại và cùng đường dẫn", async () => {
    const { service, notify } = build(true, {
      notifications: [
        {
          id: "notif-1",
          subject: "platform.assignmentAssignedSubject",
          fullMessage: "platform.assignmentAssignedBody",
        },
      ],
    });
    await service.handle("assignment_created", {
      assignmentId: "assignment-1",
      courseId: "course-1",
      actorId: "teacher-1",
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("giao bài tập do học viên tạo thì học viên đó bị loại khỏi danh sách nhận", async () => {
    const { service, notify } = build(true, {
      user_enrolments: [{ userId: "student-1" }, { userId: "student-1" }],
    });
    await service.handle("assignment_created", {
      assignmentId: "assignment-1",
      courseId: "course-1",
      actorId: "student-1",
    });
    expect(notify).not.toHaveBeenCalled();
  });
});
