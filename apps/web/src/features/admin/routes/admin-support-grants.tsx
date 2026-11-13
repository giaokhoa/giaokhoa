/**
 * Giao diện chủ trung tâm cấp quyền hỗ trợ có hạn (issue #19).
 * Không có quyền liên trung tâm, impersonation hoặc quyền wildcard;
 * mọi thao tác đều đợi API xác nhận rồi mới làm mới trạng thái.
 */
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { SupportGrant, SupportScope } from "@giaokhoa/contracts";
import { Badge } from "@giaokhoa/ui/components/badge";
import { Button } from "@giaokhoa/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@giaokhoa/ui/components/card";
import { Input } from "@giaokhoa/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@giaokhoa/ui/components/table";
import { ErrorAlert } from "#components/error-alert";
import { PageHeader, PageShell } from "#components/page-shell";
import { PageSkeleton } from "#components/page-skeleton";
import { usePermissions } from "#lib/permissions";
import { formatDateTime } from "#utils/date-format";
import { titleMeta } from "#lib/route-meta";
import { currentTenantQueryOptions } from "../queries/tenant-admin";
import {
  supportAuditQueryOptions,
  supportGrantsQueryOptions,
  useCreateSupportGrant,
  useRevokeSupportGrant,
} from "../queries/support-grants";

/** Tên hiển thị của phạm vi đã cấp, không có thao tác cập nhật dữ liệu. */
const SCOPE_LABELS: Record<SupportScope, string> = {
  "classes:read": "Xem danh sách lớp",
  "courses:read": "Xem danh sách khoá học",
};

const GRANT_LABELS: Record<SupportGrant["status"], string> = {
  active: "Đang hiệu lực",
  expired: "Đã hết hạn",
  revoked: "Đã thu hồi",
};

const EVENT_LABELS = {
  grant_created: "Đã cấp",
  grant_revoked: "Đã thu hồi",
  access_allowed: "Truy cập được phép",
  access_denied: "Truy cập bị từ chối",
};

/**
 * Form và hai bảng hoạt động trong tenant hiệu lực của người dùng,
 * không có trường chọn tenant khác. Dữ liệu server là nguồn sự thật.
 */
export default function AdminSupportGrantsPage() {
  const perms = usePermissions();
  const [recipientId, setRecipientId] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [scopes, setScopes] = useState<SupportScope[]>(["classes:read"]);
  const [message, setMessage] = useState<string | null>(null);

  const currentTenant = useQuery({
    ...currentTenantQueryOptions(),
    enabled: perms.ready && perms.canManageTenantAdmin,
  });
  const canManage =
    currentTenant.data?.kind === "center" &&
    currentTenant.data.status === "active" &&
    perms.canManageTenantAdmin;
  const grants = useQuery({
    ...supportGrantsQueryOptions(),
    enabled: Boolean(canManage),
  });
  const audit = useQuery({
    ...supportAuditQueryOptions(),
    enabled: Boolean(canManage),
  });
  const create = useCreateSupportGrant();
  const revoke = useRevokeSupportGrant();

  /** Gửi ISO có offset UTC, không gửi tenantId từ form. */
  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const date = new Date(expiresAt);
    if (!expiresAt || !Number.isFinite(date.getTime()) || scopes.length === 0) {
      setMessage("Chọn thời hạn và ít nhất một thao tác hợp lệ.");
      return;
    }
    create.mutate(
      {
        recipientId: recipientId.trim(),
        reason: reason.trim(),
        scopes,
        expiresAt: date.toISOString(),
      },
      {
        onSuccess: () => {
          setRecipientId("");
          setReason("");
          setExpiresAt("");
          setMessage("Đã cấp quyền hỗ trợ có thời hạn.");
        },
        onError: () =>
          setMessage(
            "Không thể cấp quyền. Kiểm tra người nhận, thời hạn và quyền quản trị.",
          ),
      },
    );
  }

  /** Lật một thao tác đọc trong tập thao tác được phép cố định. */
  function toggleScope(scope: SupportScope) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((value) => value !== scope)
        : [...current, scope],
    );
  }

  /** Thu hồi qua API, không báo thành công trước khi server ghi vết. */
  function handleRevoke(grantId: string) {
    setMessage(null);
    revoke.mutate(grantId, {
      onSuccess: () =>
        setMessage("Đã thu hồi. Request hỗ trợ kế tiếp sẽ bị chặn."),
      onError: () => setMessage("Không thể thu hồi quyền hỗ trợ."),
    });
  }

  if (!perms.ready || (currentTenant.isPending && perms.canManageTenantAdmin)) {
    return (
      <PageShell width="wide">
        <PageSkeleton
          rows={["h-32 w-full", "h-64 w-full"]}
          label="Đang tải quyền hỗ trợ"
        />
      </PageShell>
    );
  }

  return (
    <PageShell width="wide">
      <PageHeader
        title="Quyền hỗ trợ trung tâm"
        description="Chủ trung tâm quyết định ai được xem dữ liệu nào, đến thời điểm nào; mọi lần sử dụng đều có nhật ký."
        actions={
          <Link
            className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium"
            to="/admin/tenants"
          >
            Quay lại trung tâm
          </Link>
        }
      />
      {!canManage ? (
        <ErrorAlert variant="destructive">
          Chỉ quản trị viên của trung tâm đang hoạt động mới được cấp, thu hồi
          hoặc xem nhật ký hỗ trợ.
        </ErrorAlert>
      ) : (
        <>
          {message ? <ErrorAlert>{message}</ErrorAlert> : null}
          <Card>
            <CardHeader>
              <CardTitle>Cấp quyền hỗ trợ mới</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="grid gap-4">
                <label
                  className="grid gap-1 text-sm"
                  htmlFor="support-recipient"
                >
                  ID nhân sự platform được nhận quyền
                  <Input
                    id="support-recipient"
                    required
                    value={recipientId}
                    placeholder="UUID của nhân sự hỗ trợ"
                    onChange={(e) => setRecipientId(e.target.value)}
                  />
                </label>
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-medium">
                    Thao tác được phép (chỉ đọc)
                  </legend>
                  {(Object.keys(SCOPE_LABELS) as SupportScope[]).map(
                    (scope) => (
                      <label
                        key={scope}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={scopes.includes(scope)}
                          onChange={() => toggleScope(scope)}
                        />
                        {SCOPE_LABELS[scope]}
                      </label>
                    ),
                  )}
                </fieldset>
                <label className="grid gap-1 text-sm" htmlFor="support-expiry">
                  Hết hạn (tối đa 30 ngày)
                  <Input
                    id="support-expiry"
                    type="datetime-local"
                    required
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm" htmlFor="support-reason">
                  Lý do cấp quyền
                  <Input
                    id="support-reason"
                    required
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Ví dụ: kiểm tra lỗi hiển thị lớp"
                  />
                </label>
                <div>
                  <Button
                    type="submit"
                    disabled={create.isPending || !scopes.length}
                  >
                    Cấp quyền có thời hạn
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Quyền đã cấp</CardTitle>
            </CardHeader>
            <CardContent>
              {grants.isError ? (
                <ErrorAlert variant="destructive">
                  Không tải được danh sách quyền hỗ trợ.
                </ErrorAlert>
              ) : null}
              {grants.isPending ? <p>Đang tải…</p> : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nhân sự</TableHead>
                    <TableHead>Thao tác</TableHead>
                    <TableHead>Hết hạn</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Quản lý</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(grants.data ?? []).map((grant) => (
                    <TableRow key={grant.id}>
                      <TableCell className="font-mono text-xs">
                        {grant.recipientId}
                      </TableCell>
                      <TableCell>
                        {grant.scopes
                          .map((scope) => SCOPE_LABELS[scope])
                          .join(", ")}
                      </TableCell>
                      <TableCell>{formatDateTime(grant.expiresAt)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            grant.status === "active" ? "default" : "secondary"
                          }
                        >
                          {GRANT_LABELS[grant.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {grant.status === "active" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={revoke.isPending}
                            onClick={() => handleRevoke(grant.id)}
                          >
                            Thu hồi
                          </Button>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!grants.isPending && !grants.data?.length ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Chưa có quyền hỗ trợ nào được cấp.
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Nhật ký cấp quyền và sử dụng</CardTitle>
            </CardHeader>
            <CardContent>
              {audit.isError ? (
                <ErrorAlert variant="destructive">
                  Không tải được nhật ký hỗ trợ.
                </ErrorAlert>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Thời điểm</TableHead>
                    <TableHead>Người thực hiện</TableHead>
                    <TableHead>Sự kiện</TableHead>
                    <TableHead>Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(audit.data ?? []).map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>{formatDateTime(event.createdAt)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {event.actorId}
                      </TableCell>
                      <TableCell>{EVENT_LABELS[event.action]}</TableCell>
                      <TableCell>
                        {event.scope ? SCOPE_LABELS[event.scope] : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!audit.isPending && !audit.data?.length ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Chưa có sự kiện hỗ trợ.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}

export { RouteErrorBoundary as ErrorBoundary } from "#components/route-error-boundary";
export function meta() {
  return titleMeta("Quyền hỗ trợ trung tâm");
}
