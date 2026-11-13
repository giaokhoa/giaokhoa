/**
 * Giao diện chủ trung tâm cấp quyền hỗ trợ có hạn (issue #19).
 * Không có quyền liên trung tâm, impersonation hoặc quyền wildcard;
 * mọi thao tác đều đợi API xác nhận rồi mới làm mới trạng thái.
 */
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { SUPPORT_SCOPES, type SupportAuditEntry, type SupportGrant, type SupportScope } from "@giaokhoa/contracts";
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
import { useTranslation } from "react-i18next";
import { ErrorAlert } from "#components/error-alert";
import { PageHeader, PageShell } from "#components/page-shell";
import { PageSkeleton } from "#components/page-skeleton";
import "#config/i18n";
import { usePermissions } from "#lib/permissions";
import { titleMeta } from "#lib/route-meta";
import { formatDateTime } from "#utils/date-format";
import { currentTenantQueryOptions } from "../queries/tenant-admin";
import {
  supportAuditQueryOptions,
  supportGrantsQueryOptions,
  useCreateSupportGrant,
  useRevokeSupportGrant,
} from "../queries/support-grants";

/**
 * Form và hai bảng hoạt động trong tenant hiệu lực của người dùng,
 * không có trường chọn tenant khác. Dữ liệu server là nguồn sự thật.
 */
export default function AdminSupportGrantsPage() {
  const { t } = useTranslation("app");
  const perms = usePermissions();
  const [recipientId, setRecipientId] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [scopes, setScopes] = useState<SupportScope[]>(["classes:read"]);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Bảng tra nhãn hiển thị của các tập cố định trên trang — dựng trong
   * component vì nhãn lấy qua `t()` theo ngôn ngữ hiện tại; nguồn sự
   * thật của tập phạm vi là `SUPPORT_SCOPES` của hợp đồng, không duyệt
   * `Object.keys` của bảng nhãn rồi ép kiểu.
   */
  const scopeLabels: Record<SupportScope, string> = {
    "classes:read": t("supportScopeClassesRead"),
    "courses:read": t("supportScopeCoursesRead"),
  };
  /** Tên hiển thị của trạng thái grant, không có thao tác cập nhật dữ liệu. */
  const grantLabels: Record<SupportGrant["status"], string> = {
    active: t("supportGrantStatusActive"),
    expired: t("supportGrantStatusExpired"),
    revoked: t("supportGrantStatusRevoked"),
  };
  /** Tên hiển thị của sự kiện nhật ký hỗ trợ. */
  const eventLabels: Record<SupportAuditEntry["action"], string> = {
    grant_created: t("supportGrantEventCreated"),
    grant_revoked: t("supportGrantEventRevoked"),
    access_allowed: t("supportGrantEventAccessAllowed"),
    access_denied: t("supportGrantEventAccessDenied"),
  };

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
      setMessage(t("supportGrantInvalidForm"));
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
          setMessage(t("supportGrantCreated"));
        },
        onError: () =>
          setMessage(t("supportGrantCreateFailed")),
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
        setMessage(t("supportGrantRevoked")),
      onError: () => setMessage(t("supportGrantRevokeFailed")),
    });
  }

  if (!perms.ready || (currentTenant.isPending && perms.canManageTenantAdmin)) {
    return (
      <PageShell width="wide">
        <PageSkeleton
          rows={["h-32 w-full", "h-64 w-full"]}
          label={t("supportGrantsLoading")}
        />
      </PageShell>
    );
  }

  return (
    <PageShell width="wide">
      <PageHeader
        title={t("supportGrantsTitle")}
        description={t("supportGrantsDescription")}
        actions={
          <Link
            className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium"
            to="/admin/tenants"
          >
            {t("supportGrantsBackToCenter")}
          </Link>
        }
      />
      {!canManage ? (
        <ErrorAlert variant="destructive">
          {t("supportGrantsForbidden")}
        </ErrorAlert>
      ) : (
        <>
          {message ? <ErrorAlert>{message}</ErrorAlert> : null}
          <Card>
            <CardHeader>
              <CardTitle>{t("supportGrantCreateTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="grid gap-4">
                <label
                  className="grid gap-1 text-sm"
                  htmlFor="support-recipient"
                >
                  {t("supportGrantRecipientLabel")}
                  <Input
                    id="support-recipient"
                    required
                    value={recipientId}
                    placeholder={t("supportGrantRecipientPlaceholder")}
                    onChange={(e) => setRecipientId(e.target.value)}
                  />
                </label>
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-medium">
                    {t("supportGrantScopesLegend")}
                  </legend>
                  {SUPPORT_SCOPES.map(
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
                        {scopeLabels[scope]}
                      </label>
                    ),
                  )}
                </fieldset>
                <label className="grid gap-1 text-sm" htmlFor="support-expiry">
                  {t("supportGrantExpiryLabel")}
                  <Input
                    id="support-expiry"
                    type="datetime-local"
                    required
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm" htmlFor="support-reason">
                  {t("supportGrantReasonLabel")}
                  <Input
                    id="support-reason"
                    required
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t("supportGrantReasonPlaceholder")}
                  />
                </label>
                <div>
                  <Button
                    type="submit"
                    disabled={create.isPending || !scopes.length}
                  >
                    {t("supportGrantSubmit")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("supportGrantsListTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {grants.isError ? (
                <ErrorAlert variant="destructive">
                  {t("supportGrantsLoadFailed")}
                </ErrorAlert>
              ) : null}
              {grants.isPending ? <p>{t("loading")}</p> : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("supportGrantsUserColumn")}</TableHead>
                    <TableHead>{t("supportGrantsScopeColumn")}</TableHead>
                    <TableHead>{t("supportGrantsExpiryColumn")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    <TableHead>{t("supportGrantsManageColumn")}</TableHead>
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
                          .map((scope) => scopeLabels[scope])
                          .join(", ")}
                      </TableCell>
                      <TableCell>{formatDateTime(grant.expiresAt)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            grant.status === "active" ? "default" : "secondary"
                          }
                        >
                          {grantLabels[grant.status]}
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
                            {t("supportGrantRevoke")}
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
                  {t("supportGrantsEmpty")}
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("supportGrantsAuditTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {audit.isError ? (
                <ErrorAlert variant="destructive">
                  {t("supportGrantsAuditLoadFailed")}
                </ErrorAlert>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("supportGrantsAuditTimeColumn")}</TableHead>
                    <TableHead>{t("supportGrantsAuditActorColumn")}</TableHead>
                    <TableHead>{t("supportGrantsAuditEventColumn")}</TableHead>
                    <TableHead>{t("supportGrantsScopeColumn")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(audit.data ?? []).map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>{formatDateTime(event.createdAt)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {event.actorId}
                      </TableCell>
                      <TableCell>{eventLabels[event.action]}</TableCell>
                      <TableCell>
                        {event.scope ? scopeLabels[event.scope] : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!audit.isPending && !audit.data?.length ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t("supportGrantsAuditEmpty")}
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
