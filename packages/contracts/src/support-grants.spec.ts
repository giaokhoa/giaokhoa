import { describe, expect, it } from "vitest";
import { createSupportGrantSchema, SUPPORT_SCOPES } from "./support-grants";

const VALID = {
  recipientId: "00000000-0000-7000-8000-0000000000a1",
  scopes: ["classes:read"],
  reason: "Giúp kiểm tra lỗi lớp",
  expiresAt: "2026-11-15T10:00:00.000+07:00",
};

describe("Hợp đồng cấp quyền hỗ trợ có thời hạn", () => {
  it("chỉ cho phép scope đọc xác định và người nhận UUID", () => {
    expect(SUPPORT_SCOPES).toEqual(["classes:read", "courses:read"]);
    expect(createSupportGrantSchema.safeParse(VALID).success).toBe(true);
    expect(
      createSupportGrantSchema.safeParse({ ...VALID, scopes: ["*"] }).success,
    ).toBe(false);
    expect(
      createSupportGrantSchema.safeParse({
        ...VALID,
        scopes: ["users:loginas"],
      }).success,
    ).toBe(false);
    expect(
      createSupportGrantSchema.safeParse({ ...VALID, recipientId: "nhan-su" })
        .success,
    ).toBe(false);
  });

  it("không cho scope rỗng/trùng, thời gian không offset hoặc trường tenant tuỳ ý", () => {
    expect(
      createSupportGrantSchema.safeParse({ ...VALID, scopes: [] }).success,
    ).toBe(false);
    expect(
      createSupportGrantSchema.safeParse({
        ...VALID,
        scopes: ["classes:read", "classes:read"],
      }).success,
    ).toBe(false);
    expect(
      createSupportGrantSchema.safeParse({
        ...VALID,
        expiresAt: "2026-11-15T10:00:00",
      }).success,
    ).toBe(false);
    expect(
      createSupportGrantSchema.safeParse({
        ...VALID,
        tenantId: VALID.recipientId,
      }).success,
    ).toBe(false);
  });
});
