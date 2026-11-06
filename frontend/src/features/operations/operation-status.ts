export type OperationState =
  | "PENDING"
  | "APPLYING"
  | "SUCCEEDED"
  | "RETRYABLE_FAILURE"
  | "FAILED";

export type OperationView = {
  id: string;
  state: OperationState;
  completed: boolean;
  targetType: string;
  targetId?: string;
  errorCode?: string;
};

export type OperationStatus = {
  kind: "pending" | "succeeded" | "failed";
  message: string;
};

export function operationStatus(
  operation: Pick<OperationView, "state" | "completed">,
): OperationStatus {
  if (operation.state === "FAILED") {
    return { kind: "failed", message: "Thao tác không hoàn tất. Vui lòng thử lại hoặc liên hệ hỗ trợ." };
  }
  if (operation.state === "SUCCEEDED" && operation.completed === true) {
    return { kind: "succeeded", message: "Thao tác đã hoàn tất." };
  }
  if (operation.state === "RETRYABLE_FAILURE") {
    return { kind: "pending", message: "Đang thử đồng bộ lại quyền." };
  }
  return { kind: "pending", message: "Đang cập nhật quyền. Thao tác chưa hoàn tất." };
}
