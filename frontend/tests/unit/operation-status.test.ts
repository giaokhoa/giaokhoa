import { describe, expect, it } from "vitest";
import { operationStatus } from "../../src/features/operations/operation-status";

describe("hiển thị trạng thái operation", () => {
  it("không thông báo thành công khi chưa đồng bộ xong", () => {
    for (const state of ["PENDING", "APPLYING", "RETRYABLE_FAILURE", "SUCCEEDED"] as const) {
      expect(operationStatus({ state, completed: false }).kind).toBe("pending");
    }
  });

  it("chỉ SUCCEEDED và completed true mới thành công", () => {
    expect(operationStatus({ state: "SUCCEEDED", completed: true }).kind).toBe("succeeded");
    expect(operationStatus({ state: "FAILED", completed: true }).kind).toBe("failed");
    expect(operationStatus({ state: "FAILED", completed: false }).kind).toBe("failed");
  });

  it("không coi trạng thái lạ là hoàn tất", () => {
    expect(operationStatus({ state: "UNKNOWN" as "PENDING", completed: true }).kind).toBe("pending");
  });
});
