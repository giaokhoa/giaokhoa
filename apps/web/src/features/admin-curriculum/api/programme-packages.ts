import { apiJson } from "#lib/api";

export interface ProgrammePackageMeta {
  id: string;
  version: string;
  scope: string;
  checksum: string;
  outcomeCount: number;
  status: "pending" | "published" | "rejected" | "withdrawn";
  centreSlug: string | null;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

export interface ProgrammePackageInstall {
  id: string;
  packageVersion: string;
  packageChecksum: string;
  previousVersion: string | null;
  scope: string;
  installedAt: string;
}

export interface ProgrammePackageDetail {
  package: ProgrammePackageMeta;
  curricula: Array<{
    curriculumId: string;
    subjectName: string | null;
    subjectSlug: string;
    grade: number;
  }>;
  nodes: Array<{
    nodeId: string;
    curriculumId: string;
    title: string;
    parentId: string | null;
  }>;
  outcomes: Array<{
    outcomeId: string;
    nodeId: string;
    content: unknown;
    sourceRef: string | null;
  }>;
}

const base = "/api/v1/system-bank/outcome-packages";

export function fetchPublishedProgrammes() {
  return apiJson<ProgrammePackageMeta[]>(base);
}

export function fetchMyProgrammes() {
  return apiJson<ProgrammePackageMeta[]>(`${base}/mine`);
}

export function fetchInstalledProgrammes() {
  return apiJson<ProgrammePackageInstall[]>(`${base}/installed`);
}

export function fetchPendingProgrammes() {
  return apiJson<ProgrammePackageMeta[]>(`${base}/pending`);
}

export function fetchProgrammeForReview(version: string) {
  return apiJson<ProgrammePackageDetail>(
    `${base}/review/${encodeURIComponent(version)}`,
  );
}

export function submitProgramme(version: string, scope: string) {
  return apiJson<{ package: ProgrammePackageMeta }>(base, {
    method: "POST",
    body: JSON.stringify({ version, scope, mappings: [] }),
  });
}

export function reviewProgramme(
  version: string,
  approve: boolean,
  reason: string,
) {
  return apiJson<ProgrammePackageMeta>(
    `${base}/${encodeURIComponent(version)}/${approve ? "approve" : "reject"}`,
    {
      method: "POST",
      ...(approve ? {} : { body: JSON.stringify({ reason }) }),
    },
  );
}

export function withdrawProgramme(version: string, reason: string) {
  return apiJson<ProgrammePackageMeta>(`${base}/${encodeURIComponent(version)}/withdraw`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
}

export function installProgramme(version: string) {
  return apiJson<{ install: ProgrammePackageInstall; unchanged: boolean }>(
    `${base}/${encodeURIComponent(version)}/install`,
    { method: "POST" },
  );
}
