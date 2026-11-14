import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@giaokhoa/ui/components/badge";
import { Button } from "@giaokhoa/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@giaokhoa/ui/components/card";
import { Input } from "@giaokhoa/ui/components/input";
import { Label } from "@giaokhoa/ui/components/label";
import { usePermissions } from "#lib/permissions";
import { ApiError } from "#lib/api";
import {
  fetchInstalledProgrammes,
  fetchMyProgrammes,
  fetchPendingProgrammes,
  fetchProgrammeForReview,
  fetchPublishedProgrammes,
  installProgramme,
  withdrawProgramme,
  reviewProgramme,
  submitProgramme,
  type ProgrammePackageDetail,
  type ProgrammePackageInstall,
  type ProgrammePackageMeta,
} from "../api/programme-packages";
import { SystemSourceNotices } from "#components/system-source-notices";

function programmeInstallError(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError) {
    const code = error.problem.code;
    const key = ({
      "system_bank.curriculum_conflict": "programmePackagesCurriculumConflict",
      "system_bank.node_conflict": "programmePackagesNodeConflict",
      "system_bank.outcome_conflict": "programmePackagesOutcomeConflict",
      "system_bank.package_conflict": "programmePackagesChecksumConflict",
      "system_bank.bad_package": "programmePackagesInvalidPackage",
      "system_bank.dedicated_centre_required": "programmePackagesDedicatedRequired",
    } as Record<string, string>)[code ?? ""];
    if (key) return t(key);
  }
  return t("programmePackagesInstallFailed");
}

function programmeOutcomePlainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return "";
  const node = value as { text?: unknown; content?: unknown };
  const own = typeof node.text === "string" ? node.text : "";
  return (
    own +
    (Array.isArray(node.content)
      ? node.content.map(programmeOutcomePlainText).join(" ")
      : "")
  );
}

export function ProgrammePackagePanel({
  subjects,
}: {
  subjects: Array<{ name: string; slug: string }>;
}) {
  const { t } = useTranslation("app");
  const permissions = usePermissions();
  const access = permissions.access;
  const canSubmit =
    permissions.ready &&
    (access?.contexts.some(
      (ctx) =>
        ctx.contextLevel === 20 && ctx.capabilities.includes("tenant:manage"),
    ) ??
      false);
  const canReview =
    permissions.ready &&
    ((access?.contexts.some(
      (ctx) =>
        ctx.contextLevel === 10 &&
        ctx.capabilities.includes("systembank:review"),
    ) ??
      false) ||
      access?.isSiteAdmin ||
      false);

  const [published, setPublished] = useState<ProgrammePackageMeta[]>([]);
  const [mine, setMine] = useState<ProgrammePackageMeta[]>([]);
  const [installed, setInstalled] = useState<ProgrammePackageInstall[]>([]);
  const [pending, setPending] = useState<ProgrammePackageMeta[]>([]);
  const [version, setVersion] = useState("");
  const [scope, setScope] = useState("all");
  const [selectedVersion, setSelectedVersion] = useState("");
  const [preview, setPreview] = useState<ProgrammePackageDetail | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canSubmit && !canReview) return;
    const publishedRows = await fetchPublishedProgrammes();
    setPublished(publishedRows);
    if (canSubmit) {
      const [myRows, installedRows] = await Promise.all([
        fetchMyProgrammes(),
        fetchInstalledProgrammes(),
      ]);
      setMine(myRows);
      setInstalled(installedRows);
    }
    if (canReview) setPending(await fetchPendingProgrammes());
  }, [canSubmit, canReview]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve()
      .then(refresh)
      .catch(() => {
        if (alive) setNotice(t("programmePackagesLoadFailed"));
      });
    return () => {
      alive = false;
    };
  }, [refresh, t]);

  async function submit() {
    if (!version.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      await submitProgramme(version.trim(), scope);
      await refresh();
      setVersion("");
      setNotice(t("programmePackagesSubmitted"));
    } catch {
      setNotice(t("programmePackagesSubmitFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function install(selected: ProgrammePackageMeta) {
    if (
      !window.confirm(
        t("programmePackagesInstallConfirm", { version: selected.version }),
      )
    )
      return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await installProgramme(selected.version);
      await refresh();
      setNotice(
        t(
          result.unchanged
            ? "programmePackagesUnchanged"
            : "programmePackagesInstalled",
        ),
      );
    } catch (error) {
      setNotice(programmeInstallError(error, t));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(selected: ProgrammePackageMeta) {
    if (!canReview || busy) return;
    const withdrawalReason = window.prompt(t('programmeWithdrawalReason'));
    if (!withdrawalReason?.trim()) return;
    setBusy(true); setNotice(null);
    try {
      await withdrawProgramme(selected.version, withdrawalReason.trim());
      await refresh();
      setNotice(t('systemResourceWithdrawn'));
    } catch {
      setNotice(t('programmeWithdrawalFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function openReview(selected: ProgrammePackageMeta) {
    setBusy(true);
    setNotice(null);
    try {
      const details = await fetchProgrammeForReview(selected.version);
      setPreview(details);
      setSelectedVersion(selected.version);
      setReason("");
    } catch {
      setNotice(t("programmePackagesReviewLoadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function review(approve: boolean) {
    if (!selectedVersion || (!approve && !reason.trim())) {
      setNotice(t("programmePackagesReasonRequired"));
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await reviewProgramme(selectedVersion, approve, reason.trim());
      setSelectedVersion("");
      setPreview(null);
      setReason("");
      await refresh();
      setNotice(
        t(approve ? "programmePackagesApproved" : "programmePackagesRejected"),
      );
    } catch {
      setNotice(t("programmePackagesReviewFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!canSubmit && !canReview) return null;
  const installedByVersion = new Map(
    installed.map((row) => [row.packageVersion, row]),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("programmePackagesTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          {t("programmePackagesDescription")}
        </p>
        {notice ? (
          <p role="status" className="text-sm">
            {notice}
          </p>
        ) : null}
        {canSubmit ? <SystemSourceNotices resourceKind="programme" /> : null}

        {canSubmit ? (
          <section className="space-y-3">
            <h3 className="font-medium">{t("programmePackagesSubmitTitle")}</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <Label htmlFor="programme-version">
                  {t("programmePackagesVersion")}
                </Label>
                <Input
                  id="programme-version"
                  value={version}
                  placeholder={t("programmePackagesVersionExample")}
                  onChange={(event) => setVersion(event.target.value)}
                />
              </div>
              <div className="min-w-40 flex-1">
                <Label htmlFor="programme-scope">
                  {t("programmePackagesScope")}
                </Label>
                <select
                  id="programme-scope"
                  value={scope}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm"
                  onChange={(event) => setScope(event.target.value)}
                >
                  <option value="all">
                    {t("programmePackagesAllSubjects")}
                  </option>
                  {subjects.map((subject) => (
                    <option key={subject.slug} value={subject.slug}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                disabled={busy || !version.trim()}
                onClick={() => void submit()}
              >
                {t("programmePackagesSubmit")}
              </Button>
            </div>
            <h4 className="font-medium">{t("programmePackagesMine")}</h4>
            {mine.length ? (
              <ul className="space-y-2">
                {mine.map((item) => (
                  <li key={item.id} className="rounded-md border p-2 text-sm">
                    <span>
                      {item.version} · {item.scope} · {item.outcomeCount} YCCĐ
                    </span>
                    <Badge variant="secondary" className="ml-2">
                      {t(`programmePackagesStatus_${item.status}`)}
                    </Badge>
                    {item.rejectionReason ? (
                      <p className="mt-1 text-muted-foreground">
                        {t("programmePackagesRejection")}:{" "}
                        {item.rejectionReason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("programmePackagesNoMine")}
              </p>
            )}

            <h4 className="font-medium">{t("programmePackagesAvailable")}</h4>
            {published.length ? (
              <ul className="space-y-2">
                {published.map((item) => {
                  const current = installedByVersion.get(item.version);
                  return (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
                    >
                      <span className="flex-1">
                        {item.version} · {item.scope} · {item.outcomeCount} YCCĐ
                        {current ? (
                          <Badge variant="secondary" className="ml-2">
                            {t("programmePackagesAlreadyInstalled")}
                          </Badge>
                        ) : null}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void install(item)}
                      >
                        {t(
                          current
                            ? "programmePackagesVerifyInstall"
                            : "programmePackagesInstall",
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("programmePackagesNoAvailable")}
              </p>
            )}
            <h4 className="font-medium">{t("programmePackagesInstallHistory")}</h4>
            {installed.length ? (
              <ul className="space-y-2" aria-label={t("programmePackagesInstallHistory")}>
                {installed.map((entry) => (
                  <li key={entry.id} className="rounded-md border p-2 text-sm space-y-1">
                    <p><strong>{entry.packageVersion}</strong> · {entry.scope}</p>
                    <p>{t("programmePackagesPreviousVersion")}: {entry.previousVersion ?? t("programmePackagesFirstVersion")}</p>
                    <p>{t("programmePackagesInstalledAt")}: {new Date(entry.installedAt).toLocaleString()}</p>
                    <p className="break-all">{t("programmePackagesChecksum")}: <code>{entry.packageChecksum || t("programmePackagesLegacyChecksum")}</code></p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("programmePackagesNoHistory")}</p>
            )}
          </section>
        ) : null}

        {canReview ? (
          <section className="space-y-3">
            <h3 className="font-medium">{t("programmeWithdrawal")}</h3>
            <ul className="space-y-2">
              {published.map((entry) => <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                <span className="flex-1">{entry.version} · {entry.scope}</span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void withdraw(entry)}>
                  {t('programmeWithdrawal')}
                </Button>
              </li>)}
            </ul>
            <h3 className="font-medium">{t("programmePackagesPending")}</h3>
            {pending.length ? (
              <ul className="space-y-2">
                {pending.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
                  >
                    <span className="flex-1">
                      {item.version} · {item.centreSlug} · {item.scope}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void openReview(item)}
                    >
                      {t("programmePackagesReviewOpen")}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("programmePackagesNoPending")}
              </p>
            )}

            {preview ? (
              <div className="space-y-3 rounded-md border p-3 text-sm">
                <h4 className="font-medium">
                  {t("programmePackagesReviewDetails", {
                    version: preview.package.version,
                  })}
                </h4>
                <p>
                  {t("programmePackagesSource")}: {preview.package.centreSlug}
                </p>
                <p className="break-all">
                  {t("programmePackagesChecksum")}: {preview.package.checksum}
                </p>
                <p>
                  {t("programmePackagesCounts", {
                    curricula: preview.curricula.length,
                    nodes: preview.nodes.length,
                    outcomes: preview.outcomes.length,
                  })}
                </p>
                <ul className="space-y-2">
                  {preview.curricula.map((curriculum) => (
                    <li key={curriculum.curriculumId}>
                      <strong>
                        {curriculum.subjectName ?? curriculum.subjectSlug} —{" "}
                        {t("programmePackagesGrade", {
                          grade: curriculum.grade,
                        })}
                      </strong>
                      <ul className="ml-4 list-disc">
                        {preview.nodes
                          .filter(
                            (node) =>
                              node.curriculumId === curriculum.curriculumId,
                          )
                          .map((node) => (
                            <li key={node.nodeId}>
                              {node.title}
                              {preview.outcomes
                                .filter(
                                  (outcome) => outcome.nodeId === node.nodeId,
                                )
                                .map((outcome) => (
                                  <p
                                    key={outcome.outcomeId}
                                    className="ml-3 text-muted-foreground"
                                  >
                                    {programmeOutcomePlainText(outcome.content)}{" "}
                                    {outcome.sourceRef
                                      ? `· ${outcome.sourceRef}`
                                      : ""}
                                  </p>
                                ))}
                            </li>
                          ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                <div>
                  <Label htmlFor="programme-rejection-reason">
                    {t("programmePackagesRejection")}
                  </Label>
                  <Input
                    id="programme-rejection-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => void review(true)}>
                    {t("programmePackagesApprove")}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || !reason.trim()}
                    onClick={() => void review(false)}
                  >
                    {t("programmePackagesReject")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setPreview(null);
                      setSelectedVersion("");
                    }}
                  >
                    {t("programmePackagesClose")}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
